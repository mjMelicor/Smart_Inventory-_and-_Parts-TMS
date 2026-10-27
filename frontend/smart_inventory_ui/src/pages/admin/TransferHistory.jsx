import Badge from '../../components/Badge';
import { useInventory } from '../../data/InventoryContext';

const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

export default function TransferHistory() {
  const { transfers, parts, branches } = useInventory();

  const branchName = branchCode =>
    branches.find(branch => branch.id === branchCode)?.name || branchCode || '';

  const exportCsv = () => {
    const rows = [
      [
        'Transfer Number',
        'Part',
        'Source Branch',
        'Destination Branch',
        'Requested Qty',
        'Approved Qty',
        'Received Qty',
        'Status',
        'Requester',
        'Date'
      ],
      ...transfers.map(transfer => [
        transfer.code,
        parts.find(part => part.id === transfer.part)?.name,
        branchName(transfer.from),
        branchName(transfer.to),
        transfer.requestedQty,
        transfer.approvedQty,
        transfer.receivedQty,
        transfer.status,
        transfer.requester,
        transfer.date
      ])
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transfer-history.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return <>
    <div className="pageHead">
      <div>
        <h1>Transfer History</h1>
        <p>Complete branch-to-branch movement history and status.</p>
      </div>
      <button className="secondary" onClick={exportCsv} disabled={!transfers.length}>
        Export CSV
      </button>
    </div>
    <div className="card">
      {transfers.length ? <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Transfer Number</th>
              <th>Part</th>
              <th>From</th>
              <th>To</th>
              <th>Requested Qty</th>
              <th>Approved Qty</th>
              <th>Received Qty</th>
              <th>Requester</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map(transfer => <tr key={transfer.id}>
              <td>{transfer.code}</td>
              <td>{parts.find(part => part.id === transfer.part)?.name || '—'}</td>
              <td>{branchName(transfer.from)}</td>
              <td>{branchName(transfer.to)}</td>
              <td>{transfer.requestedQty ?? 0}</td>
              <td>{transfer.approvedQty ?? 0}</td>
              <td>{transfer.receivedQty ?? 0}</td>
              <td>{transfer.requester || '—'}</td>
              <td>{transfer.date || '—'}</td>
              <td><Badge>{transfer.status}</Badge></td>
            </tr>)}
          </tbody>
        </table>
      </div> : <div className="empty">No transfer history has been recorded.</div>}
    </div>
  </>;
}
