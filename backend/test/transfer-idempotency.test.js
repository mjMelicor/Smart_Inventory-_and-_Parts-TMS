import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../src/db.js';
import { router } from '../src/routes.js';

function responseDouble() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function receiveRoute() {
  const registered = router.stack.find(layer => layer.route?.path === '/transfers/:id/receive' && layer.route.methods.post);
  assert.ok(registered, 'transfer receipt route is registered');
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  return async ({ userId = 5n, branchId = 3n, key, quantity }) => {
    const req = {
      user: { id: userId, role: 'branch_manager', branchId, branchIsActive: true },
      params: { id: '42' },
      body: { quantity },
      get: header => header === 'Idempotency-Key' ? key : undefined
    };
    const res = responseDouble();
    let error;
    authorize(req, res, caught => { error = caught; });
    if (!error && res.statusCode === null) await handler(req, res, caught => { error = caught; });
    return { res, error };
  };
}

function transferRequestRoute() {
  const registered = router.stack.find(layer => layer.route?.path === '/transfers' && layer.route.methods.post);
  assert.ok(registered, 'transfer request route is registered');
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  return async ({ key, quantity = 4, notes = 'Needed for repair' }) => {
    const req = {
      user: { id: 9n, role: 'technician', branchId: 3n, branchIsActive: true },
      body: { partId: '1', sourceBranchId: '1', quantity, notes },
      get: header => header === 'Idempotency-Key' ? key : undefined
    };
    const res = responseDouble();
    let error;
    authorize(req, res, caught => { error = caught; });
    if (!error && res.statusCode === null) await handler(req, res, caught => { error = caught; });
    return { res, error };
  };
}

function decisionRoute() {
  const registered = router.stack.find(layer => layer.route?.path === '/transfers/:id/decision' && layer.route.methods.patch);
  assert.ok(registered, 'transfer decision route is registered');
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  return async () => {
    const req = {
      user: { id: 5n, role: 'branch_manager', branchId: 1n, branchIsActive: true },
      params: { id: '42' },
      body: { decision: 'approved' }
    };
    const res = responseDouble();
    let error;
    authorize(req, res, caught => { error = caught; });
    if (!error && res.statusCode === null) await handler(req, res, caught => { error = caught; });
    return { res, error };
  };
}

function dispatchRoute() {
  const registered = router.stack.find(layer => layer.route?.path === '/transfers/:id/dispatch' && layer.route.methods.post);
  assert.ok(registered, 'transfer dispatch route is registered');
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  return async ({ branchId = 1n } = {}) => {
    const req = {
      user: { id: 5n, role: 'branch_manager', branchId, branchIsActive: true },
      params: { id: '42' }
    };
    const res = responseDouble();
    let error;
    authorize(req, res, caught => { error = caught; });
    if (!error && res.statusCode === null) await handler(req, res, caught => { error = caught; });
    return { res, error };
  };
}

test('dispatch route deducts reserved stock once and enforces the source branch', async () => {
  const previousTransaction = prisma.$transaction;
  const inventory = { quantityOnHand: 45, quantityReserved: 5 };
  const transfer = {
    id: 42n,
    sourceBranchId: 1n,
    destinationBranchId: 3n,
    status: 'approved',
    items: [{ id: 6n, partId: 1n, quantityRequested: 5, quantityApproved: 5, quantityReceived: 0 }]
  };
  let inventoryUpdates = 0;
  const route = dispatchRoute();
  prisma.$transaction = async callback => callback({
    $queryRaw: async () => [],
    branch: { findUnique: async ({ where }) => ({ id: where.id, isActive: true }) },
    $executeRaw: async () => {
      if (inventory.quantityOnHand < 5 || inventory.quantityReserved < 5) return 0;
      inventory.quantityOnHand -= 5;
      inventory.quantityReserved -= 5;
      inventoryUpdates += 1;
      return 1;
    },
    transferRequest: {
      findUnique: async () => ({ ...transfer, items: transfer.items.map(item => ({ ...item })) }),
      update: async ({ data }) => {
        transfer.status = data.status;
        return { ...transfer, items: transfer.items.map(item => ({ ...item })) };
      }
    }
  });

  try {
    const dispatched = await route();
    assert.equal(dispatched.error, undefined);
    assert.equal(dispatched.res.body.status, 'dispatched');
    assert.deepEqual(inventory, { quantityOnHand: 40, quantityReserved: 0 });
    assert.equal(inventoryUpdates, 1);

    const duplicate = await route();
    assert.equal(duplicate.error?.status, 409);
    assert.equal(inventoryUpdates, 1);

    const wrongBranch = await route({ branchId: 2n });
    assert.equal(wrongBranch.error?.status, 403);
    assert.equal(inventoryUpdates, 1);
  } finally {
    prisma.$transaction = previousTransaction;
  }
});

