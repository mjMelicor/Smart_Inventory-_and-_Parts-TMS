import { useState } from 'react';
import { useInventory } from '../../data/InventoryContext';
import { createIdempotencyKey, loadPendingRequest, savePendingRequest, clearPendingRequest } from '../../data/idempotency';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';

function transferRequestStorageKey(accountId) {
  return `smart-inventory:pending-transfer-request:${accountId}`;
}

export default function TransferRequests({ request = false }) {
  const { transfers, parts, branches, account, availableStock, requestTransfer } = useInventory();
  const destination = account.branch;
  const sources = branches.filter(branch => branch.id !== destination);
  const storageKey = transferRequestStorageKey(account.id);
  const [pendingAttempt, setPendingAttempt] = useState(() => loadPendingRequest(storageKey));
  const [show, setShow] = useState(() => request || Boolean(loadPendingRequest(storageKey)));
  const [partId, setPartId] = useState(() => pendingAttempt?.payload.partId || parts[0]?.id || '');
  const [from, setFrom] = useState(() => {
    const source = branches.find(branch => branch.dbId === String(pendingAttempt?.payload.sourceBranchId));
    return source?.id || sources[0]?.id || '';
  });
  const [qty, setQty] = useState(() => String(pendingAttempt?.payload.quantity ?? 1));
  const [reason, setReason] = useState(() => pendingAttempt?.payload.notes || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(() => pendingAttempt?.requiresReview
    ? 'This key conflicts with an earlier transfer request. Review that request before starting another one.'
    : '');
  const [conflict, setConflict] = useState(() => Boolean(pendingAttempt?.requiresReview));
  const [processing, setProcessing] = useState(false);

  const resolveConflict = () => {
    const confirmed = window.confirm('Have you reviewed the earlier transfer request? Confirming discards only this saved local attempt. It does not change a transfer or inventory. You can then deliberately create a new request.');
    if (!confirmed) return;
    try {
      clearPendingRequest(storageKey);
    } catch {
      setError('The saved attempt could not be cleared. It remains unchanged; check browser storage and try again.');
      return;
    }
    setPendingAttempt(null);
    setConflict(false);
    setError('');
    setQty('1');
    setReason('');
    setMessage('Earlier request reviewed. Submit Request will create a new transfer only when you choose it.');
  };

  const submit = async event => {
    event?.preventDefault();
    if (processing || conflict) return;
    let attempt = pendingAttempt;
    if (!attempt) {
      const source = sources.find(branch => branch.id === from);
      if (!source) {
        setError('Select a valid source branch.');
        return;
      }
      try {
        attempt = {
          key: createIdempotencyKey(),
          payload: { partId, sourceBranchId: source.dbId, quantity: Number(qty), notes: reason.trim() }
        };
        savePendingRequest(storageKey, attempt);
        setPendingAttempt(attempt);
      } catch (storageError) {
        setError(`${storageError.message || 'The request key could not be saved on this device.'} The request was not sent.`);
        return;
      }
    }

    setProcessing(true);
    setError('');
    try {
      const source = branches.find(branch => branch.dbId === String(attempt.payload.sourceBranchId));
      const result = await requestTransfer({
        partId: attempt.payload.partId,
        from: source?.id,
        qty: attempt.payload.quantity,
        reason: attempt.payload.notes
      }, attempt.key);
      if (result.ok) {
        clearPendingRequest(storageKey);
        setPendingAttempt(null);
        setMessage(`Transfer ${result.id} submitted for approval.`);
        setError('');
        setShow(false);
        setReason('');
        return;
      }
      if (result.conflict) {
        const reviewAttempt = { ...attempt, requiresReview: true };
        try { savePendingRequest(storageKey, reviewAttempt); } catch { /* Keep the attempt locked in memory. */ }
        setPendingAttempt(reviewAttempt);
        setConflict(true);
        setError('This request key is already associated with different transfer details. Review the earlier request before starting another one. Your saved request is being kept.');
        return;
      }
      if (result.uncertain) {
        setError(`${result.message} Retry this same request; its saved key and details will be reused.`);
        return;
      }
      clearPendingRequest(storageKey);
      setPendingAttempt(null);
      setError(result.message);
    } catch (requestError) {
      setError(`${requestError.message} The result may be uncertain; retry to reuse the same saved request key.`);
    } finally {
      setProcessing(false);
    }
  };

  const valuesLocked = processing || Boolean(pendingAttempt);
  return <>
    <div className="pageHead">
      <div>
        <h1>{request ? 'Request Part Transfer' : 'My Transfer Requests'}</h1>
        <p>{request ? 'Find another branch with available stock and request a transfer.' : 'Track submitted requests through approval, dispatch and receipt.'}</p>
      </div>
      {!request && <button className="primary" onClick={() => { setError(''); setShow(true); }}>+ New Transfer Request</button>}
    </div>
    <div className="card">
      <div className="notice"><b>Over-booking protection:</b> reserved quantities are excluded from available stock.</div>
      {transfers.length
        ? transfers.map(transfer => <div className="transferCard" key={transfer.id}>
          <div>
            <b>{transfer.code}</b>
            <h3>{parts.find(part => part.id === transfer.part)?.name}</h3>
            <p>{transfer.qty} units · {branches.find(branch => branch.id === transfer.from)?.name} → {branches.find(branch => branch.id === transfer.to)?.name}</p>
            <small>Requested by {transfer.requester} · {transfer.date}</small>
          </div>
          <Badge>{transfer.status}</Badge>
        </div>)
        : <div className="empty">No transfer requests have been created for this account.</div>}
    </div>
    {message && <div className="notice" role="status">{message}</div>}
    {show && <Modal title="Request Part Transfer" onClose={() => setShow(false)} actions={<>
      <button className="secondary" onClick={() => setShow(false)}>Close</button>
      <button className="primary" onClick={submit} disabled={processing || conflict}>{processing ? 'Submitting...' : pendingAttempt ? 'Retry Request' : 'Submit Request'}</button>
      {conflict && <button type="button" onClick={resolveConflict} disabled={processing}>I reviewed it; allow a new request</button>}
    </>}>
      <label>Part<select value={partId} disabled={valuesLocked} onChange={event => { setPartId(event.target.value); setError(''); }} required>
        {parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}
      </select></label>
      <label>Source Branch<select value={from} disabled={valuesLocked} onChange={event => { setFrom(event.target.value); setError(''); }} required>
        {sources.map(branch => <option key={branch.id} value={branch.id}>{branch.name} — {availableStock(partId, branch.id)} available</option>)}
      </select></label>
      <label>Quantity<input type="number" min="1" step="1" max={availableStock(partId, from)} value={qty} disabled={valuesLocked} onChange={event => { setQty(event.target.value); setError(''); }} required /></label>
      <p className="notice">Maximum request: {availableStock(partId, from)} unit(s).</p>
      <label>Reason<textarea placeholder="Explain why the part is needed..." value={reason} disabled={valuesLocked} onChange={event => { setReason(event.target.value); setError(''); }} maxLength="500" required /></label>
      {error && <p className="notice" role="alert">{error}</p>}
    </Modal>}
  </>;
}
