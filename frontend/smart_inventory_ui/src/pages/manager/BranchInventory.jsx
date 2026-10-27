import { useState } from 'react';
import { useInventory } from '../../data/InventoryContext';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { clearPendingRequest, createIdempotencyKey, loadPendingRequest, savePendingRequest } from '../../data/idempotency';

const adjustmentStorageKey = accountId => `smart-inventory:pending-adjustment:${accountId}`;

export default function BranchInventory() {
  const { parts, account, branches, availableStock, adjustInventory } = useInventory();
  const branchId = account.branch;
  const branchName = branches.find(branch => branch.id === branchId)?.name || account.branchName;
  const storageKey = adjustmentStorageKey(account.id);
  const [attempt, setAttempt] = useState(() => loadPendingRequest(storageKey));
  const [selected, setSelected] = useState(() => {
    const saved = loadPendingRequest(storageKey);
    return parts.find(part => part.id === saved?.payload.partId) || null;
  });
  const [quantityChange, setQuantityChange] = useState(() => String(loadPendingRequest(storageKey)?.payload.quantityChange ?? ''));
  const [reason, setReason] = useState(() => loadPendingRequest(storageKey)?.payload.reason || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(() => loadPendingRequest(storageKey)?.requiresReview
    ? 'This adjustment key conflicts with an earlier attempt. Review it before starting another adjustment.'
    : loadPendingRequest(storageKey) ? 'An adjustment is saved. Retry it to reuse the same request key.' : '');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(() => Boolean(loadPendingRequest(storageKey)?.requiresReview));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const visibleParts = parts.filter(part =>
    (!query || `${part.name} ${part.sku} ${part.supplier}`.toLowerCase().includes(query.toLowerCase()))
    && (!category || part.category === category)
  );

  const submit = async event => {
    event.preventDefault();
    if (saving || conflict || !selected) return;
    let current = attempt;
    if (!current) {
      const change = Number(quantityChange);
      if (!Number.isSafeInteger(change) || change === 0 || !reason.trim()) {
        setError('Enter a nonzero whole-number adjustment and a reason.');
        return;
      }
      try {
        current = { key: createIdempotencyKey(), payload: { partId: selected.id, quantityChange: change, reason: reason.trim() } };
        savePendingRequest(storageKey, current);
        setAttempt(current);
      } catch (storageError) {
        setError(`${storageError.message || 'The request key could not be saved.'} No adjustment was sent.`);
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      const result = await adjustInventory(branchId, current.payload.partId, current.payload.quantityChange, current.payload.reason, current.key);
      if (!result.ok) {
        if (result.conflict) {
          const reviewAttempt = { ...current, requiresReview: true };
          try { savePendingRequest(storageKey, reviewAttempt); } catch { /* Keep the saved attempt locked. */ }
          setAttempt(reviewAttempt);
          setConflict(true);
          setError('This key conflicts with an earlier inventory adjustment. Review it before starting another adjustment. The saved values are being kept.');
        } else if (result.uncertain) {
          setError(`${result.message} Retry the same adjustment; its saved key and values will be reused.`);
        } else {
          clearPendingRequest(storageKey);
          setAttempt(null);
          setError(result.message);
        }
        return;
      }

      clearPendingRequest(storageKey);
      setAttempt(null);
      setSelected(null);
      setQuantityChange('');
      setReason('');
      setMessage('Inventory adjustment recorded and audited.');
    } catch (requestError) {
      setError(`${requestError.message} The result may be uncertain; retry to reuse the saved request key.`);
    } finally {
      setSaving(false);
    }
  };

  const resolveConflict = () => {
    if (!window.confirm('Have you reviewed the earlier adjustment? Confirming discards only the saved local retry details. It does not change inventory. You can then deliberately make a new adjustment.')) return;
    try {
      clearPendingRequest(storageKey);
      setAttempt(null);
      setConflict(false);
      setQuantityChange('');
      setReason('');
      setError('');
      setMessage('Earlier attempt reviewed. Save Adjustment will create a new change only when you choose it.');
    } catch {
      setError('The saved adjustment could not be cleared and remains unchanged. Check browser storage and try again.');
    }
  };

  return <><div className="pageHead"><div><h1>Branch Inventory</h1><p>Manage {branchName} physical stock, reserved stock and bin locations.</p></div></div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="card"><div className="toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search parts..."/><select value={category} onChange={event => setCategory(event.target.value)}><option value="">All Categories</option>{[...new Set(parts.map(part => part.category).filter(Boolean))].map(item => <option key={item} value={item}>{item}</option>)}</select></div>
      <div className="tableWrap"><table><thead><tr><th>Part</th><th>SKU</th><th>Available</th><th>Reserved</th><th>Minimum</th><th>Bin</th><th>Status</th><th>Stock</th></tr></thead><tbody>{visibleParts.map(part => {
        const available = availableStock(part.id, branchId);
        const stock = Number(part.stock[branchId] || 0);
        const reserved = stock - available;
        const minimum = part.reorderLevels[branchId] || 0;
        return <tr key={part.id}><td><b>{part.name}</b><small>{part.supplier}</small></td><td>{part.sku}</td><td>{available}</td><td>{reserved}</td><td>{minimum}</td><td>{part.bin[branchId] || '-'}</td><td><Badge type={minimum > 0 && available <= minimum ? 'low-stock' : 'available'}>{minimum > 0 && available <= minimum ? 'Low Stock' : 'Healthy'}</Badge></td><td><button className="secondary" disabled={Boolean(attempt)} onClick={() => { setSelected(part); setQuantityChange(''); setReason(''); setError(''); }}>Adjust</button></td></tr>;
      })}</tbody></table>{visibleParts.length === 0 && <div className="empty">No parts match these filters.</div>}</div>
    </div>
    {selected && <Modal title={`Adjust ${selected.name}`} onClose={() => !saving && !attempt && setSelected(null)} actions={<><button className="secondary" onClick={() => !attempt && setSelected(null)} disabled={saving || Boolean(attempt)}>Cancel</button><button className="primary" type="submit" form="inventory-adjustment" disabled={saving || conflict}>{saving ? 'Saving...' : attempt ? 'Retry Adjustment' : 'Save Adjustment'}</button>{conflict && <button type="button" onClick={resolveConflict} disabled={saving}>I reviewed it; allow a new adjustment</button>}</>}>
      <p>Current physical stock: <b>{selected.stock[branchId] || 0}</b></p>
      <form id="inventory-adjustment" onSubmit={submit}>
        <label>Quantity Change<input type="number" min="-1000000" max="1000000" step="1" value={attempt?.payload.quantityChange ?? quantityChange} disabled={saving || Boolean(attempt)} onChange={event => setQuantityChange(event.target.value)} required/></label>
        <label>Reason<textarea value={attempt?.payload.reason ?? reason} disabled={saving || Boolean(attempt)} onChange={event => setReason(event.target.value)} maxLength="500" required/></label>
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    </Modal>}
  </>;
}
