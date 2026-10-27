import { useState } from 'react';
import { useInventory } from '../../data/InventoryContext';
import Badge from '../../components/Badge';
export default function DispatchTransfers() {
  const { transfers, parts, account, branches, dispatchTransfer } = useInventory();
  const [message, setMessage] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const list = transfers.filter(transfer => ['Approved', 'Dispatched'].includes(transfer.status) && transfer.from === account.branch);

  const dispatch = async id => {
    if (processingId) return;
    setProcessingId(id);
    setMessage('');
    try {
      const result = await dispatchTransfer(id);
      if (result.ok) {
        setMessage('Transfer marked as dispatched.');
      } else if (result.refreshed) {
        setMessage(`The dispatch response was not confirmed: ${result.message} Transfer status was refreshed; check the status column before trying again.`);
      } else {
        setMessage(`The current transfer status could not be confirmed: ${result.message} ${result.refreshError ? `Refresh failed: ${result.refreshError}` : ''} Do not retry until the transfer status has been checked.`);
      }
    } finally {
      setProcessingId(null);
    }
  };

  return <>
    <div className="pageHead"><div><h1>Dispatch Transfers</h1><p>Prepare approved parts for shipment to another branch.</p></div></div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="card">
      {list.length === 0 ? <div className="empty">No approved transfers are waiting for dispatch.</div> : <div className="tableWrap"><table>
        <thead><tr><th>Transfer</th><th>Part</th><th>Quantity</th><th>Destination</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{list.map(transfer => <tr key={transfer.id}>
          <td>{transfer.code}</td>
          <td>{parts.find(part => part.id === transfer.part)?.name}</td>
          <td>{transfer.qty}</td>
          <td>{branches.find(branch => branch.id === transfer.to)?.name}</td>
          <td><Badge>{transfer.status}</Badge></td>
          <td>{transfer.status === 'Approved'
            ? <button className="primary" onClick={() => dispatch(transfer.id)} disabled={processingId === transfer.id}>{processingId === transfer.id ? 'Dispatching…' : 'Mark Dispatched'}</button>
            : <button className="secondary" disabled>Dispatched</button>}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
  </>;
}