test('existing transfers involving an inactive destination cannot be dispatched', async () => {
  const previousTransaction = prisma.$transaction;
  let stockUpdates = 0;
  let transferUpdates = 0;
  const route = dispatchRoute();
  prisma.$transaction = async callback => callback({
    $queryRaw: async () => [],
    branch: {
      findUnique: async ({ where }) => ({ id: where.id, isActive: where.id !== 3n })
    },
    $executeRaw: async () => { stockUpdates += 1; return 1; },
    transferRequest: {
      findUnique: async () => ({
        id: 42n,
        sourceBranchId: 1n,
        destinationBranchId: 3n,
        status: 'approved',
        items: [{ id: 6n, partId: 1n, quantityRequested: 5, quantityApproved: 5, quantityReceived: 0 }]
      }),
      update: async () => { transferUpdates += 1; }
    }
  });

  try {
    const result = await route();
    assert.equal(result.error?.status, 409);
    assert.match(result.error.message, /both branches to be active/i);
    assert.equal(stockUpdates, 0);
    assert.equal(transferUpdates, 0);
  } finally {
    prisma.$transaction = previousTransaction;
  }
});

test('existing transfers involving inactive branches cannot be approved or received', async () => {
  const previousTransaction = prisma.$transaction;
  let stockReads = 0;
  let inventoryChanges = 0;
  const pendingTransfer = {
    id: 42n,
    sourceBranchId: 1n,
    destinationBranchId: 3n,
    status: 'pending',
    items: [{ id: 6n, partId: 1n, quantityRequested: 5, quantityApproved: 0, quantityReceived: 0 }]
  };
  const route = decisionRoute();
  prisma.$transaction = async callback => callback({
    $queryRaw: async strings => {
      if (strings.join(' ').includes('SELECT quantity_reserved')) stockReads += 1;
      return [];
    },
    branch: { findUnique: async ({ where }) => ({ id: where.id, isActive: where.id !== 3n }) },
    transferRequest: {
      findUnique: async () => pendingTransfer,
      update: async () => { inventoryChanges += 1; }
    },
    inventory: { update: async () => { inventoryChanges += 1; } }
  });

  try {
    const approval = await route();
    assert.equal(approval.error?.status, 409);
    assert.equal(stockReads, 0);
    assert.equal(inventoryChanges, 0);
  } finally {
    prisma.$transaction = previousTransaction;
  }

  const previousTransactionForReceipt = prisma.$transaction;
  const receipt = receiveRoute();
  let receiptEventsRead = 0;
  let stockReceived = 0;
  prisma.$transaction = async callback => callback({
    $queryRaw: async () => [],
    branch: { findUnique: async ({ where }) => ({ id: where.id, isActive: where.id !== 1n }) },
    transferRequest: {
      findUnique: async () => ({
        ...pendingTransfer,
        status: 'dispatched',
        items: [{ ...pendingTransfer.items[0], quantityApproved: 5 }]
      })
    },
    transferReceiptEvent: { findUnique: async () => { receiptEventsRead += 1; return null; } },
    inventory: { upsert: async () => { stockReceived += 1; } }
  });
  try {
    const result = await receipt({ key: 'd2eeb023-6d3e-4e75-99e0-52db0f7d8f63', quantity: 1 });
    assert.equal(result.error?.status, 409);
    assert.equal(receiptEventsRead, 0);
    assert.equal(stockReceived, 0);
  } finally {
    prisma.$transaction = previousTransactionForReceipt;
  }
});

