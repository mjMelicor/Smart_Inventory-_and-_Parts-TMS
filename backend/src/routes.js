import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { allowRoles, authenticate, requireBranch } from './auth.js';
import { businessDateRange, dateInTimeZone } from './businessDate.js';
import { prisma } from './db.js';
import { dailySalesTotals, moneyCents } from './money.js';
import { credentialVersion } from './tokenVersion.js';

export const router = express.Router();

const roles = ['technician', 'branch_manager', 'head_office_admin'];
const idParam = z.coerce.bigint().positive();
const idValue = value => idParam.parse(value);
const hashCode = value => createHash('sha256').update(value).digest('hex');
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const receiptIdempotencyKey = z.string().uuid();
const receiptConflict = (code, message) => Object.assign(new Error(message), { status: 409, code });
const isSerializationConflict = error => [error?.code, error?.meta?.code, error?.cause?.code].some(code => code === 'P2034' || code === '40001');
// Audit-backed retries must read the event after acquiring this lock. Their
// transactions use READ COMMITTED so that read gets a fresh snapshot if it had
// to wait for another request with the same key to commit.
const lockIdempotencyKey = (tx, key) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
const findIdempotencyAuditEvent = async (client, userId, key) => {
  const rows = await client.$queryRaw`
    SELECT table_name AS "tableName", operation, record_id AS "recordId",
           performed_by_user_id AS "performedByUserId", old_data AS "oldData"
    FROM audit_logs
    WHERE performed_by_user_id = ${userId}
      AND (old_data->>'idempotencyKey' = ${key} OR old_data->'details'->>'idempotencyKey' = ${key})
    ORDER BY CASE
      WHEN (table_name = 'transfer_requests' AND operation = 'INSERT' AND old_data->>'action' = 'TRANSFER_REQUESTED')
        OR (table_name = 'work_order_items' AND operation = 'INSERT' AND old_data->>'action' = 'PART_USED')
        OR (table_name = 'work_orders' AND operation = 'INSERT' AND old_data->>'action' = 'WORK_ORDER_CREATED')
        OR (table_name = 'suppliers' AND operation = 'INSERT' AND old_data->>'action' = 'SUPPLIER_CREATED')
      THEN 0
      WHEN table_name = 'inventory' AND operation = 'UPDATE' AND old_data->'details'->>'action' = 'STOCK_ADJUSTED'
      THEN 1 ELSE 2 END,
      timestamp ASC
    LIMIT 1
  `;
  return rows[0] || null;
};
const receiptEventMatches = (event, { transferId, transferItemId, quantity, userId }) =>
  event.transferItem.transferId === transferId
  && event.transferItemId === transferItemId
  && event.quantity === quantity
  && event.receivedByUserId === userId;
const receiptEventInclude = { transferItem: { select: { transferId: true } } };
const setAuditContext = (tx, userId, details = {}) => tx.$queryRaw`
  SELECT
    set_config('app.user_id', ${String(userId)}, true),
    set_config('app.audit_details', ${JSON.stringify(details)}, true)
`;
const auditJsonValue = value => typeof value === 'bigint' ? String(value)
  : value instanceof Date ? value.toISOString()
    : typeof value?.toNumber === 'function' ? value.toNumber()
      : value;
const auditChanges = input => Object.fromEntries(Object.entries(input).map(([key, value]) => [key, auditJsonValue(value)]));
const auditPreviousValues = (current, input) => Object.fromEntries(Object.keys(input).map(key => [key, auditJsonValue(current[key])]));
const businessTimeZone = () => process.env.BUSINESS_TIME_ZONE || 'Asia/Manila';
const publicUser = user => ({
  id: String(user.id),
  firstName: user.firstName,
  lastName: user.lastName,
  name: `${user.firstName} ${user.lastName}`,
  email: user.email,
  role: user.role,
  branchId: user.branchId == null ? null : String(user.branchId),
  branch: user.branch?.name ?? null,
  isActive: user.isActive
});
const publicUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  branchId: true,
  isActive: true
};
const stockAccess = (user, branchId) => requireBranch({ user }, branchId);
const setRoleScope = (user, query, field = 'branchId') => {
  if (user.role !== 'head_office_admin') query[field] = user.branchId;
  return query;
};

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(128)
});
const registerSchema = z.object({
  firstName: z.string().trim().min(1).max(75),
  lastName: z.string().trim().min(1).max(75),
  email: z.string().trim().email().max(255).transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
  role: z.enum(roles).default('technician'),
  branchId: z.union([z.coerce.bigint().positive(), z.null()]).optional(),
  setupCode: z.string().trim().optional()
});

router.post('/auth/login', wrap(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() }, include: { branch: true } });
  if (!user?.isActive || !await bcrypt.compare(input.password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  const token = jwt.sign({
    sub: String(user.id),
    credentialVersion: credentialVersion(user.passwordHash, process.env.JWT_SECRET)
  }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
  res.json({ token, user: publicUser(user) });
}));

router.post('/auth/register', wrap(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const code = input.setupCode;
  const role = input.role;
  if (role !== 'technician' && !code) return res.status(400).json({ error: 'A valid Head Office setup code is required for this role.' });
  if (role === 'technician' && !input.branchId) return res.status(400).json({ error: 'Select a home branch.' });
  if (role === 'head_office_admin' && input.branchId) return res.status(400).json({ error: 'Head Office administrators cannot be assigned to a branch.' });

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.$transaction(async tx => {
    let invite = null;
    if (role !== 'technician') {
      invite = await tx.setupCode.findUnique({ where: { codeHash: hashCode(code) } });
      if (!invite || invite.role !== role || invite.usedAt || invite.expiresAt <= new Date()) {
        const error = new Error('The setup code is invalid, expired, or already used.');
        error.status = 403;
        throw error;
      }
      if (role === 'branch_manager' && String(invite.branchId) !== String(input.branchId)) {
        const error = new Error('The setup code is not valid for the selected branch.');
        error.status = 403;
        throw error;
      }
      if (role === 'head_office_admin' && input.branchId) {
        const error = new Error('Head Office administrators cannot be assigned to a branch.');
        error.status = 400;
        throw error;
      }
      const used = await tx.setupCode.updateMany({
        where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() }
      });
      if (used.count !== 1) {
        const error = new Error('The setup code has already been used.');
        error.status = 409;
        throw error;
      }
    }
    if (input.branchId) {
      const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
      if (!branch?.isActive) {
        const error = new Error('Select an active branch.');
        error.status = 400;
        throw error;
      }
    }
    const created = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordHash,
        role,
        branchId: role === 'head_office_admin' ? null : input.branchId
      },
      include: { branch: true }
    });
    await tx.auditLog.create({
      data: {
        tableName: 'users', operation: 'INSERT', recordId: created.id,
        branchId: created.branchId, performedByUserId: created.id,
        oldData: { action: 'ACCOUNT_REGISTERED', role: created.role }
      }
    });
    return created;
  });
  res.status(201).json({ user: publicUser(user) });
}));

router.get('/branches', wrap(async (_req, res) => {
  const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json(branches.map(branch => ({ id: String(branch.id), code: branch.code, name: branch.name, address: branch.address, phone: branch.phone, isActive: branch.isActive })));
}));

router.use(authenticate);

router.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/auth/change-password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/)
  }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !await bcrypt.compare(currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.auditLog.create({
      data: {
        tableName: 'users', operation: 'UPDATE', recordId: user.id,
        branchId: user.branchId, performedByUserId: req.user.id,
        oldData: { action: 'PASSWORD_CHANGED' }
      }
    });
  });
  res.json({ message: 'Password updated.' });
}));

