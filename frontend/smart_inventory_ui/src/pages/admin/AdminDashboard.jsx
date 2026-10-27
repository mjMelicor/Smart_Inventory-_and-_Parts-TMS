import StatCard from '../../components/StatCard';
import { money } from '../../data/mockData';
import { useInventory } from '../../data/InventoryContext';

export default function AdminDashboard({ setPage }) {
  const { parts, transfers, branches, dailySales, audit, availableStock, apiReady } = useInventory();
  const inventoryValue = parts.reduce((sum, part) => sum + Object.values(part.stock).reduce((total, quantity) => total + quantity * part.cost, 0), 0);
  const lowStock = parts.reduce((count, part) => count + branches.filter(branch => {
    const minimum = part.reorderLevels[branch.id] || 0;
    return minimum > 0 && availableStock(part.id, branch.id) <= minimum;
  }).length, 0);
  return <><div className="pageHead"><div><h1>Head Office Dashboard</h1><p>Company-wide inventory, users and transfer monitoring.</p></div><button className="primary" onClick={() => setPage('global')}>View Global Inventory</button></div>
    <div className="stats"><StatCard label="Branches" value={branches.length} icon="⌂"/><StatCard label="Total Parts" value={parts.length} icon="▦"/><StatCard label="Inventory Value" value={money(inventoryValue)} icon="₱"/><StatCard label="Today's Revenue" value={money(dailySales?.repairBillings || 0)} icon="▥"/><StatCard label="Low Stock Records" value={lowStock} icon="⚠"/><StatCard label="Pending Transfers" value={transfers.filter(transfer => transfer.status === 'Pending Approval').length} icon="⇄"/></div>
    <div className="grid2"><section className="card"><h3>Inventory by Branch</h3>{branches.map(branch => {
      const quantity = parts.reduce((sum, part) => sum + Number(part.stock[branch.id] || 0), 0);
      return <div className="progressRow" key={branch.id}><span>{branch.name}</span><div><i style={{ width: `${Math.min(100, quantity)}%` }}></i></div><b>{quantity} units</b></div>;
    })}</section><section className="card"><h3>System Health</h3><div className="health"><span>API & Database</span><b>{apiReady ? 'Connected' : 'Unavailable'}</b></div><div className="health"><span>Inventory Sync</span><b>{apiReady ? 'Live API' : 'Not available'}</b></div><div className="health"><span>Audit Logging</span><b>{audit.length ? 'Activity recorded' : 'No activity recorded'}</b></div></section></div>
  </>;
}
