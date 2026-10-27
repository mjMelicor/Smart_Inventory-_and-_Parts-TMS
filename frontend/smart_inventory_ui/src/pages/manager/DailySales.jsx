import { useEffect, useState } from 'react';
import StatCard from '../../components/StatCard';
import { money } from '../../data/mockData';
import { useInventory } from '../../data/InventoryContext';

export default function DailySales() {
  const { dailySales, loadDailySales, account, branches } = useInventory();
  const branchName = branches.find(branch => branch.id === account.branch)?.name || account.branchName;
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (dailySales?.date) setDate(dailySales.date); }, [dailySales?.date]);

  const loadReport = async event => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await loadDailySales(date);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const report = dailySales || { date, repairBillings: 0, workOrderCount: 0, partsRevenue: 0, laborRevenue: 0, sales: [] };
  return <><div className="pageHead"><div><h1>Daily Sales Report</h1><p>{branchName} · {report.date}</p></div></div>
    <form className="toolbar" onSubmit={loadReport}><label>Report date<input type="date" value={date} onChange={event => setDate(event.target.value)} required /></label><button className="primary" type="submit" disabled={loading}>{loading ? 'Loading…' : 'Load Report'}</button></form>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="stats"><StatCard label="Revenue" value={money(report.repairBillings)} icon="₱"/><StatCard label="Repair Jobs" value={report.workOrderCount} icon="🔧"/><StatCard label="Parts Revenue" value={money(report.partsRevenue)} icon="▦"/><StatCard label="Labor Revenue" value={money(report.laborRevenue)} icon="◥"/></div>
    <div className="card"><h3>Completed transactions for {report.date}</h3>{report.sales.length ? <div className="tableWrap"><table><thead><tr><th>Work Order</th><th>Customer</th><th>Status</th><th>Parts</th><th>Labor</th><th>Total</th></tr></thead><tbody>{report.sales.map(sale => <tr key={sale.workOrderId}><td>{sale.workOrderNumber}</td><td>{sale.customerName}</td><td>{sale.status}</td><td>{money(sale.partsTotal)}</td><td>{money(sale.laborFee)}</td><td>{money(sale.total)}</td></tr>)}</tbody></table></div> : <div className="empty">No completed transactions were recorded for this date.</div>}</div>
  </>;
}