router.get('/inventory', wrap(async (req, res) => {
  const branchId = req.query.branchId ? idValue(req.query.branchId) : req.user.branchId;
  if (!branchId && req.user.role !== 'head_office_admin') return res.status(400).json({ error: 'A branch is required.' });
  if (branchId) stockAccess(req.user, branchId);
  const where = branchId ? { branchId } : {};
  if (req.query.lowStock === 'true') where.reorderLevel = { gt: 0 };
  const rows = await prisma.inventory.findMany({
    where,
    include: { branch: true, part: { include: { supplier: true } } },
    orderBy: [{ branch: { name: 'asc' } }, { part: { name: 'asc' } }]
  });
  const output = rows.map(row => ({
    id: String(row.id),
    branchId: String(row.branchId),
    branchName: row.branch.name,
    partId: String(row.partId),
    partNumber: row.part.partNumber,
    partName: row.part.name,
    category: row.part.category,
    supplier: row.part.supplier.companyName,
    wholesaleCost: Number(row.part.wholesaleCost),
    retailPrice: Number(row.part.retailPrice),
    quantityOnHand: row.quantityOnHand,
    quantityReserved: row.quantityReserved,
    quantityAvailable: row.quantityOnHand - row.quantityReserved,
    reorderLevel: row.reorderLevel,
    lowStock: row.reorderLevel > 0 && row.quantityOnHand - row.quantityReserved <= row.reorderLevel,
    shelfBinLocation: row.shelfBinLocation,
    updatedAt: row.updatedAt
  })).filter(row => req.query.lowStock !== 'true' || row.lowStock);
  res.json(output);
}));

router.get('/technicians', allowRoles('branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const where = setRoleScope(req.user, { role: 'technician', isActive: true });
  if (req.query.branchId) {
    const branchId = idValue(req.query.branchId);
    requireBranch(req, branchId);
    where.branchId = branchId;
  }
  const technicians = await prisma.user.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, email: true, branchId: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
  });
  res.json(technicians.map(user => ({ ...user, id: String(user.id), branchId: user.branchId == null ? null : String(user.branchId) })));
}));

router.get('/parts', wrap(async (req, res) => {
  if (req.user.role === 'branch_manager' && !req.user.branchId) {
    return res.status(403).json({ error: 'Your account must have an assigned branch to view inventory.' });
  }
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const parts = await prisma.part.findMany({
    where: {
      ...(search ? { OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { partNumber: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } }
      ] } : {}),
      ...(req.query.category ? { category: String(req.query.category) } : {})
    },
    include: {
      supplier: true,
      inventory: {
        ...(req.user.role === 'branch_manager' ? { where: { branchId: req.user.branchId } } : {}),
        include: { branch: true }
      }
    },
    orderBy: { name: 'asc' }
  });
  res.json(parts.map(part => ({
    id: String(part.id),
    partNumber: part.partNumber,
    name: part.name,
    description: part.description,
    category: part.category,
    unitOfMeasure: part.unitOfMeasure,
    wholesaleCost: Number(part.wholesaleCost),
    retailPrice: Number(part.retailPrice),
    supplier: { id: String(part.supplier.id), name: part.supplier.companyName },
    inventory: part.inventory.map(stock => ({
        branchId: String(stock.branchId),
        branchName: stock.branch.name,
        quantityOnHand: stock.quantityOnHand,
        quantityReserved: stock.quantityReserved,
        quantityAvailable: stock.quantityOnHand - stock.quantityReserved,
        reorderLevel: stock.reorderLevel,
        shelfBinLocation: stock.shelfBinLocation
      }))
  })));
}));

const workOrderInclude = {
  branch: true,
  assignedTechnician: { select: publicUserSelect },
  items: { include: { part: true }, orderBy: { addedAt: 'asc' } }
};
const workOrderVisible = async (user, id) => {
  const workOrder = await prisma.workOrder.findUnique({ where: { id }, include: workOrderInclude });
  if (!workOrder) return null;
  requireBranch({ user }, workOrder.branchId);
  if (user.role === 'technician' && workOrder.assignedTechnicianId !== user.id) {
    const error = new Error('You can only access work orders assigned to you.');
    error.status = 403;
    throw error;
  }
  return workOrder;
};

router.get('/work-orders', wrap(async (req, res) => {
  const where = setRoleScope(req.user, {});
  if (req.user.role === 'technician') where.assignedTechnicianId = req.user.id;
  if (req.query.status) where.status = String(req.query.status);
  const rows = await prisma.workOrder.findMany({ where, include: workOrderInclude, orderBy: { createdAt: 'desc' } });
  res.json(rows);
}));

