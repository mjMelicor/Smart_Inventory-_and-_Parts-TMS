import StatCard from '../../components/StatCard';
import Badge from '../../components/Badge';
import { money } from '../../data/mockData';
import { useInventory } from '../../data/InventoryContext';

export default function ManagerDashboard({ setPage }) {
  const { parts, transfers, account, branches, dailySales, availableStock } = useInventory();
  const branchId = account.branch;
  const branchName = branches.find(branch => branch.id === branchId)?.name || account.branchName;
  const low = parts.filter(part => (part.reorderLevels[branchId] || 0) > 0 && availableStock(part.id, branchId) <= part.reorderLevels[branchId]);
  const branchTransfers = transfers.filter(transfer => transfer.from === branchId || transfer.to === branchId);
  const stockValue = parts.reduce((sum, part) => sum + Number(part.stock[branchId] || 0) * part.cost, 0);
  return <><div className="pageHead"><div><h1>Branch Manager Dashboard</h1><p>{branchName} · {account.name}</p></div><button className="primary" onClick={() => setPage('approvals')}>Review Transfers</button></div>
    <div className="stats"><StatCard label="Inventory Value" value={money(stockValue)} icon="₱"/><StatCard label="Low Stock Items" value={low.length} icon="⚠"/><StatCard label="Pending Transfers" value={branchTransfers.filter(transfer => transfer.status === 'Pending Approval').length} icon="⇄"/><StatCard label="Today's Revenue" value={money(dailySales?.repairBillings || 0)} icon="▥"/></div>
    <div className="grid2"><section className="card"><h3>Low Stock Alerts</h3>{low.length ? low.map(part => <div className="listRow" key={part.id}><div><b>{part.name}</b><small>{availableStock(part.id, branchId)} available · minimum {part.reorderLevels[branchId]} · Bin {part.bin[branchId] || '—'}</small></div><Badge type="low-stock">LOW</Badge></div>) : <div className="empty">No low-stock items.</div>}</section>
      <section className="card"><h3>Transfer Queue</h3>{branchTransfers.length ? branchTransfers.map(transfer => <div className="listRow" key={transfer.id}><div><b>{transfer.code}</b><small>{transfer.qty} units · {transfer.from} → {transfer.to}</small></div><Badge>{transfer.status}</Badge></div>) : <div className="empty">No transfer activity yet.</div>}</section></div>
  </>;
}