test('concurrent identical transfer requests reserve stock once and changed details conflict', async () => {
  const previousTransaction = prisma.$transaction;
  const availableStock = { onHand: 20, reserved: 2 };
  const auditEvents = [];
  const transfers = new Map();
  let transferId = 101n;
  let reservationUpdates = 0;
  let sourceBranchActive = true;
  let lockTail = Promise.resolve();
  const key = '2e6bfe06-f33d-4924-bef6-9e6f7913ce67';
  const route = transferRequestRoute();

  prisma.$transaction = async callback => {
    let releaseLock;
    try {
      return await callback({
        $queryRaw: async (strings, ...values) => {
          const sql = strings.join(' ');
          if (sql.includes('pg_advisory_xact_lock')) {
            const previous = lockTail;
            let unlock;
            lockTail = new Promise(resolve => { unlock = resolve; });
            await previous;
            releaseLock = unlock;
            return [];
          }
          if (!sql.includes('SELECT table_name AS')) return [];
          const [userId, idempotencyKey] = values;
          const event = auditEvents.find(row => row.performedByUserId === userId
            && row.oldData.idempotencyKey === idempotencyKey);
          return event ? [{
            tableName: event.tableName,
            operation: event.operation,
            recordId: event.recordId,
            performedByUserId: event.performedByUserId,
            oldData: event.oldData
          }] : [];
        },
        branch: { findUnique: async ({ where }) => ({ id: where.id, isActive: where.id !== 1n || sourceBranchActive }) },
        part: { findUnique: async () => ({ id: 1n }) },
        $executeRaw: async (_strings, ...values) => {
          const quantity = values.at(-1);
          if (availableStock.onHand - availableStock.reserved < quantity) return 0;
          availableStock.reserved += quantity;
          reservationUpdates += 1;
          return 1;
        },
        transferRequest: {
          create: async ({ data }) => {
            const created = {
              id: transferId++,
              code: data.code,
              sourceBranchId: data.sourceBranchId,
              destinationBranchId: data.destinationBranchId,
              requestedByUserId: data.requestedByUserId,
              status: data.status,
              requestNotes: data.requestNotes,
              items: [{ id: transferId + 100n, ...data.items.create }]
            };
            transfers.set(created.id, created);
            return created;
          },
          findUnique: async ({ where }) => transfers.get(where.id) || null
        },
        auditLog: {
          create: async ({ data }) => {
            auditEvents.push(data);
            return data;
          }
        }
      });
    } finally {
      releaseLock?.();
    }
  };

  try {
    const [first, retry] = await Promise.all([route({ key }), route({ key })]);
    assert.equal(first.error, undefined);
    assert.equal(retry.error, undefined);
    assert.equal(first.res.statusCode, 201);
    assert.equal(retry.res.statusCode, 201);
    assert.equal(first.res.body.id, retry.res.body.id);
    assert.deepEqual(availableStock, { onHand: 20, reserved: 6 });
    assert.equal(reservationUpdates, 1);

    const changedRequest = await route({ key, quantity: 3 });
    assert.equal(changedRequest.error?.status, 409);
    assert.equal(changedRequest.error?.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(availableStock.reserved, 6);
    assert.equal(reservationUpdates, 1);
    assert.equal(transfers.size, 1);

    sourceBranchActive = false;
    const inactiveBranchRetry = await route({ key });
    assert.equal(inactiveBranchRetry.error?.status, 400);
    assert.equal(availableStock.reserved, 6);
    assert.equal(reservationUpdates, 1);
    assert.equal(auditEvents.length, 1);
  } finally {
    prisma.$transaction = previousTransaction;
  }
});

test('transfer request recovery does not replay when either branch is inactive', async () => {
  const previousTransaction = prisma.$transaction;
  const previousBranchLookup = prisma.branch.findUnique;
  const previousRawQuery = prisma.$queryRaw;
  const previousTransferLookup = prisma.transferRequest.findUnique;
  let auditEventsRead = 0;
  const key = '2e6bfe06-f33d-4924-bef6-9e6f7913ce67';
  const route = transferRequestRoute();
  prisma.$transaction = async () => { throw Object.assign(new Error('serialization conflict'), { code: 'P2034' }); };
  prisma.$queryRaw = async () => {
    auditEventsRead += 1;
    return [{
      tableName: 'transfer_requests',
      operation: 'INSERT',
      recordId: 101n,
      performedByUserId: 9n,
      oldData: { action: 'TRANSFER_REQUESTED' }
    }];
  };
  prisma.transferRequest.findUnique = async () => ({ id: 101n, items: [] });

  try {
    for (const inactiveBranchId of [1n, 3n]) {
      auditEventsRead = 0;
      prisma.branch.findUnique = async ({ where }) => ({ id: where.id, isActive: where.id !== inactiveBranchId });
      const result = await route({ key });
      assert.equal(result.error?.status, 409);
      assert.match(result.error.message, /both branches to be active/i);
      assert.equal(auditEventsRead, 0);
    }
  } finally {
    prisma.$transaction = previousTransaction;
    prisma.branch.findUnique = previousBranchLookup;
    prisma.$queryRaw = previousRawQuery;
    prisma.transferRequest.findUnique = previousTransferLookup;
  }
});

test('receipt recovery does not replay when either transfer branch is inactive', async () => {
  const previousTransaction = prisma.$transaction;
  const previousBranchLookup = prisma.branch.findUnique;
  const previousEventLookup = prisma.transferReceiptEvent.findUnique;
  const previousTransferLookup = prisma.transferRequest.findUnique;
  const route = receiveRoute();
  prisma.$transaction = async () => { throw Object.assign(new Error('serialization conflict'), { code: 'P2034' }); };
  prisma.transferReceiptEvent.findUnique = async () => ({
    transferItemId: 6n,
    quantity: 1,
    receivedByUserId: 5n,
    transferItem: { transferId: 42n }
  });
  prisma.transferRequest.findUnique = async () => ({
    id: 42n,
    sourceBranchId: 1n,
    destinationBranchId: 3n,
    status: 'completed',
    items: [{ id: 6n, partId: 1n, quantityRequested: 5, quantityApproved: 5, quantityReceived: 1 }]
  });

  try {
    for (const inactiveBranchId of [1n, 3n]) {
      prisma.branch.findUnique = async ({ where }) => ({ id: where.id, isActive: where.id !== inactiveBranchId });
      const result = await route({ key: 'd2eeb023-6d3e-4e75-99e0-52db0f7d8f63', quantity: 1 });
      assert.equal(result.error?.status, 409);
      assert.match(result.error.message, /both branches to be active/i);
      assert.equal(result.res.body, null);
    }
  } finally {
    prisma.$transaction = previousTransaction;
    prisma.branch.findUnique = previousBranchLookup;
    prisma.transferReceiptEvent.findUnique = previousEventLookup;
    prisma.transferRequest.findUnique = previousTransferLookup;
  }
});

test('concurrent identical partial receipt retries change inventory once', async () => {
  const previousTransaction = prisma.$transaction;
  const previousBranchLookup = prisma.branch.findUnique;
  const previousEventLookup = prisma.transferReceiptEvent.findUnique;
  const previousTransferLookup = prisma.transferRequest.findUnique;
  const receiptItem = {
    id: 6n,
    partId: 1n,
    quantityRequested: 5,
    quantityApproved: 5,
    quantityReceived: 0
  };
  const transfer = {
    id: 42n,
    sourceBranchId: 1n,
    destinationBranchId: 3n,
    status: 'dispatched',
    items: [receiptItem]
  };
  const events = new Map();
  const inventory = { quantityOnHand: 25 };
  const key = '86d7c9a5-bc58-48d8-9c44-711c8b92046d';
  const route = receiveRoute();
  let releaseInitialReads;
  const initialReadsComplete = new Promise(resolve => { releaseInitialReads = resolve; });
  let initialReadsRemaining = 2;
  let pendingEvent = null;
  let createAttempts = 0;
  let uniqueConflicts = 0;

  const findEvent = async ({ where, include }) => {
    const event = events.get(where.idempotencyKey);
    if (!event) return null;
    return include ? { ...event, transferItem: { transferId: transfer.id } } : event;
  };
  prisma.transferReceiptEvent.findUnique = findEvent;
  prisma.transferRequest.findUnique = async () => ({ ...transfer, items: [{ ...receiptItem }] });
  prisma.branch.findUnique = async ({ where }) => ({ id: where.id, isActive: true });
  prisma.$transaction = async callback => {
    let stagedEvent = null;
    const transactionFindEvent = async args => {
      const result = await findEvent(args);
      if (initialReadsRemaining > 0) {
        initialReadsRemaining -= 1;
        if (initialReadsRemaining === 0) releaseInitialReads();
        await initialReadsComplete;
      }
      return result;
    };
    const tx = {
      $queryRaw: async () => [],
      branch: { findUnique: async ({ where }) => ({ id: where.id, isActive: true }) },
      transferRequest: {
        findUnique: async () => ({ ...transfer, items: [{ ...receiptItem }] }),
        update: async ({ data }) => {
          transfer.status = data.status;
          return { ...transfer, items: [{ ...receiptItem }] };
        }
      },
      transferReceiptEvent: {
        findUnique: transactionFindEvent,
        create: async ({ data }) => {
          createAttempts += 1;
          if (events.has(data.idempotencyKey)) throw Object.assign(new Error('unique key'), { code: 'P2002' });
          if (pendingEvent) {
            await pendingEvent.committed;
            uniqueConflicts += 1;
            throw Object.assign(new Error('unique key'), { code: 'P2002' });
          }
          let commit;
          const committed = new Promise(resolve => { commit = resolve; });
          pendingEvent = { key: data.idempotencyKey, data, committed, commit };
          stagedEvent = pendingEvent;
          return data;
        }
      },
      inventory: {
        upsert: async ({ update }) => {
          inventory.quantityOnHand += update.quantityOnHand.increment;
          return inventory;
        }
      },
      transferItem: {
        update: async ({ data }) => {
          receiptItem.quantityReceived = data.quantityReceived;
          return receiptItem;
        }
      }
    };
    try {
      const result = await callback(tx);
      if (stagedEvent) {
        events.set(stagedEvent.key, stagedEvent.data);
        pendingEvent = null;
        stagedEvent.commit();
      }
      return result;
    } catch (error) {
      if (stagedEvent) {
        pendingEvent = null;
        stagedEvent.commit();
      }
      throw error;
    }
  };

  try {
    const [first, retry] = await Promise.all([
      route({ key, quantity: 2 }),
      route({ key, quantity: 2 })
    ]);

    assert.equal(first.error, undefined);
    assert.equal(retry.error, undefined);
    assert.equal(first.res.body.items[0].quantityReceived, 2);
    assert.equal(retry.res.body.items[0].quantityReceived, 2);
    assert.equal(inventory.quantityOnHand, 27);
    assert.equal(events.size, 1);
    assert.equal(createAttempts, 2);
    assert.equal(uniqueConflicts, 1);

    const mismatchedQuantity = await route({ key, quantity: 1 });
    assert.equal(mismatchedQuantity.error?.status, 409);
    assert.equal(mismatchedQuantity.error?.code, 'IDEMPOTENCY_KEY_REUSED');

    const differentUser = await route({ userId: 7n, key, quantity: 2 });
    assert.equal(differentUser.error?.status, 409);
    assert.equal(differentUser.error?.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(inventory.quantityOnHand, 27);

    const intentionalSecondReceipt = await route({
      key: 'da3c98ab-06dc-4db4-9d43-cb5bc24816ca',
      quantity: 1
    });
    assert.equal(intentionalSecondReceipt.error, undefined);
    assert.equal(intentionalSecondReceipt.res.body.items[0].quantityReceived, 3);
    assert.equal(inventory.quantityOnHand, 28);
    assert.equal(events.size, 2);
  } finally {
    prisma.$transaction = previousTransaction;
    prisma.branch.findUnique = previousBranchLookup;
    prisma.transferReceiptEvent.findUnique = previousEventLookup;
    prisma.transferRequest.findUnique = previousTransferLookup;
  }
});