router.post('/work-orders', allowRoles('branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const input = z.object({
    branchId: z.coerce.bigint().positive(),
    assignedTechnicianId: z.coerce.bigint().positive().optional(),
    customerName: z.string().trim().min(1).max(150),
    customerPhone: z.string().trim().max(20).optional(),
    vehicleVinOrPlate: z.string().trim().min(1).max(50),
    vehicleModel: z.string().trim().max(150).optional(),
    laborFee: z.coerce.number().min(0).max(9999999999)
  }).parse(req.body);
  const idempotencyKey = receiptIdempotencyKey.parse(req.get('Idempotency-Key'));
  requireBranch(req, input.branchId);
  const requestFingerprint = hashCode(JSON.stringify({
    branchId: String(input.branchId),
    assignedTechnicianId: input.assignedTechnicianId ? String(input.assignedTechnicianId) : null,
    customerName: input.customerName,
    customerPhone: input.customerPhone || null,
    vehicleVinOrPlate: input.vehicleVinOrPlate,
    vehicleModel: input.vehicleModel || null,
    laborFee: input.laborFee
  }));
  const replayFromEvent = async client => {
    const event = await findIdempotencyAuditEvent(client, req.user.id, idempotencyKey);
    if (!event) return null;
    const details = event.oldData || {};
    if (event.tableName !== 'work_orders' || event.operation !== 'INSERT'
      || details.action !== 'WORK_ORDER_CREATED' || details.requestFingerprint !== requestFingerprint) {
      throw receiptConflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used with different work-order details. Review the earlier request before starting over.');
    }
    const existing = await client.workOrder.findUnique({ where: { id: event.recordId }, include: workOrderInclude });
    if (!existing) throw receiptConflict('IDEMPOTENCY_EVENT_MISSING', 'The earlier work order could not be loaded. Contact an administrator before retrying.');
    return existing;
  };

  try {
    const workOrder = await prisma.$transaction(async tx => {
      await lockIdempotencyKey(tx, idempotencyKey);
      const existing = await replayFromEvent(tx);
      if (existing) return existing;
      const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
      if (!branch?.isActive) {
        const error = new Error('Select an active branch.');
        error.status = 400;
        throw error;
      }
      if (input.assignedTechnicianId) {
        const technician = await tx.user.findUnique({ where: { id: input.assignedTechnicianId } });
        if (!technician?.isActive || technician.role !== 'technician' || technician.branchId !== input.branchId) {
          const error = new Error('Assign an active technician from the selected branch.');
          error.status = 400;
          throw error;
        }
      }
      const code = `WO-${input.branchId}-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
      const created = await tx.workOrder.create({
        data: {
          number: code,
          branchId: input.branchId,
          assignedTechnicianId: input.assignedTechnicianId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          vehicleVinOrPlate: input.vehicleVinOrPlate,
          vehicleModel: input.vehicleModel,
          laborFee: input.laborFee,
          totalAmount: input.laborFee
        },
        include: workOrderInclude
      });
      await tx.auditLog.create({
        data: {
          tableName: 'work_orders', operation: 'INSERT', recordId: created.id,
          branchId: input.branchId, performedByUserId: req.user.id,
          oldData: { action: 'WORK_ORDER_CREATED', requestFingerprint, idempotencyKey }
        }
      });
      return created;
    }, { isolationLevel: 'ReadCommitted' });
    return res.status(201).json(workOrder);
  } catch (error) {
    if (isSerializationConflict(error)) {
      const existing = await replayFromEvent(prisma);
      if (existing) return res.status(201).json(existing);
      return res.status(409).json({
        code: 'WORK_ORDER_CREATE_CONFLICT',
        error: 'A concurrent database change prevented this work order. Retry it with the same Idempotency-Key.'
      });
    }
    throw error;
  }
}));

router.get('/work-orders/:id', wrap(async (req, res) => {
  const workOrder = await workOrderVisible(req.user, idValue(req.params.id));
  if (!workOrder) return res.status(404).json({ error: 'Work order not found.' });
  res.json(workOrder);
}));

router.patch('/work-orders/:id', allowRoles('branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const input = z.object({
    assignedTechnicianId: z.union([z.coerce.bigint().positive(), z.null()]).optional(),
    customerName: z.string().trim().min(1).max(150).optional(),
    customerPhone: z.string().trim().max(20).nullable().optional(),
    vehicleVinOrPlate: z.string().trim().min(1).max(50).optional(),
    vehicleModel: z.string().trim().max(150).nullable().optional(),
    laborFee: z.coerce.number().min(0).max(9999999999).optional()
  }).refine(value => Object.keys(value).length > 0, 'Provide at least one field to update.').parse(req.body);
  const id = idValue(req.params.id);
  try {
    const workOrder = await prisma.$transaction(async tx => {
      const current = await tx.workOrder.findUnique({ where: { id }, include: workOrderInclude });
      if (!current) {
        const error = new Error('Work order not found.');
        error.status = 404;
        throw error;
      }
      requireBranch(req, current.branchId);
      if (!['open', 'in_progress'].includes(current.status)) {
        throw receiptConflict('WORK_ORDER_STATUS_CONFLICT', 'Only open or in-progress work orders can be edited.');
      }
      const nextTechnicianId = input.assignedTechnicianId === undefined ? current.assignedTechnicianId : input.assignedTechnicianId;
      if (input.assignedTechnicianId !== undefined && nextTechnicianId) {
        const technician = await tx.user.findUnique({ where: { id: nextTechnicianId } });
        if (!technician?.isActive || technician.role !== 'technician' || technician.branchId !== current.branchId) {
          const error = new Error('Assign an active technician from the work order branch.');
          error.status = 400;
          throw error;
        }
      }
      const data = { ...input };
      if (input.laborFee !== undefined) {
        const oldLaborCents = Math.round(Number(current.laborFee) * 100);
        const newLaborCents = Math.round(input.laborFee * 100);
        const totalCents = Math.round(Number(current.totalAmount) * 100) + newLaborCents - oldLaborCents;
        if (totalCents < 0 || totalCents > 999999999999) {
          const error = new Error('The updated labor fee and used parts exceed the maximum supported work-order billing amount.');
          error.status = 400;
          throw error;
        }
        data.totalAmount = totalCents / 100;
      }
      const updated = await tx.workOrder.update({ where: { id }, data, include: workOrderInclude });
      const auditChanges = Object.fromEntries(Object.entries(input).map(([field, value]) => [field, typeof value === 'bigint' ? String(value) : value]));
      const previousValues = Object.fromEntries(Object.keys(input).map(field => [
        field,
        field === 'laborFee' ? Number(current[field])
          : field === 'assignedTechnicianId' && current[field] != null ? String(current[field])
            : current[field]
      ]));
      await tx.auditLog.create({
        data: {
          tableName: 'work_orders', operation: 'UPDATE', recordId: id,
          branchId: current.branchId, performedByUserId: req.user.id,
          oldData: { action: 'WORK_ORDER_DETAILS_UPDATED', changes: auditChanges, previousValues }
        }
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
    return res.json(workOrder);
  } catch (error) {
    if (isSerializationConflict(error)) {
      return res.status(409).json({ code: 'WORK_ORDER_UPDATE_CONFLICT', error: 'The work order changed at the same time. Reload it before editing again.' });
    }
    throw error;
  }
}));

router.post('/work-orders/:id/items', allowRoles('technician', 'branch_manager'), wrap(async (req, res) => {
  const { partId, quantity } = z.object({
    partId: z.coerce.bigint().positive(),
    quantity: z.coerce.number().int().positive().max(100000)
  }).parse(req.body);
  const idempotencyKey = receiptIdempotencyKey.parse(req.get('Idempotency-Key'));
  const workOrderId = idValue(req.params.id);
  const requestFingerprint = hashCode(JSON.stringify({
    workOrderId: String(workOrderId),
    partId: String(partId),
    quantity
  }));
  const replayFromEvent = async client => {
    const event = await findIdempotencyAuditEvent(client, req.user.id, idempotencyKey);
    if (!event) return null;
    const details = event.oldData || {};
    if (event.tableName !== 'work_order_items' || event.operation !== 'INSERT'
      || details.action !== 'PART_USED' || details.requestFingerprint !== requestFingerprint) {
      throw receiptConflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used with different part-usage details. Review the earlier action before starting over.');
    }
    const existing = await client.workOrderItem.findUnique({ where: { id: event.recordId } });
    if (!existing) throw receiptConflict('IDEMPOTENCY_EVENT_MISSING', 'The earlier part-usage record could not be loaded. Contact an administrator before retrying.');
    return existing;
  };

  try {
    const result = await prisma.$transaction(async tx => {
      await lockIdempotencyKey(tx, idempotencyKey);
      const workOrder = await tx.workOrder.findUnique({ where: { id: workOrderId } });
      if (!workOrder) {
        const error = new Error('Work order not found.');
        error.status = 404;
        throw error;
      }
      requireBranch(req, workOrder.branchId);
      if (req.user.role === 'technician' && workOrder.assignedTechnicianId !== req.user.id) {
        const error = new Error('You can only record parts on work orders assigned to you.');
        error.status = 403;
        throw error;
      }
      const existing = await replayFromEvent(tx);
      if (existing) return existing;
      if (['completed', 'cancelled'].includes(workOrder.status)) {
        const error = new Error('Parts cannot be added to a completed or cancelled work order.');
        error.status = 409;
        throw error;
      }
      const locked = await tx.$queryRaw`
        SELECT quantity_on_hand, quantity_reserved
        FROM inventory
        WHERE branch_id = ${workOrder.branchId} AND part_id = ${partId}
        FOR UPDATE
      `;
      const stock = locked[0];
      if (!stock || Number(stock.quantity_on_hand - stock.quantity_reserved) < quantity) {
        const error = new Error(`Insufficient available stock. Available: ${stock ? Number(stock.quantity_on_hand - stock.quantity_reserved) : 0}.`);
        error.status = 409;
        throw error;
      }
      const part = await tx.part.findUnique({ where: { id: partId } });
      if (!part) {
        const error = new Error('Part not found.');
        error.status = 404;
        throw error;
      }
      const unitPriceCents = Math.round(Number(part.retailPrice) * 100);
      const subtotalCents = unitPriceCents * quantity;
      const maxMoneyCents = 999999999999;
      const currentTotalCents = Math.round(Number(workOrder.totalAmount) * 100);
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > maxMoneyCents || currentTotalCents + subtotalCents > maxMoneyCents) {
        const error = new Error('This part usage would exceed the maximum supported work-order billing amount.');
        error.status = 409;
        throw error;
      }
      const subtotal = subtotalCents / 100;
      const item = await tx.workOrderItem.create({
        data: { workOrderId, partId, quantityUsed: quantity, unitPriceCharged: part.retailPrice, subtotal }
      });
      await setAuditContext(tx, req.user.id, {
        action: 'PART_USED',
        partId: String(partId),
        quantity: -quantity,
        workOrderId: String(workOrderId),
        workOrderItemId: String(item.id),
        idempotencyKey,
        requestFingerprint
      });
      await tx.inventory.update({
        where: { branchId_partId: { branchId: workOrder.branchId, partId } },
        data: { quantityOnHand: { decrement: quantity } }
      });
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { status: 'in_progress', totalAmount: { increment: subtotal } }
      });
      await tx.auditLog.create({
        data: {
          tableName: 'work_order_items',
          operation: 'INSERT',
          recordId: item.id,
          branchId: workOrder.branchId,
          performedByUserId: req.user.id,
          oldData: {
            action: 'PART_USED',
            workOrderId: String(workOrderId),
            partId: String(partId),
            quantity,
            idempotencyKey,
            requestFingerprint
          }
        }
      });
      return item;
    }, { isolationLevel: 'ReadCommitted' });
    return res.status(201).json(result);
  } catch (error) {
    if (error?.code === 'P2002' || isSerializationConflict(error)) {
      const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
      if (!workOrder) return res.status(404).json({ error: 'Work order not found.' });
      requireBranch(req, workOrder.branchId);
      if (req.user.role === 'technician' && workOrder.assignedTechnicianId !== req.user.id) {
        return res.status(403).json({ error: 'You can only record parts on work orders assigned to you.' });
      }
      const existing = await replayFromEvent(prisma);
      if (existing) return res.status(201).json(existing);
      if (isSerializationConflict(error)) {
        return res.status(409).json({
          code: 'WORK_ORDER_TRANSACTION_CONFLICT',
          error: 'A concurrent inventory change prevented this part usage. Retry it with the same Idempotency-Key.'
        });
      }
    }
    throw error;
  }
}));

router.patch('/work-orders/:id/status', allowRoles('technician', 'branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const { status } = z.object({ status: z.enum(['open', 'in_progress', 'completed', 'cancelled']) }).parse(req.body);
  const id = idValue(req.params.id);
  try {
    const updated = await prisma.$transaction(async tx => {
      const current = await tx.workOrder.findUnique({ where: { id }, include: workOrderInclude });
      if (!current) {
        const error = new Error('Work order not found.');
        error.status = 404;
        throw error;
      }
      requireBranch(req, current.branchId);
      if (req.user.role === 'technician' && current.assignedTechnicianId !== req.user.id) {
        const error = new Error('You can only update work orders assigned to you.');
        error.status = 403;
        throw error;
      }
      if (current.status === status) return current;
      const allowedNext = {
        open: ['in_progress', 'completed', 'cancelled'],
        in_progress: ['completed', 'cancelled'],
        completed: [],
        cancelled: []
      };
      if (!allowedNext[current.status]?.includes(status)) {
        throw receiptConflict('WORK_ORDER_STATUS_CONFLICT', `A ${current.status} work order cannot be changed to ${status}.`);
      }
      const changed = await tx.workOrder.update({
        where: { id },
        data: { status, completedAt: status === 'completed' ? new Date() : null },
        include: workOrderInclude
      });
      await tx.auditLog.create({
        data: {
          tableName: 'work_orders',
          operation: 'UPDATE',
          recordId: id,
          branchId: current.branchId,
          performedByUserId: req.user.id,
          oldData: { action: 'WORK_ORDER_STATUS_CHANGED', previousStatus: current.status, status }
        }
      });
      return changed;
    }, { isolationLevel: 'Serializable' });
    return res.json(updated);
  } catch (error) {
    if (isSerializationConflict(error)) {
      return res.status(409).json({ code: 'WORK_ORDER_STATUS_CONFLICT', error: 'The work order changed at the same time. Refresh it and try again.' });
    }
    throw error;
  }
}));

router.patch('/users/:id/password', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const { newPassword } = z.object({
    newPassword: z.string()
      .min(8)
      .max(128)
      .regex(/[a-z]/, 'Password must contain a lowercase letter.')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
      .regex(/\d/, 'Password must contain a number.')
  }).parse(req.body);

  const id = idValue(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id }
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id }, data: { passwordHash } });
    await tx.auditLog.create({
      data: {
        tableName: 'users', operation: 'UPDATE', recordId: id,
        branchId: user.branchId, performedByUserId: req.user.id,
        oldData: { action: 'PASSWORD_RESET' }
      }
    });
  });

  res.json({ message: 'Password reset successfully.' });
}));

router.get('/transfers', wrap(async (req, res) => {
  const where = req.user.role === 'head_office_admin' ? {} : req.user.role === 'technician'
    ? { requestedByUserId: req.user.id }
    : { OR: [{ sourceBranchId: req.user.branchId }, { destinationBranchId: req.user.branchId }] };
  if (req.query.status) where.status = String(req.query.status);
  const rows = await prisma.transferRequest.findMany({
    where,
    include: {
      sourceBranch: true,
      destinationBranch: true,
      requestedBy: { select: publicUserSelect },
      approvedBy: { select: publicUserSelect },
      items: { include: { part: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(rows);
}));

router.post('/transfers', allowRoles('technician'), wrap(async (req, res) => {
  const input = z.object({
    partId: z.coerce.bigint().positive(),
    sourceBranchId: z.coerce.bigint().positive(),
    quantity: z.coerce.number().int().positive().max(100000),
    notes: z.string().trim().min(1).max(500)
  }).parse(req.body);
  const idempotencyKey = receiptIdempotencyKey.parse(req.get('Idempotency-Key'));
  if (!req.user.branchId) return res.status(400).json({ error: 'Your account must have an assigned destination branch.' });
  if (input.sourceBranchId === req.user.branchId) return res.status(400).json({ error: 'Source and destination branches must be different.' });
  const requestFingerprint = hashCode(JSON.stringify({
    partId: String(input.partId),
    sourceBranchId: String(input.sourceBranchId),
    destinationBranchId: String(req.user.branchId),
    quantity: input.quantity,
    notes: input.notes
  }));
  const code = `TR-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const replayFromEvent = async client => {
    const event = await findIdempotencyAuditEvent(client, req.user.id, idempotencyKey);
    if (!event) return null;
    const details = event.oldData || {};
    if (event.tableName !== 'transfer_requests' || event.operation !== 'INSERT'
      || details.action !== 'TRANSFER_REQUESTED' || details.requestFingerprint !== requestFingerprint) {
      throw receiptConflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used with different transfer details. Review the earlier request before starting over.');
    }
    const existing = await client.transferRequest.findUnique({ where: { id: event.recordId }, include: { items: true } });
    if (!existing) throw receiptConflict('IDEMPOTENCY_EVENT_MISSING', 'The earlier transfer request could not be loaded. Contact an administrator before retrying.');
    return existing;
  };

  try {
    const transfer = await prisma.$transaction(async tx => {
      await lockIdempotencyKey(tx, idempotencyKey);
      const existing = await replayFromEvent(tx);
      if (existing) return existing;
      const [source, destination, part] = await Promise.all([
        tx.branch.findUnique({ where: { id: input.sourceBranchId } }),
        tx.branch.findUnique({ where: { id: req.user.branchId } }),
        tx.part.findUnique({ where: { id: input.partId } })
      ]);
      if (!source?.isActive || !destination?.isActive) {
        const error = new Error('Both transfer branches must be active.');
        error.status = 400;
        throw error;
      }
      if (!part) {
        const error = new Error('Part not found.');
        error.status = 404;
        throw error;
      }
      await setAuditContext(tx, req.user.id, { action: 'TRANSFER_STOCK_RESERVED', partId: String(input.partId), quantity: input.quantity });
      const reserved = await tx.$executeRaw`
        UPDATE inventory
        SET quantity_reserved = quantity_reserved + ${input.quantity}, updated_at = NOW()
        WHERE branch_id = ${input.sourceBranchId}
          AND part_id = ${input.partId}
          AND quantity_on_hand - quantity_reserved >= ${input.quantity}
      `;
      if (reserved !== 1) {
        const error = new Error('Insufficient available stock at the source branch. The request was not created.');
        error.status = 409;
        throw error;
      }
      const created = await tx.transferRequest.create({
        data: {
          code,
          sourceBranchId: input.sourceBranchId,
          destinationBranchId: req.user.branchId,
          requestedByUserId: req.user.id,
          status: 'pending',
          requestNotes: input.notes,
          items: { create: { partId: input.partId, quantityRequested: input.quantity } }
        },
        include: { items: true }
      });
      await tx.auditLog.create({
        data: {
          tableName: 'transfer_requests',
          operation: 'INSERT',
          recordId: created.id,
          branchId: req.user.branchId,
          performedByUserId: req.user.id,
          oldData: {
            action: 'TRANSFER_REQUESTED',
            sourceBranchId: String(input.sourceBranchId),
            partId: String(input.partId),
            quantity: input.quantity,
            idempotencyKey,
            requestFingerprint
          }
        }
      });
      return created;
    }, { isolationLevel: 'ReadCommitted' });
    return res.status(201).json(transfer);
  } catch (error) {
    if (error?.code === 'P2002' || isSerializationConflict(error)) {
      const existing = await replayFromEvent(prisma);
      if (existing) return res.status(201).json(existing);
      if (isSerializationConflict(error)) {
        return res.status(409).json({
          code: 'TRANSFER_TRANSACTION_CONFLICT',
          error: 'A concurrent change prevented this request. Retry it with the same Idempotency-Key.'
        });
      }
    }
    throw error;
  }
}));

