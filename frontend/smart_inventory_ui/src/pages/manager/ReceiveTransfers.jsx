import { useState } from 'react';
import { useInventory } from '../../data/InventoryContext';
import Badge from '../../components/Badge';

function storageKeyFor(accountId, transferId) {
  return `smart-inventory:pending-receipt:${accountId}:${transferId}`;
}

function readPendingAttempt(storageKey) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return null;
    const attempt = JSON.parse(stored);
    if (typeof attempt.key !== 'string' || !Number.isInteger(attempt.quantity) || attempt.quantity < 1) return null;
    return attempt;
  } catch {
    return null;
  }
}

function createIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error('This browser cannot create a secure receipt key. Update the browser and try again.');
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function ReceiveTransfers() {
  const { transfers, parts, account, branches, receiveTransfer } = useInventory();
  const [message, setMessage] = useState('');
  const branchId = account.branch;
  const branchName = branches.find(branch => branch.id === branchId)?.name || account.branchName;
  const incoming = transfers.filter(transfer => {
    if (transfer.to !== branchId) return false;
    if (['Dispatched', 'Partially Received'].includes(transfer.status)) return true;
    return transfer.status === 'Completed' && Boolean(readPendingAttempt(storageKeyFor(account.id, transfer.id)));
  });

  return <>
    <div className="pageHead">
      <div>
        <h1>Receive Transfers</h1>
        <p>Confirm quantities physically received by {branchName}.</p>
      </div>
    </div>
    <div className="card">
      {incoming.length === 0
        ? <div className="empty">No dispatched transfers are waiting for receipt.</div>
        : incoming.map(transfer => (
          <ReceiveCard
            key={`${account.id}:${transfer.id}`}
            t={transfer}
            part={parts.find(part => part.id === transfer.part)}
            storageKey={storageKeyFor(account.id, transfer.id)}
            onConflictResolved={() => setMessage('Earlier receipt attempt reviewed. Confirm Receipt will start a new attempt only when you choose it.')}
            onReceive={async (quantity, idempotencyKey) => {
              const result = await receiveTransfer(transfer.id, quantity, idempotencyKey);
              setMessage(result.ok ? 'Transfer receipt updated.' : '');
              return result;
            }}
          />
        ))}
    </div>
    {message && <div className="notice" role="status">{message}</div>}
  </>;
}

function ReceiveCard({ t, part, storageKey, onReceive, onConflictResolved }) {
  const remaining = Math.max(0, t.qty - Number(t.receivedQty || 0));
  const [pendingAttempt, setPendingAttempt] = useState(() => readPendingAttempt(storageKey));
  const [qty, setQty] = useState(() => String(readPendingAttempt(storageKey)?.quantity ?? remaining));
  const [conflict, setConflict] = useState(() => Boolean(readPendingAttempt(storageKey)?.requiresReview));
  const [error, setError] = useState(() => readPendingAttempt(storageKey)?.requiresReview
    ? 'This saved key conflicts with earlier receipt details. Review the earlier receipt before starting another one.'
    : '');
  const [processing, setProcessing] = useState(false);

  const resolveConflict = () => {
    const confirmed = window.confirm('Have you reviewed the earlier receipt attempt? Confirming discards only the saved local attempt. It does not change inventory. You can then deliberately start a new receipt if units remain.');
    if (!confirmed) return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      setError('The saved attempt could not be cleared. It remains unchanged; retry the review action after checking browser storage.');
      return;
    }
    setPendingAttempt(null);
    setConflict(false);
    setError('');
    setQty(String(remaining));
    onConflictResolved();
  };

  const submit = async () => {
    if (processing) return;
    const receivedQty = Number(qty);
    if (!pendingAttempt && (!Number.isInteger(receivedQty) || receivedQty < 1 || receivedQty > remaining)) {
      setError(`Enter a whole number between 1 and ${remaining}.`);
      return;
    }
    if (pendingAttempt && receivedQty !== pendingAttempt.quantity) {
      setError('This receipt has an uncertain result. Retry it with its original quantity before starting another attempt.');
      return;
    }

    let attempt = pendingAttempt;
    if (!attempt) {
      try {
        attempt = { key: createIdempotencyKey(), quantity: receivedQty };
        window.localStorage.setItem(storageKey, JSON.stringify(attempt));
        setPendingAttempt(attempt);
      } catch (storageError) {
        setError(`${storageError.message || 'The receipt key could not be saved on this device.'} The request was not sent.`);
        return;
      }
    }

    setProcessing(true);
    setError('');
    try {
      const result = await onReceive(attempt.quantity, attempt.key);
      if (result.ok) {
        window.localStorage.removeItem(storageKey);
        setPendingAttempt(null);
        setConflict(false);
        setQty(String(Math.max(1, remaining - attempt.quantity)));
        return;
      }
      if (result.conflict) {
        const reviewAttempt = { ...attempt, requiresReview: true };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(reviewAttempt));
        } catch {
          // Keep the in-memory attempt locked; the original saved key is not discarded.
        }
        setPendingAttempt(reviewAttempt);
        setConflict(true);
        setError('This key is already associated with different receipt details. Review the earlier receipt before starting another one. Your saved key and quantity are being kept.');
        return;
      }
      if (result.uncertain) {
        setError(`${result.message} Retry this same attempt; its saved key and quantity will be reused.`);
        return;
      }

      window.localStorage.removeItem(storageKey);
      setPendingAttempt(null);
      setConflict(false);
      setError(result.message);
    } catch (requestError) {
      setError(`${requestError.message} The result may be uncertain; retry to reuse the same saved receipt key.`);
    } finally {
      setProcessing(false);
    }
  };

  return <div className="receiveCard">
    <div>
      <Badge>{t.status}</Badge>
      <h3>{part?.name}</h3>
      {t.status === 'Completed'
        ? <p>A previous receipt attempt may have completed. Retry to confirm its result without adding the stock twice.</p>
        : <p>{remaining} of {t.qty} units remaining from {t.from}</p>}
    </div>
    <div>
      <label>
        Received Qty
        <input
          type="number"
          min="1"
          step="1"
          max={remaining || undefined}
          value={qty}
          disabled={processing || Boolean(pendingAttempt)}
          onChange={event => { setQty(event.target.value); setError(''); }}
          required
        />
      </label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary" onClick={submit} disabled={processing || conflict || remaining === 0 && !pendingAttempt}>
        {processing ? 'Processing...' : conflict ? 'Receipt needs review' : pendingAttempt ? 'Retry Receipt' : 'Confirm Receipt'}
      </button>
      {conflict && <button type="button" onClick={resolveConflict} disabled={processing}>I reviewed it; allow a new receipt attempt</button>}
    </div>
  </div>;
}
