import { useInventory } from '../../data/InventoryContext';
import Badge from '../../components/Badge';

const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;

function exportAudit(rows) {
  const headers = ['Action', 'Part', 'Quantity', 'Branch', 'Destination', 'User', 'Date/Time'];
  const content = [headers, ...rows.map(row => [row.action, row.part, row.qty, row.from, row.to, row.user, row.time])]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'stock-audit-log.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function StockAudit() {
  const { audit } = useInventory();
  return <><div className="pageHead"><div><h1>Stock History & Audit</h1><p>Every addition, removal and movement is recorded for traceability.</p></div><button className="secondary" disabled={!audit.length} onClick={() => exportAudit(audit)}>Export Audit Log</button></div><div className="card">{audit.length ? <div className="tableWrap"><table><thead><tr><th>Action</th><th>Part</th><th>Qty</th><th>From</th><th>To</th><th>User</th><th>Date/Time</th></tr></thead><tbody>{audit.map(entry => <tr key={entry.id}><td><Badge type="active">{entry.action}</Badge></td><td>{entry.part}</td><td>{entry.qty}</td><td>{entry.from}</td><td>{entry.to}</td><td>{entry.user}</td><td>{entry.time}</td></tr>)}</tbody></table></div> : <div className="empty">No stock activity has been recorded.</div>}</div></>;
}