router.patch('/transfers/:id/decision', allowRoles('branch_manager'), wrap(async (req, res) => {
  const input = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().max(500).optional() }).parse(req.body);
  if (input.decision === 'rejected' && !input.reason) return res.status(400).json({ error: 'A reason is required when rejecting a request.' });
  const id = idValue(req.params.id);
  try {
    const transfer = await prisma.$transaction(async tx => {
      await setAuditContext(tx, req.user.id, { action: `TRANSFER_${input.decision.toUpperCase()}`, reason: input.reason || null });
      const current = await tx.transferRequest.findUnique({ where: { id }, include: { items: true } });
      if (!current) {
        const error = new Error('Transfer request not found.');
        error.status = 404;
        throw error;
      }
      requireBranch(req, current.sourceBranchId, 'You can only review transfers sent from your assigned branch.');
      if (current.status !== 'pending') {
        const error = new Error('Only pending transfer requests can be approved or rejected.');
        error.status = 409;
        throw error;
      }
      const stock = await tx.$queryRaw`
        SELECT quantity_reserved, quantity_on_hand
        FROM inventory
        WHERE branch_id = ${current.sourceBranchId} AND part_id = ${current.items[0].partId}
        FOR UPDATE
      `;
      if (!stock[0] || Number(stock[0].quantity_reserved) < current.items[0].quantityRequested) {
        const error = new Error('The reserved stock is no longer available; refresh the request and inspect inventory.');
        error.status = 409;
        throw error;
      }
      if (input.decision === 'rejected') {
        await tx.inventory.update({
          where: { branchId_partId: { branchId: current.sourceBranchId, partId: current.items[0].partId } },
          data: { quantityReserved: { decrement: current.items[0].quantityRequested } }
        });
      }
      const updated = await tx.transferRequest.update({
        where: { id },
        data: {
          status: input.decision,
          approvedByUserId: req.user.id,
          requestNotes: input.decision === 'rejected' ? `${current.requestNotes || ''}\nRejection: ${input.reason}`.trim() : current.requestNotes,
          ...(input.decision === 'approved' ? { items: { updateMany: { where: {}, data: { quantityApproved: current.items[0].quantityRequested } } } } : {})
        },
        include: { items: true }
      });
      await tx.auditLog.create({
        data: {
          tableName: 'transfer_requests',
          operation: 'UPDATE',
          recordId: id,
          branchId: current.sourceBranchId,
          performedByUserId: req.user.id,
          oldData: { action: `TRANSFER_${input.decision.toUpperCase()}`, reason: input.reason || null }
        }
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
    return res.json(transfer);
  } catch (error) {
    if (isSerializationConflict(error)) return res.status(409).json({ code: 'TRANSFER_ACTION_CONFLICT', error: 'The transfer changed at the same time. Refresh it before trying again.' });
    throw error;
  }
}));

router.post('/transfers/:id/dispatch', allowRoles('branch_manager'), wrap(async (req, res) => {
  const id = idValue(req.params.id);
  try {
    const transfer = await prisma.$transaction(async tx => {
      await setAuditContext(tx, req.user.id, { action: 'STOCK_DISPATCHED', transferId: String(id) });
      const current = await tx.transferRequest.findUnique({ where: { id }, include: { items: true } });
      if (!current) {
        const error = new Error('Transfer request not found.');
        error.status = 404;
        throw error;
      }
      requireBranch(req, current.sourceBranchId, 'You can only dispatch transfers from your assigned branch.');
      if (current.status !== 'approved' || current.items.length !== 1) {
        const error = new Error('Only approved transfers with one part item can be dispatched.');
        error.status = 409;
        throw error;
      }
      const item = current.items[0];
      const changed = await tx.$executeRaw`
        UPDATE inventory
        SET quantity_on_hand = quantity_on_hand - ${item.quantityApproved},
            quantity_reserved = quantity_reserved - ${item.quantityRequested},
            updated_at = NOW()
        WHERE branch_id = ${current.sourceBranchId}
          AND part_id = ${item.partId}
          AND quantity_on_hand >= ${item.quantityApproved}
          AND quantity_reserved >= ${item.quantityRequested}
      `;
      if (changed !== 1) {
        const error = new Error('Dispatch blocked because the reserved stock is no longer consistent.');
        error.status = 409;
        throw error;
      }
      return tx.transferRequest.update({ where: { id }, data: { status: 'dispatched' }, include: { items: true } });
    }, { isolationLevel: 'Serializable' });
    return res.json(transfer);
  } catch (error) {
    if (isSerializationConflict(error)) return res.status(409).json({ code: 'TRANSFER_DISPATCH_CONFLICT', error: 'The transfer changed during dispatch. Refresh its status and inventory before trying again.' });
    throw error;
  }
}));

router.post('/transfers/:id/receive', allowRoles('branch_manager'), wrap(async (req, res) => {
  const { quantity } = z.object({ quantity: z.coerce.number().int().positive().max(100000) }).parse(req.body);
  const idempotencyKey = receiptIdempotencyKey.parse(req.get('Idempotency-Key'));
  const id = idValue(req.params.id);
  try {
    const transfer = await prisma.$transaction(async tx => {
      const current = await tx.transferRequest.findUnique({ where: { id }, include: { items: true } });
      if (!current) {
        const error = new Error('Transfer request not found.');
        error.status = 404;
        throw error;
      }
      requireBranch(req, current.destinationBranchId, 'You can only receive transfers at your assigned branch.');

      const existingEvent = await tx.transferReceiptEvent.findUnique({
        where: { idempotencyKey },
        include: receiptEventInclude
      });
      if (existingEvent) {
        const item = current.items.find(row => row.id === existingEvent.transferItemId);
        if (!item || !receiptEventMatches(existingEvent, {
          transferId: current.id,
          transferItemId: item.id,
          quantity,
          userId: req.user.id
        })) {
          throw receiptConflict('IDEMPOTENCY_KEY_REUSED', 'This receipt key was already used with different request details. Start a new receipt attempt only after confirming the earlier attempt.');
        }
        return current;
      }

      if (!['dispatched', 'partially_received'].includes(current.status) || current.items.length !== 1) {
        const error = new Error('Only dispatched transfers can be received.');
        error.status = 409;
        throw error;
      }
      const item = current.items[0];
      if (quantity > item.quantityApproved - item.quantityReceived) {
        const error = new Error(`Received quantity exceeds the ${item.quantityApproved - item.quantityReceived} remaining unit(s).`);
        error.status = 400;
        throw error;
      }

      await tx.transferReceiptEvent.create({
        data: { idempotencyKey, transferItemId: item.id, quantity, receivedByUserId: req.user.id }
      });
      await setAuditContext(tx, req.user.id, {
        action: 'STOCK_RECEIVED',
        transferId: String(id),
        quantity,
        idempotencyKey
      });
      await tx.inventory.upsert({
        where: { branchId_partId: { branchId: current.destinationBranchId, partId: item.partId } },
        create: { branchId: current.destinationBranchId, partId: item.partId, quantityOnHand: quantity },
        update: { quantityOnHand: { increment: quantity } }
      });
      const received = item.quantityReceived + quantity;
      await tx.transferItem.update({ where: { id: item.id }, data: { quantityReceived: received } });
      const status = received === item.quantityApproved ? 'completed' : 'partially_received';
      return tx.transferRequest.update({ where: { id }, data: { status }, include: { items: true } });
    }, { isolationLevel: 'Serializable' });
    return res.json(transfer);
  } catch (error) {
    if (error?.code === 'P2002' || isSerializationConflict(error)) {
      const committedEvent = await prisma.transferReceiptEvent.findUnique({
        where: { idempotencyKey },
        include: receiptEventInclude
      });
      if (committedEvent) {
        if (!receiptEventMatches(committedEvent, {
          transferId: id,
          transferItemId: committedEvent.transferItemId,
          quantity,
          userId: req.user.id
        })) {
          return res.status(409).json({
            code: 'IDEMPOTENCY_KEY_REUSED',
            error: 'This receipt key was already used with different request details.'
          });
        }
        const replay = await prisma.transferRequest.findUnique({ where: { id }, include: { items: true } });
        if (!replay) return res.status(404).json({ error: 'Transfer request not found.' });
        requireBranch(req, replay.destinationBranchId, 'You can only receive transfers at your assigned branch.');
        return res.json(replay);
      }
      if (isSerializationConflict(error)) {
        return res.status(409).json({
          code: 'RECEIPT_TRANSACTION_CONFLICT',
          error: 'A concurrent transfer change prevented this receipt. Retry the same request with the same Idempotency-Key.'
        });
      }
    }
    throw error;
  }
}));

router.patch('/inventory/:branchId/:partId/reorder-level', allowRoles('branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const branchId = idValue(req.params.branchId);
  const partId = idValue(req.params.partId);
  requireBranch(req, branchId);
  const { reorderLevel } = z.object({ reorderLevel: z.coerce.number().int().min(0).max(1000000) }).parse(req.body);
  const inventory = await prisma.$transaction(async tx => {
    await setAuditContext(tx, req.user.id, { action: 'REORDER_LEVEL_CHANGED', partId: String(partId), reorderLevel });
    const updated = await tx.inventory.update({
      where: { branchId_partId: { branchId, partId } },
      data: { reorderLevel }
    });
    await tx.auditLog.create({
      data: {
        tableName: 'inventory',
        operation: 'UPDATE',
        recordId: updated.id,
        branchId,
        performedByUserId: req.user.id,
        oldData: { action: 'REORDER_LEVEL_CHANGED', partId: String(partId), reorderLevel }
      }
    });
    return updated;
  });
  res.json(inventory);
}));

router.post('/inventory/adjustments', allowRoles('branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const { branchId, partId, quantityChange, reason } = z.object({
    branchId: z.coerce.bigint().positive(),
    partId: z.coerce.bigint().positive(),
    quantityChange: z.coerce.number().int().min(-1000000).max(1000000).refine(value => value !== 0, 'Quantity change cannot be zero.'),
    reason: z.string().trim().min(1).max(500)
  }).parse(req.body);
  const idempotencyKey = receiptIdempotencyKey.parse(req.get('Idempotency-Key'));
  requireBranch(req, branchId);
  const requestFingerprint = hashCode(JSON.stringify({
    branchId: String(branchId), partId: String(partId), quantityChange, reason
  }));
  const replayFromEvent = async client => {
    const event = await findIdempotencyAuditEvent(client, req.user.id, idempotencyKey);
    if (!event) return null;
    const details = event.oldData?.details || event.oldData || {};
    if (event.tableName !== 'inventory' || event.operation !== 'UPDATE'
      || details.action !== 'STOCK_ADJUSTED' || details.requestFingerprint !== requestFingerprint) {
      throw receiptConflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used with different inventory adjustment details. Review the earlier adjustment before starting over.');
    }
    const existing = await client.inventory.findUnique({ where: { id: event.recordId } });
    if (!existing) throw receiptConflict('IDEMPOTENCY_EVENT_MISSING', 'The earlier adjustment record could not be loaded. Contact an administrator before retrying.');
    return existing;
  };

  try {
    const inventory = await prisma.$transaction(async tx => {
      await lockIdempotencyKey(tx, idempotencyKey);
      const existing = await replayFromEvent(tx);
      if (existing) return existing;
      await setAuditContext(tx, req.user.id, {
        action: 'STOCK_ADJUSTED', partId: String(partId), quantityChange, reason,
        idempotencyKey, requestFingerprint
      });
      const rows = await tx.$queryRaw`
        SELECT inventory_id, quantity_on_hand, quantity_reserved
        FROM inventory
        WHERE branch_id = ${branchId} AND part_id = ${partId}
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) {
        const error = new Error('Inventory record not found.');
        error.status = 404;
        throw error;
      }
      const nextStock = Number(current.quantity_on_hand) + quantityChange;
      if (nextStock < Number(current.quantity_reserved)) {
        const error = new Error('Adjustment cannot reduce on-hand stock below the amount reserved for transfers.');
        error.status = 409;
        throw error;
      }
      const updated = await tx.inventory.update({
        where: { branchId_partId: { branchId, partId } },
        data: { quantityOnHand: { increment: quantityChange } }
      });
      return updated;
    }, { isolationLevel: 'ReadCommitted' });
    return res.json(inventory);
  } catch (error) {
    if (isSerializationConflict(error)) {
      const existing = await replayFromEvent(prisma);
      if (existing) return res.json(existing);
      return res.status(409).json({
        code: 'INVENTORY_ADJUSTMENT_CONFLICT',
        error: 'A concurrent inventory change prevented this adjustment. Retry it with the same Idempotency-Key.'
      });
    }
    throw error;
  }
}));

router.get('/reports/daily-sales', allowRoles('branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const timeZone = businessTimeZone();
  let dateText;
  try {
    dateText = req.query.date === undefined ? dateInTimeZone(new Date(), timeZone) : req.query.date;
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    return res.status(500).json({ error: 'The configured business time zone is invalid.' });
  }
  let dateRange;
  try {
    dateRange = businessDateRange(dateText, timeZone);
  } catch {
    return res.status(400).json({ error: 'Enter a valid report date and business time zone.' });
  }
  const { start, end } = dateRange;
  const branchId = req.query.branchId ? idValue(req.query.branchId) : req.user.branchId;
  if (req.user.role === 'branch_manager' && !branchId) return res.status(403).json({ error: 'Your account must have an assigned branch to view this report.' });
  if (branchId) stockAccess(req.user, branchId);
  const orders = await prisma.workOrder.findMany({
    where: { status: 'completed', completedAt: { gte: start, lt: end }, ...(branchId ? { branchId } : {}) },
    include: { branch: true, items: { include: { part: true } } },
    orderBy: { createdAt: 'desc' }
  });
  const sales = orders.map(order => {
    const laborFeeCents = moneyCents(order.laborFee);
    const partsTotalCents = order.items.reduce((sum, item) => sum + moneyCents(item.subtotal), 0);
    return {
      workOrderId: String(order.id),
      workOrderNumber: order.number,
      branchId: String(order.branchId),
      branchName: order.branch.name,
      customerName: order.customerName,
      status: order.status,
      laborFee: laborFeeCents / 100,
      partsTotal: partsTotalCents / 100,
      total: moneyCents(order.totalAmount) / 100,
      parts: order.items.map(item => ({ partName: item.part.name, quantity: item.quantityUsed, subtotal: moneyCents(item.subtotal) / 100 }))
    };
  });
  const totals = dailySalesTotals(sales);
  res.json({
    date: dateText,
    workOrderCount: sales.length,
    ...totals,
    sales
  });
}));

router.get('/reports/low-stock', allowRoles('branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const branchId = req.query.branchId ? idValue(req.query.branchId) : req.user.branchId;
  if (req.user.role === 'branch_manager' && !branchId) return res.status(403).json({ error: 'Your account must have an assigned branch to view this report.' });
  if (branchId) stockAccess(req.user, branchId);
  const inventory = await prisma.inventory.findMany({
    where: { reorderLevel: { gt: 0 }, ...(branchId ? { branchId } : {}) },
    include: { branch: true, part: true },
    orderBy: { branch: { name: 'asc' } }
  });
  res.json(inventory.filter(row => row.quantityOnHand - row.quantityReserved <= row.reorderLevel));
}));

router.get('/audit-logs', allowRoles('branch_manager', 'head_office_admin'), wrap(async (req, res) => {
  const where = {};
  if (req.user.role !== 'head_office_admin' && !req.user.branchId) return res.status(403).json({ error: 'Your account must have an assigned branch to view audit logs.' });
  if (req.user.role !== 'head_office_admin') where.branchId = req.user.branchId;
  else if (req.query.branchId) where.branchId = idValue(req.query.branchId);
  const rows = await prisma.auditLog.findMany({
    where,
    include: { branch: true, performedBy: { select: { firstName: true, lastName: true } } },
    orderBy: { timestamp: 'desc' },
    take: Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
  });
  res.json(rows.map(row => ({
    id: String(row.id),
    tableName: row.tableName,
    operation: row.operation,
    recordId: String(row.recordId),
    branch: row.branch?.name ?? null,
    user: row.performedBy ? `${row.performedBy.firstName} ${row.performedBy.lastName}` : null,
    details: row.oldData,
    timestamp: row.timestamp
  })));
}));

router.get('/users', allowRoles('head_office_admin'), wrap(async (_req, res) => {
  const users = await prisma.user.findMany({ include: { branch: true }, orderBy: [{ role: 'asc' }, { lastName: 'asc' }] });
  res.json(users.map(publicUser));
}));

router.post('/users', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const input = z.object({
    firstName: z.string().trim().min(1).max(75),
    lastName: z.string().trim().min(1).max(75),
    email: z.string().trim().email().max(255).transform(value => value.toLowerCase()),
    role: z.enum(roles),
    branchId: z.union([z.coerce.bigint().positive(), z.null()]).optional()
  }).parse(req.body);
  if (input.role === 'head_office_admin' && input.branchId) return res.status(400).json({ error: 'Head Office administrators cannot be assigned to a branch.' });
  if (input.role !== 'head_office_admin' && !input.branchId) return res.status(400).json({ error: 'Select a branch for this user.' });
  if (input.branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: input.branchId } });
    if (!branch?.isActive) return res.status(400).json({ error: 'Select an active branch.' });
  }
  const temporaryPassword = randomBytes(18).toString('base64url');
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({
      data: {
        ...input,
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        branchId: input.role === 'head_office_admin' ? null : input.branchId
      },
      include: { branch: true }
    });
    await tx.auditLog.create({
      data: {
        tableName: 'users', operation: 'INSERT', recordId: created.id,
        branchId: created.branchId, performedByUserId: req.user.id,
        oldData: { action: 'USER_CREATED', role: created.role }
      }
    });
    return created;
  });
  res.status(201).json({ user: publicUser(user), temporaryPassword });
}));

router.patch('/users/:id', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const input = z.object({
    firstName: z.string().trim().min(1).max(75).optional(),
    lastName: z.string().trim().min(1).max(75).optional(),
    role: z.enum(roles).optional(),
    branchId: z.union([z.coerce.bigint().positive(), z.null()]).optional(),
    isActive: z.boolean().optional()
  }).refine(value => Object.keys(value).length > 0).parse(req.body);
  const id = idValue(req.params.id);
  if (id === req.user.id && (input.isActive === false || input.role)) return res.status(400).json({ error: 'You cannot deactivate or change the role of your own account.' });
  try {
    const user = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('smart-inventory:active-admin-count', 0))`;
      const current = await tx.user.findUnique({ where: { id } });
      if (!current) {
        const error = new Error('User not found.');
        error.status = 404;
        throw error;
      }
      const nextRole = input.role || current.role;
      const nextBranch = input.branchId === undefined ? current.branchId : input.branchId;
      if (nextRole === 'head_office_admin' && nextBranch) {
        const error = new Error('Head Office administrators cannot be assigned to a branch.');
        error.status = 400;
        throw error;
      }
      if (nextRole !== 'head_office_admin' && !nextBranch) {
        const error = new Error('Select a branch for this user.');
        error.status = 400;
        throw error;
      }
      if (input.branchId) {
        const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
        if (!branch?.isActive) {
          const error = new Error('Select an active branch.');
          error.status = 400;
          throw error;
        }
      }
      if (current.role === 'head_office_admin' && (nextRole !== 'head_office_admin' || input.isActive === false)) {
        const activeAdmins = await tx.user.count({ where: { role: 'head_office_admin', isActive: true } });
        if (activeAdmins <= 1) {
          const error = new Error('The last active Head Office administrator cannot be deactivated or demoted.');
          error.status = 409;
          throw error;
        }
      }
      const updated = await tx.user.update({
        where: { id },
        data: { ...input, ...(input.role === 'head_office_admin' ? { branchId: null } : {}) },
        include: { branch: true }
      });
      const changes = Object.fromEntries(Object.entries(input).map(([field, value]) => [field, typeof value === 'bigint' ? String(value) : value]));
      await tx.auditLog.create({
        data: {
          tableName: 'users', operation: 'UPDATE', recordId: id,
          branchId: updated.branchId ?? current.branchId,
          performedByUserId: req.user.id,
          oldData: {
            action: 'USER_UPDATED', changes,
            previousRole: current.role,
            previousBranchId: current.branchId == null ? null : String(current.branchId),
            previousIsActive: current.isActive
          }
        }
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
    return res.json(publicUser(user));
  } catch (error) {
    if (isSerializationConflict(error)) {
      return res.status(409).json({ code: 'USER_UPDATE_CONFLICT', error: 'The account changed at the same time. Refresh the user list and try again.' });
    }
    throw error;
  }
}));

router.post('/setup-codes', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const { role, branchId } = z.object({
    role: z.enum(['branch_manager', 'head_office_admin']),
    branchId: z.union([z.coerce.bigint().positive(), z.null()]).optional()
  }).parse(req.body);
  if (role === 'branch_manager' && !branchId) return res.status(400).json({ error: 'Assign a branch to the manager setup code.' });
  if (role === 'head_office_admin' && branchId) return res.status(400).json({ error: 'Admin setup codes cannot be assigned to a branch.' });
  const code = randomBytes(24).toString('base64url');
  await prisma.$transaction(async tx => {
    const created = await tx.setupCode.create({
      data: {
        codeHash: hashCode(code),
        role,
        branchId: role === 'branch_manager' ? branchId : null,
        createdBy: req.user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    await tx.auditLog.create({
      data: {
        tableName: 'setup_codes', operation: 'INSERT', recordId: created.id,
        branchId: created.branchId, performedByUserId: req.user.id,
        oldData: { action: 'SETUP_CODE_CREATED', role: created.role, expiresAt: created.expiresAt.toISOString() }
      }
    });
    return created;
  });
  res.status(201).json({ code, role, branchId: branchId ? String(branchId) : null, expiresInHours: 24 });
}));

router.get('/suppliers', allowRoles('head_office_admin'), wrap(async (_req, res) => {
  res.json(await prisma.supplier.findMany({ orderBy: { companyName: 'asc' } }));
}));

router.post('/suppliers', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const input = z.object({
    companyName: z.string().trim().min(1).max(150),
    contactPerson: z.string().trim().max(150).optional(),
    email: z.string().trim().email().max(255).optional().or(z.literal('')),
    phone: z.string().trim().max(20).optional(),
    address: z.string().trim().max(1000).optional()
  }).parse(req.body);
  const idempotencyKey = receiptIdempotencyKey.parse(req.get('Idempotency-Key'));
  const requestFingerprint = hashCode(JSON.stringify(input));
  const replayFromEvent = async client => {
    const event = await findIdempotencyAuditEvent(client, req.user.id, idempotencyKey);
    if (!event) return null;
    const details = event.oldData || {};
    if (event.tableName !== 'suppliers' || event.operation !== 'INSERT'
      || details.action !== 'SUPPLIER_CREATED' || details.requestFingerprint !== requestFingerprint) {
      throw receiptConflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used with different supplier details. Review the earlier request before starting over.');
    }
    const existing = await client.supplier.findUnique({ where: { id: event.recordId } });
    if (!existing) throw receiptConflict('IDEMPOTENCY_EVENT_MISSING', 'The earlier supplier record could not be loaded. Contact an administrator before retrying.');
    return existing;
  };
  try {
    const supplier = await prisma.$transaction(async tx => {
      await lockIdempotencyKey(tx, idempotencyKey);
      const existing = await replayFromEvent(tx);
      if (existing) return existing;
      const created = await tx.supplier.create({ data: input });
      await tx.auditLog.create({
        data: {
          tableName: 'suppliers', operation: 'INSERT', recordId: created.id,
          performedByUserId: req.user.id,
          oldData: { action: 'SUPPLIER_CREATED', idempotencyKey, requestFingerprint }
        }
      });
      return created;
    }, { isolationLevel: 'ReadCommitted' });
    return res.status(201).json(supplier);
  } catch (error) {
    if (isSerializationConflict(error)) {
      const existing = await replayFromEvent(prisma);
      if (existing) return res.status(201).json(existing);
      return res.status(409).json({
        code: 'SUPPLIER_CREATE_CONFLICT',
        error: 'A concurrent change prevented supplier creation. Retry with the same Idempotency-Key.'
      });
    }
    throw error;
  }
}));

router.patch('/suppliers/:id', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const input = z.object({
    companyName: z.string().trim().min(1).max(150).optional(),
    contactPerson: z.string().trim().max(150).nullable().optional(),
    email: z.string().trim().email().max(255).nullable().optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    address: z.string().trim().max(1000).nullable().optional(),
    isActive: z.boolean().optional()
  }).refine(value => Object.keys(value).length > 0).parse(req.body);
  const id = idValue(req.params.id);
  try {
    const supplier = await prisma.$transaction(async tx => {
      const current = await tx.supplier.findUnique({ where: { id } });
      if (!current) {
        const error = new Error('Supplier not found.');
        error.status = 404;
        throw error;
      }
      const updated = await tx.supplier.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          tableName: 'suppliers', operation: 'UPDATE', recordId: id,
          performedByUserId: req.user.id,
          oldData: {
            action: 'SUPPLIER_UPDATED',
            changes: auditChanges(input),
            previousValues: auditPreviousValues(current, input)
          }
        }
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
    return res.json(supplier);
  } catch (error) {
    if (isSerializationConflict(error)) return res.status(409).json({ code: 'SUPPLIER_UPDATE_CONFLICT', error: 'The supplier changed at the same time. Refresh the list before trying again.' });
    throw error;
  }
}));

