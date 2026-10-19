import { createContext, useContext, useMemo, useState } from 'react';
import { parts as initialParts, transfers as initialTransfers, audit as initialAudit, jobs as initialJobs, users as initialUsers, branches } from './mockData';

const InventoryContext = createContext(null);

export function InventoryProvider({ children, isNewAccount = false, account = null }) {
  const [parts, setParts] = useState(() => structuredClone(initialParts));
  const [jobs] = useState(() => isNewAccount ? [] : structuredClone(initialJobs));
  const [transfers, setTransfers] = useState(() => isNewAccount ? [] : structuredClone(initialTransfers));
  const [users] = useState(() => isNewAccount ? [{ id: account?.id, name: account?.name, email: account?.email, role: account?.role, branch: account?.branch, status: 'Active' }] : structuredClone(initialUsers));
  const [audit, setAudit] = useState(() => isNewAccount ? [] : [...initialAudit]);

  const addAudit = entry => setAudit(prev => [{ id: Date.now(), time: new Date().toLocaleString('en-PH'), ...entry }, ...prev]);

  const availableStock = (partId, branchId) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return 0;
    const reserved = transfers
      .filter(t => t.part === partId && t.from === branchId && ['Pending Approval', 'Approved'].includes(t.status))
      .reduce((sum, t) => sum + Number(t.qty), 0);
    return Math.max(0, Number(part.stock[branchId] || 0) - reserved);
  };

  const availableStockForTransfer = transfer => {
    const part = parts.find(p => p.id === transfer.part);
    if (!part) return 0;
    const reserved = transfers
      .filter(t => t.id !== transfer.id && t.part === transfer.part && t.from === transfer.from && ['Pending Approval', 'Approved'].includes(t.status))
      .reduce((sum, t) => sum + Number(t.qty), 0);
    return Math.max(0, Number(part.stock[transfer.from] || 0) - reserved);
  };

  const recordPartUsage = (partId, branchId, qty, repairId = 'RO-1001') => {
    qty = Number(qty);
    const part = parts.find(p => p.id === partId);
    if (!part || !branches.some(branch => branch.id === branchId) || !Number.isInteger(qty) || qty < 1) return { ok: false, message: 'Enter a valid part, branch, and whole-number quantity greater than zero.' };
    if (account?.role && account.role !== 'Technician') return { ok: false, message: 'Only technicians can record parts against repair jobs.' };
    if (account?.branch && account.branch !== branchId) return { ok: false, message: 'You can only record parts at your assigned branch.' };
    const job = jobs.find(item => item.id === repairId);
    if (!job || job.status === 'Completed' || job.branch !== branchId) return { ok: false, message: 'Parts can only be recorded against an active repair job at this branch.' };
    if (availableStock(partId, branchId) < qty) return { ok: false, message: `Only ${availableStock(partId, branchId)} unit(s) are available.` };
    setParts(prev => prev.map(p => p.id === partId ? { ...p, stock: { ...p.stock, [branchId]: p.stock[branchId] - qty } } : p));
    addAudit({ action: 'PART_USED', part: part.name, qty: -qty, from: branches.find(branch => branch.id === branchId).name, to: `Repair ${repairId}`, user: account?.name || 'Alex Technician' });
    return { ok: true };
  };

  const requestTransfer = ({ partId, from, to, qty, reason = '', requester = 'Alex Technician' }) => {
    qty = Number(qty);
    reason = typeof reason === 'string' ? reason.trim() : '';
    if (!parts.some(p => p.id === partId) || !branches.some(branch => branch.id === from) || !branches.some(branch => branch.id === to) || from === to) return { ok: false, message: 'Select a valid part and different source and destination branches.' };
    if (account?.role && account.role !== 'Technician') return { ok: false, message: 'Only technicians can request a transfer.' };
    if (account?.branch && to !== account.branch) return { ok: false, message: 'Transfers must be sent to your assigned branch.' };
    if (!reason || reason.length > 500) return { ok: false, message: 'Enter a transfer reason between 1 and 500 characters.' };
    if (!Number.isInteger(qty) || qty < 1) return { ok: false, message: 'Enter a whole-number quantity greater than zero.' };
    const available = availableStock(partId, from);
    if (qty > available) return { ok: false, message: `Over-booking prevented. Only ${available} unit(s) are available at the source branch.` };
    const id = `TR-${Date.now()}`;
    const transferRequester = requester === 'Alex Technician' && account?.name ? account.name : requester;
    setTransfers(prev => [{ id, part: partId, from, to, qty, reason, status: 'Pending Approval', requester: transferRequester, date: new Date().toISOString().slice(0, 10) }, ...prev]);
    addAudit({ action: 'TRANSFER_REQUESTED', part: parts.find(p => p.id === partId)?.name || partId, qty, from, to, user: transferRequester });
    return { ok: true, id };
  };

  const updateTransfer = (id, status, reason = '') => {
    const t = transfers.find(x => x.id === id);
    reason = typeof reason === 'string' ? reason.trim() : '';
    if (!t || t.status !== 'Pending Approval' || !['Approved', 'Rejected'].includes(status)) return { ok: false, message: 'Only pending transfers can be approved or rejected.' };
    if (account?.role && account.role !== 'Branch Manager') return { ok: false, message: 'Only branch managers can approve or reject transfers.' };
    if (account?.branch && t.from !== account.branch) return { ok: false, message: 'You can only review transfers from your assigned branch.' };
    if (status === 'Approved' && availableStockForTransfer(t) < t.qty) return { ok: false, message: 'There is not enough unreserved stock to approve this transfer.' };
    if (status === 'Rejected' && !reason) return { ok: false, message: 'Enter a rejection reason.' };
    if (reason.length > 500) return { ok: false, message: 'The reason must be 500 characters or fewer.' };
    setTransfers(prev => prev.map(item => item.id === id ? {
      ...item,
      status,
      ...(status === 'Rejected' ? { rejectionReason: reason } : {})
    } : item));
    addAudit({ action: `TRANSFER_${status.replaceAll(' ', '_').toUpperCase()}`, part: parts.find(p => p.id === t.part)?.name || t.part, qty: t.qty, from: t.from, to: t.to, user: account?.name || 'Maria Santos' });
    return { ok: true };
  };

  const dispatchTransfer = (id) => {
    const t = transfers.find(x => x.id === id);
    if (!t || t.status !== 'Approved') return { ok: false, message: 'Only approved transfers can be dispatched.' };
    if (account?.role && account.role !== 'Branch Manager') return { ok: false, message: 'Only branch managers can dispatch transfers.' };
    if (account?.branch && t.from !== account.branch) return { ok: false, message: 'You can only dispatch transfers from your assigned branch.' };
    const available = availableStockForTransfer(t);
    if (available < t.qty) return { ok: false, message: `Dispatch blocked. Only ${available} unit(s) are available at the source branch.` };
    setParts(prev => prev.map(p => p.id === t.part ? { ...p, stock: { ...p.stock, [t.from]: p.stock[t.from] - t.qty } } : p));
    setTransfers(prev => prev.map(x => x.id === id ? { ...x, status: 'Dispatched' } : x));
    addAudit({ action: 'STOCK_DISPATCHED', part: parts.find(p => p.id === t.part)?.name || t.part, qty: -t.qty, from: t.from, to: t.to, user: account?.name || 'Maria Santos' });
    return { ok: true };
  };

  const receiveTransfer = (id, receivedQty) => {
    const t = transfers.find(x => x.id === id);
    receivedQty = Number(receivedQty);
    if (!t || !['Dispatched', 'Partially Received'].includes(t.status)) return { ok: false, message: 'Only dispatched transfers can be received.' };
    if (account?.role && account.role !== 'Branch Manager') return { ok: false, message: 'Only branch managers can confirm transfer receipts.' };
    if (account?.branch && t.to !== account.branch) return { ok: false, message: 'You can only receive transfers at your assigned branch.' };
    const remainingQty = t.qty - Number(t.receivedQty || 0);
    if (!Number.isInteger(receivedQty) || receivedQty < 1 || receivedQty > remainingQty) return { ok: false, message: `Received quantity must be a whole number between 1 and the ${remainingQty} remaining unit(s).` };
    const totalReceived = Number(t.receivedQty || 0) + receivedQty;
    setParts(prev => prev.map(p => p.id === t.part ? { ...p, stock: { ...p.stock, [t.to]: p.stock[t.to] + receivedQty } } : p));
    setTransfers(prev => prev.map(x => x.id === id ? { ...x, status: totalReceived === t.qty ? 'Received' : 'Partially Received', receivedQty: totalReceived } : x));
    addAudit({ action: 'STOCK_RECEIVED', part: parts.find(p => p.id === t.part)?.name || t.part, qty: receivedQty, from: t.from, to: t.to, user: account?.name || 'Maria Santos' });
    return { ok: true };
  };

  const value = useMemo(() => ({ parts, jobs, users, transfers, audit, account, isNewAccount, availableStock, availableStockForTransfer, recordPartUsage, requestTransfer, updateTransfer, dispatchTransfer, receiveTransfer }), [parts, jobs, users, transfers, audit, account, isNewAccount]);
  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  const value = useContext(InventoryContext);
  if (!value) throw new Error('useInventory must be used inside InventoryProvider');
  return value;
}
