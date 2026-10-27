import { useState } from 'react';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { useInventory } from '../../data/InventoryContext';

export default function TransferApprovals() {
  const { transfers, parts, account, branches, availableStockForTransfer, updateTransfer } = useInventory();
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const pending = transfers.filter(transfer => transfer.status === 'Pending Approval' && transfer.from === account.branch);

  const open = (transfer, action) => {
    setSelected({ ...transfer, action });
    setReason('');
    setError('');
    setNeedsReview(false);
  };

  const confirm = async () => {
    if (saving || !selected) return;
    if (selected.action === 'Reject' && !reason.trim()) {
      setError('Enter a reason for rejecting this transfer.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await updateTransfer(
        selected.id,
        selected.action === 'Approve' ? 'Approved' : 'Rejected',
        reason
      );
      if (!result.ok) {
        setNeedsReview(true);
        setError(result.refreshed
          ? `${result.message} The transfer list was refreshed. Close this dialog and review its current status before trying again.`
          : `${result.message} The current status could not be verified${result.refreshError ? `: ${result.refreshError}` : ''}. Do not retry until you check the transfer status.`);
        return;
      }
      setSelected(null);
    } finally {
      setSaving(false);
    }
  };

  return <>
    <div className="pageHead"><div><h1>Transfer Approvals</h1><p>Verify physical stock before approving or rejecting requests.</p></div></div>
    <div className="card">
      {pending.length === 0 ? <div className="empty">No pending transfer requests.</div> : pending.map(transfer => (
        <div className="approval" key={transfer.id}>
          <div>
            <div className="muted">{transfer.code} · {transfer.date}</div>
            <h3>{parts.find(part => part.id === transfer.part)?.name}</h3>
            <p><b>{transfer.qty} units</b> requested from <b>{branches.find(branch => branch.id === transfer.from)?.name}</b> to <b>{branches.find(branch => branch.id === transfer.to)?.name}</b>.</p>
            {transfer.reason && <p>Reason: {transfer.reason}</p>}
            <div className="notice">Available after reservations: {availableStockForTransfer(transfer)} units.</div>
          </div>
          <div className="actions">
            <button className="danger" onClick={() => open(transfer, 'Reject')}>Reject</button>
            <button className="primary" disabled={availableStockForTransfer(transfer) < transfer.qty} onClick={() => open(transfer, 'Approve')}>Approve</button>
          </div>
        </div>
      ))}
    </div>
    {selected && <Modal
      title={`${selected.action} Transfer ${selected.code}`}
      onClose={() => {
        if (saving) return;
        setSelected(null);
        setNeedsReview(false);
      }}
      actions={<>
        <button className="secondary" onClick={() => { setSelected(null); setNeedsReview(false); }} disabled={saving}>Cancel</button>
        <button className={selected.action === 'Reject' ? 'danger' : 'primary'} onClick={confirm} disabled={saving || needsReview}>
          {saving ? 'Saving…' : needsReview ? 'Review Status' : `${selected.action} Transfer`}
        </button>
      </>}
    >
      <p>You are about to <b>{selected.action.toLowerCase()}</b> a request for <b>{selected.qty} units</b>.</p>
      {selected.action === 'Reject' && <label>Reason<textarea value={reason} onChange={event => { setReason(event.target.value); setError(''); }} maxLength="500" placeholder="Reason for rejecting this transfer..." required disabled={saving} /></label>}
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="stockCheck"><span>Available source stock</span><b>{availableStockForTransfer(selected)} units</b></div>
    </Modal>}
  </>;
}