const partInput = z.object({
  supplierId: z.coerce.bigint().positive(),
  partNumber: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(),
  unitOfMeasure: z.string().trim().min(1).max(50),
  wholesaleCost: z.coerce.number().min(0).max(9999999999),
  retailPrice: z.coerce.number().min(0).max(9999999999)
});

router.post('/parts', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const input = partInput.parse(req.body);
  const part = await prisma.$transaction(async tx => {
    const created = await tx.part.create({ data: input });
    await setAuditContext(tx, req.user.id, { action: 'PART_INITIALIZED', partId: String(created.id) });
    const activeBranches = await tx.branch.findMany({ where: { isActive: true }, select: { id: true } });
    await tx.inventory.createMany({ data: activeBranches.map(branch => ({ branchId: branch.id, partId: created.id })) });
    await tx.auditLog.create({
      data: {
        tableName: 'parts_master', operation: 'INSERT', recordId: created.id,
        performedByUserId: req.user.id,
        oldData: { action: 'PART_CREATED', partNumber: created.partNumber }
      }
    });
    return created;
  });
  res.status(201).json(part);
}));

router.patch('/parts/:id', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const input = partInput.partial().refine(value => Object.keys(value).length > 0).parse(req.body);
  const id = idValue(req.params.id);
  try {
    const part = await prisma.$transaction(async tx => {
      const current = await tx.part.findUnique({ where: { id } });
      if (!current) {
        const error = new Error('Part not found.');
        error.status = 404;
        throw error;
      }
      const updated = await tx.part.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          tableName: 'parts_master', operation: 'UPDATE', recordId: id,
          performedByUserId: req.user.id,
          oldData: {
            action: 'PART_UPDATED',
            changes: auditChanges(input),
            previousValues: auditPreviousValues(current, input)
          }
        }
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
    return res.json(part);
  } catch (error) {
    if (isSerializationConflict(error)) return res.status(409).json({ code: 'PART_UPDATE_CONFLICT', error: 'The part changed at the same time. Refresh the catalog before trying again.' });
    throw error;
  }
}));

