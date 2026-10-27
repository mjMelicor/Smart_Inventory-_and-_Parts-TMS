import { useState } from 'react';
import { money } from '../../data/mockData';
import { useInventory } from '../../data/InventoryContext';
import { clearPendingRequest, createIdempotencyKey, loadPendingRequest, savePendingRequest } from '../../data/idempotency';
import Modal from '../../components/Modal';

const storageKeyFor = (accountId, workOrderId) => `smart-inventory:pending-part-usage:${accountId}:${workOrderId}`;

export default function RepairJobDetails({ workOrderId, setPage }) {
  const { jobs, parts, branches, account, availableStock, recordPartUsage, updateWorkOrderStatus } = useInventory();
  const branchId = account?.branch;
  const branchJobs = jobs.filter(job => job.branch === branchId);
  const job = branchJobs.find(row => row.id === String(workOrderId));
  const storageKey = workOrderId ? storageKeyFor(account.id, workOrderId) : '';
  const [attempt, setAttempt] = useState(() => storageKey ? loadPendingRequest(storageKey) : null);
  const [partId, setPartId] = useState(() => attempt?.payload.partId || job?.parts[0] || parts[0]?.id || '');
  const [qty, setQty] = useState(() => String(attempt?.payload.quantity ?? 1));
  const [show, setShow] = useState(() => Boolean(attempt));
  const [conflict, setConflict] = useState(() => Boolean(attempt?.requiresReview));
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(() => attempt?.requiresReview
    ? 'This part-usage key conflicts with an earlier attempt. Review it before starting a new request.'
    : attempt ? 'A part-usage request is saved. Retry it to reuse the same key and quantity.' : '');

  if (!job) return <><div className="pageHead"><div><h1>Repair Job Details</h1><p>Select a repair job from your assigned jobs.</p></div></div><div className="empty"><button className="secondary" onClick={() => setPage('jobs')}>Open My Repair Jobs</button></div></>;

  const active = !['Completed', 'Cancelled'].includes(job.status);
  const submit = async () => {
    if (processing || conflict) return;
    let current = attempt;
    if (!current) {
      const quantity = Number(qty);
      if (!partId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > availableStock(partId, branchId)) {
        setMessage('Enter a whole quantity within the available stock.');
        return;
      }
      try {
        current = { key: createIdempotencyKey(), payload: { workOrderId: job.id, partId, quantity } };
        savePendingRequest(storageKey, current);
        setAttempt(current);
      } catch (error) {
        setMessage(`${error.message || 'The request key could not be saved.'} No request was sent.`);
        return;
      }
    }

    setProcessing(true);
    setMessage('');
    try {
      const result = await recordPartUsage(current.payload.partId, branchId, current.payload.quantity, job.id, current.key);
      if (result.ok) {
        clearPendingRequest(storageKey);
        setAttempt(null);
        setMessage('Part usage recorded and inventory deducted.');
        setShow(false);
        setQty('1');
        return;
      }
      if (result.conflict) {
        const reviewAttempt = { ...current, requiresReview: true };
        try { savePendingRequest(storageKey, reviewAttempt); } catch { /* Keep the key and details in memory. */ }
        setAttempt(reviewAttempt);
        setConflict(true);
        setMessage('This request key conflicts with an earlier part-usage attempt. Review that attempt before starting another one. The saved key and quantity are being kept.');
        return;
      }
      if (result.uncertain) {
        setMessage(`${result.message} Retry the same part-usage request; its saved key and quantity will be reused.`);
        return;
      }
      clearPendingRequest(storageKey);
      setAttempt(null);
      setMessage(result.message);
    } catch (error) {
      setMessage(`${error.message} The result may be uncertain; retry to reuse the saved request key.`);
    } finally {
      setProcessing(false);
    }
  };

  const resolveConflict = () => {
    if (!window.confirm('Have you reviewed the earlier part-usage attempt? Confirming discards only the saved local retry details. It does not change inventory. You can then deliberately create another usage request.')) return;
    try {
      clearPendingRequest(storageKey);
      setAttempt(null);
      setConflict(false);
      setMessage('Earlier attempt reviewed. Add Part Used will create a new request only when you choose it.');
    } catch {
      setMessage('The saved attempt could not be cleared and remains unchanged. Check browser storage and try again.');
    }
  };

  const complete = async () => {
    if (processing) return;
    setProcessing(true);
    const result = await updateWorkOrderStatus(job.id, 'completed');
    setMessage(result.ok ? 'Work order marked complete.' : result.message);
    setProcessing(false);
  };

  return <><div className="pageHead"><div><h1>Repair Job {job.number || job.id}</h1><p>{job.customer} · {job.vehicle}</p></div>{active && <div><button className="primary" onClick={() => { setMessage(''); setShow(true); }}>+ Add Part Used</button> <button className="secondary" onClick={complete} disabled={processing}>Complete Job</button></div>}</div><div className="grid2"><section className="card"><h3>Customer & Vehicle</h3><div className="detailGrid"><div><small>Customer</small><b>{job.customer}</b></div><div><small>Vehicle</small><b>{job.vehicle}</b></div><div><small>Branch</small><b>{branches.find(branch => branch.id === job.branch)?.name || job.branchName}</b></div><div><small>Status</small><b>{job.status}</b></div></div>{message && <div className="notice" role="status">{message}</div>}</section><section className="card"><h3>Repair Billing</h3>{job.items.map((item, index) => <div className="billRow" key={`${item.id}-${index}`}><span>{item.part.name} × {item.quantityUsed}</span><b>{money(Number(item.subtotal))}</b></div>)}<div className="billRow"><span>Labor</span><b>{money(job.labor)}</b></div><hr/><div className="billTotal"><span>Total</span><b>{money(job.total)}</b></div></section></div>{show && <Modal title="Record Part Used" onClose={() => !processing && setShow(false)} actions={<><button className="secondary" onClick={() => setShow(false)} disabled={processing}>Close</button><button className="primary" onClick={submit} disabled={processing || conflict}>{processing ? 'Recording…' : attempt ? 'Retry Part Usage' : 'Record Usage'}</button>{conflict && <button type="button" onClick={resolveConflict} disabled={processing}>I reviewed it; allow a new request</button>}</>}><label>Part<select value={attempt?.payload.partId || partId} disabled={processing || Boolean(attempt)} onChange={event => setPartId(event.target.value)}>{parts.map(part => <option key={part.id} value={part.id}>{part.name} — Available: {availableStock(part.id, branchId)}</option>)}</select></label><label>Quantity<input type="number" value={attempt?.payload.quantity ?? qty} disabled={processing || Boolean(attempt)} onChange={event => setQty(event.target.value)} min="1" step="1" max={availableStock(partId, branchId)} required /></label>{message && <p className="notice" role="alert">{message}</p>}<p className="notice">The API checks available stock and records the deduction within one database transaction.</p></Modal>}</>;
}
