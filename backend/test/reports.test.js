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

async function requestDailySales({ role, branchId, query = {} }) {
  const registered = router.stack.find(layer => layer.route?.path === '/reports/daily-sales' && layer.route.methods.get);
  assert.ok(registered, 'daily sales route is registered');
  const req = { user: { id: 9n, role, branchId }, query };
  const res = responseDouble();
  let routeError;
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  authorize(req, res, error => { routeError = error; });
  if (!routeError && res.statusCode === null) {
    await handler(req, res, error => { routeError = error; });
  }
  return { req, res, error: routeError };
}

test('Admin sales report honors the selected branch and returns consistent totals', async () => {
  const previousFindMany = prisma.workOrder.findMany;
  const previousTimeZone = process.env.BUSINESS_TIME_ZONE;
  process.env.BUSINESS_TIME_ZONE = 'Asia/Manila';
  let findManyArgs;
  prisma.workOrder.findMany = async args => {
    findManyArgs = args;
    return [{
      id: 15n,
      number: 'WO-TEST-15',
      branchId: 1n,
      branch: { name: 'Test Branch' },
      customerName: 'Test Customer',
      status: 'completed',
      laborFee: 10.1,
      totalAmount: 30.3,
      items: [{ part: { name: 'Test Part' }, quantityUsed: 1, subtotal: 20.2 }]
    }];
  };

  try {
    const { res, error } = await requestDailySales({
      role: 'head_office_admin',
      branchId: null,
      query: { date: '2026-10-27', branchId: '1' }
    });
    assert.equal(error, undefined);
    assert.equal(res.statusCode, null);
    assert.equal(findManyArgs.where.branchId, 1n);
    assert.equal(findManyArgs.where.status, 'completed');
    assert.equal(findManyArgs.where.completedAt.gte.toISOString(), '2026-10-26T16:00:00.000Z');
    assert.equal(findManyArgs.where.completedAt.lt.toISOString(), '2026-10-27T16:00:00.000Z');
    assert.equal(res.body.date, '2026-10-27');
    assert.equal(res.body.workOrderCount, 1);
    assert.deepEqual(
      { repairBillings: res.body.repairBillings, partsRevenue: res.body.partsRevenue, laborRevenue: res.body.laborRevenue },
      { repairBillings: 30.3, partsRevenue: 20.2, laborRevenue: 10.1 }
    );
  } finally {
    prisma.workOrder.findMany = previousFindMany;
    if (previousTimeZone === undefined) delete process.env.BUSINESS_TIME_ZONE;
    else process.env.BUSINESS_TIME_ZONE = previousTimeZone;
  }
});

test('Branch Manager sales reports stay on the assigned branch', async () => {
  const previousFindMany = prisma.workOrder.findMany;
  let queried = false;
  prisma.workOrder.findMany = async args => {
    queried = true;
    assert.equal(args.where.branchId, 3n);
    return [];
  };

  try {
    const ownBranch = await requestDailySales({ role: 'branch_manager', branchId: 3n, query: { date: '2026-10-27' } });
    assert.equal(ownBranch.error, undefined);
    assert.equal(ownBranch.res.body.workOrderCount, 0);
    assert.equal(queried, true);

    queried = false;
    const otherBranch = await requestDailySales({
      role: 'branch_manager',
      branchId: 3n,
      query: { date: '2026-10-27', branchId: '1' }
    });
    assert.equal(otherBranch.error?.status, 403);
    assert.equal(queried, false);
  } finally {
    prisma.workOrder.findMany = previousFindMany;
  }
});
