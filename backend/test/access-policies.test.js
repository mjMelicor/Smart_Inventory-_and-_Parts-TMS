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

function routeHandler(path, method) {
  const layer = router.stack.find(entry => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack.at(-1).handle;
}

async function invoke(path, method, user, { query = {}, params = {} } = {}) {
  const res = responseDouble();
  let error;
  await routeHandler(path, method)({ user, query, params }, res, caught => { error = caught; });
  return { res, error };
}

const userFor = (role, overrides = {}) => ({
  id: 8n,
  role,
  branchId: 3n,
  branchIsActive: true,
  ...overrides
});

test('Technicians can search inventory across branches, but receive no wholesale costs or supplier IDs', async () => {
  const previousPartFindMany = prisma.part.findMany;
  const previousInventoryFindMany = prisma.inventory.findMany;
  let partQuery;
  let inventoryQuery;
  prisma.part.findMany = async args => {
    partQuery = args;
    return [{
      id: 1n,
      partNumber: 'P-1',
      name: 'Test Part',
      description: '',
      category: 'Test',
      unitOfMeasure: 'each',
      wholesaleCost: 12,
      retailPrice: 18,
      supplier: { id: 4n, companyName: 'Test Supplier' },
      inventory: [{ branchId: 2n, branch: { name: 'Other Branch' }, quantityOnHand: 5, quantityReserved: 1, reorderLevel: 2 }]
    }];
  };
  prisma.inventory.findMany = async args => {
    inventoryQuery = args;
    return [{
      id: 5n,
      branchId: 2n,
      branch: { name: 'Other Branch' },
      partId: 1n,
      part: {
        partNumber: 'P-1',
        name: 'Test Part',
        category: 'Test',
        wholesaleCost: 12,
        retailPrice: 18,
        supplier: { companyName: 'Test Supplier' }
      },
      quantityOnHand: 5,
      quantityReserved: 1,
      reorderLevel: 2
    }];
  };

  try {
    const user = userFor('technician', { branchIsActive: false });
    const parts = await invoke('/parts', 'get', user);
    assert.equal(parts.error, undefined);
    assert.equal(partQuery.include.inventory.where, undefined);
    assert.equal('wholesaleCost' in parts.res.body[0], false);
    assert.equal(parts.res.body[0].retailPrice, 18);
    assert.deepEqual(parts.res.body[0].supplier, { name: 'Test Supplier' });
    assert.equal(parts.res.body[0].inventory[0].branchName, 'Other Branch');

    const inventory = await invoke('/inventory', 'get', user, { query: { branchId: '2' } });
    assert.equal(inventory.error, undefined);
    assert.equal(inventoryQuery.where.branchId, 2n);
    assert.equal('wholesaleCost' in inventory.res.body[0], false);
    assert.equal(inventory.res.body[0].retailPrice, 18);
    assert.equal(inventory.res.body[0].supplier, 'Test Supplier');
  } finally {
    prisma.part.findMany = previousPartFindMany;
    prisma.inventory.findMany = previousInventoryFindMany;
  }
});

test('Managers and Head Office Admin retain wholesale costs while supplier IDs remain limited to the admin catalog', async () => {
  const previousPartFindMany = prisma.part.findMany;
  const previousInventoryFindMany = prisma.inventory.findMany;
  prisma.part.findMany = async () => [{
    id: 1n,
    partNumber: 'P-1',
    name: 'Test Part',
    description: '',
    category: 'Test',
    unitOfMeasure: 'each',
    wholesaleCost: 12,
    retailPrice: 18,
    supplier: { id: 4n, companyName: 'Test Supplier' },
    inventory: []
  }];
  prisma.inventory.findMany = async () => [{
    id: 5n,
    branchId: 3n,
    branch: { name: 'Assigned Branch' },
    partId: 1n,
    part: {
      partNumber: 'P-1',
      name: 'Test Part',
      category: 'Test',
      wholesaleCost: 12,
      retailPrice: 18,
      supplier: { companyName: 'Test Supplier' }
    },
    quantityOnHand: 5,
    quantityReserved: 1,
    reorderLevel: 2
  }];

  try {
    const manager = userFor('branch_manager');
    const managerParts = await invoke('/parts', 'get', manager);
    const managerInventory = await invoke('/inventory', 'get', manager);
    assert.equal(managerParts.res.body[0].wholesaleCost, 12);
    assert.equal(managerParts.res.body[0].supplier.id, undefined);
    assert.equal(managerInventory.res.body[0].wholesaleCost, 12);
    assert.equal(managerInventory.res.body[0].supplier, 'Test Supplier');

    const admin = userFor('head_office_admin', { branchId: null, branchIsActive: false });
    const adminParts = await invoke('/parts', 'get', admin);
    const adminInventory = await invoke('/inventory', 'get', admin);
    assert.equal(adminParts.res.body[0].wholesaleCost, 12);
    assert.equal(adminParts.res.body[0].supplier.id, '4');
    assert.equal(adminInventory.res.body[0].wholesaleCost, 12);
  } finally {
    prisma.part.findMany = previousPartFindMany;
    prisma.inventory.findMany = previousInventoryFindMany;
  }
});

test('Inactive managers are blocked from branch inventory while Head Office Admins retain cross-branch access', async () => {
  const previousInventoryFindMany = prisma.inventory.findMany;
  let queryCount = 0;
  prisma.inventory.findMany = async () => {
    queryCount += 1;
    return [];
  };
  try {
    const manager = await invoke('/inventory', 'get', userFor('branch_manager', { branchIsActive: false }));
    assert.equal(manager.error?.status, 403);
    assert.equal(queryCount, 0);

    const admin = await invoke('/inventory', 'get', userFor('head_office_admin', { branchId: null }));
    assert.equal(admin.error, undefined);
    assert.equal(queryCount, 1);
  } finally {
    prisma.inventory.findMany = previousInventoryFindMany;
  }
});

test('Work-order and transfer part projections omit technician wholesale cost and unnecessary supplier IDs', async () => {
  const previousWorkOrderFindMany = prisma.workOrder.findMany;
  const previousTransferFindMany = prisma.transferRequest.findMany;
  let workOrderQuery;
  let transferQuery;
  prisma.workOrder.findMany = async args => {
    workOrderQuery = args;
    const select = args.include.items.include.part.select;
    return [{
      id: 42n,
      branchId: 3n,
      items: [{
        part: {
          name: 'Test Part',
          retailPrice: 18,
          supplier: { companyName: 'Test Supplier' },
          ...(select.wholesaleCost ? { wholesaleCost: 12 } : {})
        }
      }],
      assignedTechnician: { id: 8n, firstName: 'Test', lastName: 'Tech' }
    }];
  };
  prisma.transferRequest.findMany = async args => {
    transferQuery = args;
    const select = args.include.items.include.part.select;
    return [{
      items: [{
        part: {
          name: 'Test Part',
          retailPrice: 18,
          supplier: { companyName: 'Test Supplier' },
          ...(select.wholesaleCost ? { wholesaleCost: 12 } : {})
        }
      }]
    }];
  };

  try {
    const technician = userFor('technician');
    const workOrders = await invoke('/work-orders', 'get', technician);
    const transfers = await invoke('/transfers', 'get', technician);
    assert.equal(workOrderQuery.where.branchId, 3n);
    assert.equal(workOrderQuery.include.items.include.part.select.wholesaleCost, undefined);
    assert.equal(workOrders.res.body[0].items[0].part.wholesaleCost, undefined);
    assert.equal(workOrders.res.body[0].items[0].part.retailPrice, 18);
    assert.equal(workOrders.res.body[0].items[0].part.supplier.companyName, 'Test Supplier');
    assert.equal(workOrders.res.body[0].assignedTechnician.email, undefined);
    assert.equal(transferQuery.include.items.include.part.select.wholesaleCost, undefined);
    assert.equal(transfers.res.body[0].items[0].part.wholesaleCost, undefined);
    assert.equal(transfers.res.body[0].items[0].part.supplier.companyName, 'Test Supplier');

    const managerWorkOrders = await invoke('/work-orders', 'get', userFor('branch_manager'));
    const adminWorkOrders = await invoke('/work-orders', 'get', userFor('head_office_admin', { branchId: null }));
    assert.equal(managerWorkOrders.res.body[0].items[0].part.wholesaleCost, 12);
    assert.equal(adminWorkOrders.res.body[0].items[0].part.wholesaleCost, 12);
    assert.equal(adminWorkOrders.res.body[0].assignedTechnician.email, undefined);
  } finally {
    prisma.workOrder.findMany = previousWorkOrderFindMany;
    prisma.transferRequest.findMany = previousTransferFindMany;
  }
});

test('role-scoped work-order queries block inactive branches and leave admin scope unrestricted', async () => {
  const previousWorkOrderFindMany = prisma.workOrder.findMany;
  const previousUserFindMany = prisma.user.findMany;
  let lastQuery;
  prisma.workOrder.findMany = async args => {
    lastQuery = args;
    return [];
  };
  let technicianQuery;
  prisma.user.findMany = async args => {
    technicianQuery = args;
    return [];
  };

  try {
    const inactiveTechnician = await invoke('/work-orders', 'get', userFor('technician', { branchIsActive: false }));
    assert.equal(inactiveTechnician.error?.status, 403);
    assert.equal(lastQuery, undefined);

    const inactiveManagerWorkOrders = await invoke('/work-orders', 'get', userFor('branch_manager', { branchIsActive: false }));
    assert.equal(inactiveManagerWorkOrders.error?.status, 403);
    assert.equal(lastQuery, undefined);

    const inactiveManagerTechnicians = await invoke('/technicians', 'get', userFor('branch_manager', { branchIsActive: false }));
    assert.equal(inactiveManagerTechnicians.error?.status, 403);
    assert.equal(technicianQuery, undefined);

    const activeManagerTechnicians = await invoke('/technicians', 'get', userFor('branch_manager'));
    assert.equal(activeManagerTechnicians.error, undefined);
    assert.equal(technicianQuery.where.branchId, 3n);

    const admin = await invoke('/work-orders', 'get', userFor('head_office_admin', { branchId: null }));
    assert.equal(admin.error, undefined);
    assert.equal(lastQuery.where.branchId, undefined);

    const adminTechnicians = await invoke('/technicians', 'get', userFor('head_office_admin', { branchId: null }));
    assert.equal(adminTechnicians.error, undefined);
    assert.equal(technicianQuery.where.branchId, undefined);
  } finally {
    prisma.workOrder.findMany = previousWorkOrderFindMany;
    prisma.user.findMany = previousUserFindMany;
  }
});