router.get('/branches/admin', allowRoles('head_office_admin'), wrap(async (_req, res) => {
  res.json(await prisma.branch.findMany({ include: { _count: { select: { users: true, inventory: true } } }, orderBy: { name: 'asc' } }));
}));

router.post('/branches', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const input = z.object({
    code: z.string().trim().min(1).max(10).transform(value => value.toUpperCase()),
    name: z.string().trim().min(1).max(100),
    address: z.string().trim().min(1).max(1000),
    phone: z.string().trim().max(20).optional()
  }).parse(req.body);
  const branch = await prisma.$transaction(async tx => {
    const created = await tx.branch.create({ data: input });
    await setAuditContext(tx, req.user.id, { action: 'BRANCH_INITIALIZED', branchId: String(created.id) });
    const parts = await tx.part.findMany({ select: { id: true } });
    if (parts.length) await tx.inventory.createMany({ data: parts.map(part => ({ branchId: created.id, partId: part.id })) });
    await tx.auditLog.create({
      data: {
        tableName: 'branches', operation: 'INSERT', recordId: created.id,
        branchId: created.id, performedByUserId: req.user.id,
        oldData: { action: 'BRANCH_CREATED', code: created.code, name: created.name }
      }
    });
    return created;
  });
  res.status(201).json(branch);
}));

