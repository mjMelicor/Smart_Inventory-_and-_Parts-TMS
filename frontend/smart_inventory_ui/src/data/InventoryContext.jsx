import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { mapAuditEntry } from './audit';

const InventoryContext = createContext(null);

const statusLabels = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  dispatched: 'Dispatched',
  partially_received: 'Partially Received',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

const workOrderStatusLabels = {
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

const roleLabels = {
  technician: 'Technician',
  branch_manager: 'Branch Manager',
  head_office_admin: 'Head Office Admin'
};

function mapWorkOrder(order, branchById) {
  return {
    id: String(order.id),
    number: order.number,
    customer: order.customerName,
    customerPhone: order.customerPhone || '',
    vehicleModel: order.vehicleModel || '',
    vehicleVinOrPlate: order.vehicleVinOrPlate || '',
    vehicle: [order.vehicleModel, order.vehicleVinOrPlate].filter(Boolean).join(' · '),
    branch: branchById.get(String(order.branchId))?.code || String(order.branchId),
    branchName: order.branch?.name,
    assignedTechnicianId: order.assignedTechnicianId == null ? null : String(order.assignedTechnicianId),
    createdAt: order.createdAt,
    status: workOrderStatusLabels[order.status] || order.status,
    labor: Number(order.laborFee),
    total: Number(order.totalAmount),
    parts: order.items.map(item => String(item.partId)),
    items: order.items
  };
}

function mapTransfer(transfer, branchById) {
  const item = transfer.items?.[0];
  return {
    id: String(transfer.id),
    code: transfer.code,
    part: item ? String(item.partId) : '',
    from: branchById.get(String(transfer.sourceBranchId))?.code || String(transfer.sourceBranchId),
    to: branchById.get(String(transfer.destinationBranchId))?.code || String(transfer.destinationBranchId),
    qty: item?.quantityApproved || item?.quantityRequested || 0,
    requestedQty: item?.quantityRequested ?? 0,
    approvedQty: item?.quantityApproved ?? 0,
    receivedQty: item?.quantityReceived ?? 0,
    status: statusLabels[transfer.status] || transfer.status,
    requester: `${transfer.requestedBy?.firstName || ''} ${transfer.requestedBy?.lastName || ''}`.trim(),
    reason: transfer.requestNotes,
    date: transfer.createdAt?.slice(0, 10) || '',
    rawStatus: transfer.status
  };
}

export function InventoryProvider({ children, account }) {
  const [branchIsActive, setBranchIsActive] = useState(account.branchIsActive !== false);
  const [branches, setBranches] = useState([]);
  const [branchAdminRows, setBranchAdminRows] = useState([]);
  const [parts, setParts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [users, setUsers] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [dailySales, setDailySales] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiReady, setApiReady] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    setRefreshWarning('');
    setApiReady(false);
    await api('/health');
    const role = account.role;
    const session = await api('/auth/me');
    const freshBranchIsActive = session.user.branchIsActive === true;
    setBranchIsActive(freshBranchIsActive);
    const branchOperational = role === 'head_office_admin' || freshBranchIsActive;
    const [branchRows, partRows, workOrderRows, transferRows, inventoryRows, optional] = await Promise.all([
      api('/branches'),
      api('/parts'),
      branchOperational ? api('/work-orders') : Promise.resolve([]),
      api('/transfers'),
      role === 'head_office_admin'
        ? api('/inventory')
        : role === 'technician' || branchOperational
          ? api(`/inventory?branchId=${encodeURIComponent(account.branchId)}`)
          : Promise.resolve([]),
      Promise.all([
        role === 'head_office_admin' ? api('/users') : Promise.resolve([]),
        role === 'head_office_admin' ? api('/suppliers') : Promise.resolve([]),
        role === 'head_office_admin' ? api('/branches/admin') : Promise.resolve([]),
        role !== 'technician' && branchOperational ? api('/audit-logs') : Promise.resolve([]),
        role !== 'technician' && branchOperational ? api('/reports/daily-sales') : Promise.resolve(null),
        role !== 'technician' && branchOperational ? api('/technicians') : Promise.resolve([])
      ])
    ]);
    const branchById = new Map(branchRows.map(branch => [String(branch.id), branch]));
    const partData = partRows.map(part => {
      const stock = Object.fromEntries(part.inventory.map(row => [
        branchById.get(String(row.branchId))?.code || String(row.branchId),
        row.quantityOnHand
      ]));
      const reorderLevels = Object.fromEntries(part.inventory.map(row => [
        branchById.get(String(row.branchId))?.code || String(row.branchId),
        row.reorderLevel
      ]));
      const bins = Object.fromEntries(part.inventory.map(row => [
        branchById.get(String(row.branchId))?.code || String(row.branchId),
        row.shelfBinLocation
      ]));
      return {
        id: String(part.id),
        sku: part.partNumber,
        name: part.name,
        description: part.description,
        category: part.category || '',
        unitOfMeasure: part.unitOfMeasure,
        supplier: part.supplier.name,
        price: Number(part.retailPrice),
        ...(part.supplier.id == null ? {} : { supplierId: String(part.supplier.id) }),
        ...(part.wholesaleCost == null ? {} : { cost: Number(part.wholesaleCost) }),
        stock,
        reorderLevels,
        bin: bins,
        inventory: part.inventory.map(row => ({
          branchCode: branchById.get(String(row.branchId))?.code || String(row.branchId),
          quantityAvailable: row.quantityAvailable,
          quantityReserved: row.quantityReserved
        })),
        min: Math.max(0, ...Object.values(reorderLevels))
      };
    });
    const inventoryByPart = new Map(inventoryRows.map(row => [
      `${row.partId}:${row.branchId}`,
      row
    ]));
    for (const part of partData) {
      for (const branch of branchRows) {
        const row = inventoryByPart.get(`${part.id}:${branch.id}`);
        if (row) {
          part.stock[branch.code] = row.quantityOnHand;
          part.reorderLevels[branch.code] = row.reorderLevel;
          part.bin[branch.code] = row.shelfBinLocation;
        }
      }
    }
    setBranches(branchRows.map(branch => ({
      ...branch,
      id: branch.code,
      dbId: String(branch.id),
      city: branch.address
    })));
    setParts(partData);
    setJobs(workOrderRows.map(order => mapWorkOrder(order, branchById)));
    setTransfers(transferRows.map(transfer => mapTransfer(transfer, branchById)));
    setUsers(optional[0].map(user => ({
      ...user,
      id: String(user.id),
      name: `${user.firstName} ${user.lastName}`,
      branch: branchById.get(String(user.branchId))?.code || 'Head Office',
      role: roleLabels[user.role] || user.role,
      status: user.isActive ? 'Active' : 'Inactive'
    })));
    setTechnicians(optional[5].map(user => ({
      ...user,
      id: String(user.id),
      name: `${user.firstName} ${user.lastName}`
    })));
    setSuppliers(optional[1].map(supplier => ({
      ...supplier,
      id: String(supplier.id),
      name: supplier.companyName,
      contact: supplier.phone || supplier.email || '',
      status: supplier.isActive ? 'Active' : 'Inactive'
    })));
    setBranchAdminRows(optional[2].map(branch => ({
      ...branch,
      id: String(branch.id),
      code: branch.code,
      name: branch.name,
      dbId: String(branch.id),
      city: branch.address,
      userCount: branch._count?.users || 0,
      inventoryCount: branch._count?.inventory || 0
    })));
    setAudit(optional[3].map(row => mapAuditEntry(row, {
      parts: partData,
      branches: branchRows,
      transfers: transferRows
    })));
    setDailySales(optional[4]);
    setApiReady(true);
  }, [account]);

  useEffect(() => {
    let mounted = true;
    refresh()
      .catch(requestError => {
        if (mounted) setError(requestError.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [refresh]);

  const runMutation = async (path, method, body) => {
    let response;
    try {
      response = await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (requestError) {
      return { ok: false, message: requestError.message };
    }
    try {
      await refresh();
      return { ok: true, response };
    } catch (refreshError) {
      const warning = `The action was saved, but current data could not be refreshed: ${refreshError.message}`;
      setRefreshWarning(warning);
      return { ok: true, response, warning };
    }
  };

  const runIdempotentMutation = async (path, body, idempotencyKey) => {
    let response;
    try {
      response = await api(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body)
      });
    } catch (requestError) {
      const conflict = requestError.code === 'IDEMPOTENCY_KEY_REUSED';
      return {
        ok: false,
        conflict,
        uncertain: !conflict && (!requestError.status || requestError.status >= 500 || [
          'IDEMPOTENCY_EVENT_MISSING',
          'INVENTORY_ADJUSTMENT_CONFLICT',
          'SUPPLIER_CREATE_CONFLICT',
          'WORK_ORDER_CREATE_CONFLICT',
          'TRANSFER_TRANSACTION_CONFLICT',
          'WORK_ORDER_TRANSACTION_CONFLICT'
        ].includes(requestError.code)),
        message: requestError.message
      };
    }

    try {
      await refresh();
      return { ok: true, response };
    } catch (refreshError) {
      const warning = `The request was saved, but current data could not be refreshed: ${refreshError.message}`;
      setRefreshWarning(warning);
      return { ok: true, response, warning };
    }
  };

  const syncTransferResponse = transfer => {
    if (!transfer?.id) return;
    const branchById = new Map(branches.map(branch => [String(branch.dbId), branch]));
    const updated = mapTransfer(transfer, branchById);
    setTransfers(current => current.map(item => item.id === updated.id ? {
      ...item,
      ...updated,
      requester: updated.requester || item.requester,
      reason: updated.reason ?? item.reason,
      date: updated.date || item.date
    } : item));
  };

  const availableStock = (partId, branchCode) => {
    const part = parts.find(item => item.id === String(partId));
    if (!part) return 0;
    const inventory = part.inventory.find(row => row.branchCode === branchCode);
    return inventory ? inventory.quantityAvailable : Number(part.stock[branchCode] || 0);
  };

  const availableStockForTransfer = transfer => {
    const part = parts.find(item => item.id === String(transfer.part));
    if (!part) return 0;
    return availableStock(part.id, transfer.from) + (transfer.status === 'Pending Approval' ? transfer.requestedQty : 0);
  };

  const loadDailySales = useCallback(async date => {
    const report = await api(`/reports/daily-sales${date ? `?date=${encodeURIComponent(date)}` : ''}`);
    setDailySales(report);
    return report;
  }, []);

  const recordPartUsage = async (partId, _branch, quantity, workOrderId, idempotencyKey) => {
    if (!workOrderId) return { ok: false, message: 'Select a repair work order before adding parts.' };
    return runIdempotentMutation(`/work-orders/${encodeURIComponent(workOrderId)}/items`, {
      partId,
      quantity: Number(quantity)
    }, idempotencyKey);
  };

  const requestTransfer = async ({ partId, from, qty, reason }, idempotencyKey) => {
    const source = branches.find(branch => branch.id === from);
    if (!source) return { ok: false, message: 'Select a valid source branch.' };
    const result = await runIdempotentMutation('/transfers', {
      partId,
      sourceBranchId: source.dbId,
      quantity: Number(qty),
      notes: reason
    }, idempotencyKey);
    return result.ok ? { ...result, id: result.response.code } : result;
  };

  const updateTransfer = async (id, status, reason = '') => {
    const result = await runMutation(`/transfers/${encodeURIComponent(id)}/decision`, 'PATCH', {
      decision: status === 'Approved' ? 'approved' : 'rejected',
      ...(reason ? { reason } : {})
    });
    if (result.ok) {
      syncTransferResponse(result.response);
      return result;
    }
    try {
      await refresh();
      return { ...result, refreshed: true };
    } catch (refreshError) {
      return { ...result, refreshError: refreshError.message };
    }
  };

  const dispatchTransfer = async id => {
    const result = await runMutation(`/transfers/${encodeURIComponent(id)}/dispatch`, 'POST');
    if (result.ok) {
      syncTransferResponse(result.response);
      return result;
    }
    try {
      await refresh();
      return { ...result, refreshed: true };
    } catch (refreshError) {
      return { ...result, refreshError: refreshError.message };
    }
  };
  const receiveTransfer = async (id, quantity, idempotencyKey) => {
    let response;
    try {
      response = await api(`/transfers/${encodeURIComponent(id)}/receive`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ quantity: Number(quantity) })
      });
      syncTransferResponse(response);
    } catch (requestError) {
      const conflict = requestError.code === 'IDEMPOTENCY_KEY_REUSED';
      return {
        ok: false,
        conflict,
        uncertain: !conflict && (!requestError.status || requestError.status >= 500 || [
          'IDEMPOTENCY_EVENT_MISSING',
          'RECEIPT_TRANSACTION_CONFLICT'
        ].includes(requestError.code)),
        message: requestError.message
      };
    }

    try {
      await refresh();
      return { ok: true, response };
    } catch (refreshError) {
      const warning = `The receipt was saved, but current data could not be refreshed: ${refreshError.message}`;
      setRefreshWarning(warning);
      return { ok: true, response, warning };
    }
  };

  const updateReorderLevel = async (branchCode, partId, reorderLevel) => {
    const branch = branches.find(item => item.id === branchCode);
    if (!branch) return { ok: false, message: 'Select a valid branch.' };
    return runMutation(`/inventory/${branch.dbId}/${encodeURIComponent(partId)}/reorder-level`, 'PATCH', { reorderLevel: Number(reorderLevel) });
  };

  const saveReorderLevels = async (branchCode, values) => {
    const branch = branches.find(item => item.id === branchCode);
    if (!branch) return { ok: false, message: 'Select a valid branch.' };
    const results = await Promise.all(Object.entries(values).map(async ([partId, reorderLevel]) => {
      try {
        await api(`/inventory/${branch.dbId}/${encodeURIComponent(partId)}/reorder-level`, {
          method: 'PATCH',
          body: JSON.stringify({ reorderLevel: Number(reorderLevel) })
        });
        return null;
      } catch (requestError) {
        return requestError.message;
      }
    }));
    const failures = results.filter(Boolean);
    let refreshError;
    try {
      await refresh();
    } catch (requestError) {
      refreshError = requestError.message;
    }
    if (refreshError) {
      const warning = `Threshold updates were submitted, but current data could not be refreshed: ${refreshError}`;
      setRefreshWarning(warning);
      if (!failures.length) return { ok: true, warning };
      return { ok: false, message: `${Object.keys(values).length - failures.length} threshold(s) saved; ${failures.length} failed. ${failures[0]} ${warning}` };
    }
    return failures.length
      ? { ok: false, message: `${Object.keys(values).length - failures.length} threshold(s) saved; ${failures.length} failed. ${failures[0]}` }
      : { ok: true };
  };

  const adjustInventory = async (branchCode, partId, quantityChange, reason, idempotencyKey) => {
    const branch = branches.find(item => item.id === branchCode);
    if (!branch) return { ok: false, message: 'Select a valid branch.' };
    return runIdempotentMutation('/inventory/adjustments', {
      branchId: branch.dbId,
      partId,
      quantityChange: Number(quantityChange),
      reason
    }, idempotencyKey);
  };

  const createBranch = (body) => runMutation('/branches', 'POST', body);
  const updateBranch = (id, body) => runMutation(`/branches/${encodeURIComponent(id)}`, 'PATCH', body);
  const createSupplier = (body, idempotencyKey) => runIdempotentMutation('/suppliers', body, idempotencyKey);
  const updateSupplier = (id, body) => runMutation(`/suppliers/${encodeURIComponent(id)}`, 'PATCH', body);
  const createPart = (body) => runMutation('/parts', 'POST', body);
  const updatePart = (id, body) => runMutation(`/parts/${encodeURIComponent(id)}`, 'PATCH', body);
  const createUser = (body) => runMutation('/users', 'POST', body);
  const updateUser = (id, body) => runMutation(`/users/${encodeURIComponent(id)}`, 'PATCH', body);
  const createSetupCode = (body) => api('/setup-codes', { method: 'POST', body: JSON.stringify(body) });
  const createWorkOrder = async (body, branchCode, idempotencyKey) => {
    const branch = branches.find(item => item.id === branchCode);
    if (!branch) return { ok: false, message: 'Select a valid branch.' };
    return runIdempotentMutation('/work-orders', { ...body, branchId: branch.dbId }, idempotencyKey);
  };
  const updateWorkOrder = (id, body) => runMutation(`/work-orders/${encodeURIComponent(id)}`, 'PATCH', body);
  const updateWorkOrderStatus = (id, status) => runMutation(`/work-orders/${encodeURIComponent(id)}/status`, 'PATCH', { status });

  const value = useMemo(() => ({
    account: {
      ...account,
      name: `${account.firstName} ${account.lastName}`,
      branchIsActive,
      branch: branches.find(branch => branch.dbId === String(account.branchId))?.id || String(account.branchId || '') || null,
      branchName: account.branch || null
    },
    branches,
    branchAdminRows,
    parts,
    jobs,
    users,
    technicians,
    suppliers,
    transfers,
    audit,
    dailySales,
    loadDailySales,
    loading,
    apiReady,
    refreshWarning,
    error,
    refresh,
    availableStock,
    availableStockForTransfer,
    recordPartUsage,
    requestTransfer,
    updateTransfer,
    dispatchTransfer,
    receiveTransfer,
    updateReorderLevel,
    saveReorderLevels,
    adjustInventory,
    createBranch,
    updateBranch,
    createSupplier,
    updateSupplier,
    createPart,
    updatePart,
    createUser,
    updateUser,
    createSetupCode,
    createWorkOrder,
    updateWorkOrder,
    updateWorkOrderStatus
  }), [account, branchIsActive, branches, branchAdminRows, parts, jobs, users, technicians, suppliers, transfers, audit, dailySales, loading, apiReady, refreshWarning, error, refresh, loadDailySales]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  const value = useContext(InventoryContext);
  if (!value) throw new Error('useInventory must be used inside InventoryProvider');
  return value;
}