router.patch('/branches/:id', allowRoles('head_office_admin'), wrap(async (req, res) => {
  const input = z.object({
    code: z.string().trim().min(1).max(10).transform(value => value.toUpperCase()).optional(),
    name: z.string().trim().min(1).max(100).optional(),
    address: z.string().trim().min(1).max(1000).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    isActive: z.boolean().optional()
  }).refine(value => Object.keys(value).length > 0).parse(req.body);
  const id = idValue(req.params.id);
  try {
    const branch = await prisma.$transaction(async tx => {
      const current = await tx.branch.findUnique({ where: { id } });
      if (!current) {
        const error = new Error('Branch not found.');
        error.status = 404;
        throw error;
      }
      const updated = await tx.branch.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          tableName: 'branches', operation: 'UPDATE', recordId: id,
          branchId: id, performedByUserId: req.user.id,
          oldData: {
            action: 'BRANCH_UPDATED',
            changes: auditChanges(input),
            previousValues: auditPreviousValues(current, input)
          }
        }
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
    return res.json(branch);
  } catch (error) {
    if (isSerializationConflict(error)) return res.status(409).json({ code: 'BRANCH_UPDATE_CONFLICT', error: 'The branch changed at the same time. Refresh the list before trying again.' });
    throw error;
  }
}));
