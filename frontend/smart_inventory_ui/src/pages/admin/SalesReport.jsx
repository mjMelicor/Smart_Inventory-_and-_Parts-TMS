import { useEffect, useState } from 'react';
import StatCard from '../../components/StatCard';
import { api } from '../../data/api';
import { useInventory } from '../../data/InventoryContext';
import { money } from '../../data/mockData';

function reportPath(date, branchId) {
  const query = new URLSearchParams();
  if (date) query.set('date', date);
  if (branchId) query.set('branchId', branchId);
  const search = query.toString();
  return `/reports/daily-sales${search ? `?${search}` : ''}`;
}

export default function SalesReport() {
  const { branches, branchAdminRows } = useInventory();
  const reportBranches = branchAdminRows.length ? branchAdminRows : branches;
  const [date, setDate] = useState('');
  const [branchId, setBranchId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api('/reports/daily-sales')
      .then(result => {
        if (!active) return;
        setReport(result);
        setDate(result.date);
      })
      .catch(requestError => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const loadReport = async event => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      setReport(await api(reportPath(date, branchId)));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const sales = report?.sales || [];
  return <>
    <div className="pageHead">
      <div><h1>Sales Report</h1><p>Completed work orders for the selected business date and branch.</p></div>
    </div>
    <form className="toolbar" onSubmit={loadReport}>
      <label>Report date<input type="date" value={date} onChange={event => setDate(event.target.value)} required /></label>
      <label>Branch<select value={branchId} onChange={event => setBranchId(event.target.value)}>
        <option value="">All branches</option>
        {reportBranches.map(branch => <option key={branch.dbId || branch.id} value={branch.dbId || branch.id}>{branch.name}</option>)}
      </select></label>
      <button className="primary" type="submit" disabled={loading || !date}>{loading ? 'Loading…' : 'Load Report'}</button>
    </form>
    {error && <p className="notice" role="alert">{error}</p>}
    {loading && !report ? <div className="card" role="status">Loading sales report…</div> : report && <>
      <div className="stats">
        <StatCard label="Revenue" value={money(report.repairBillings || 0)} icon="₱" />
        <StatCard label="Completed Work Orders" value={report.workOrderCount || 0} icon="▤" />
        <StatCard label="Parts Revenue" value={money(report.partsRevenue || 0)} icon="▦" />
        <StatCard label="Labor Revenue" value={money(report.laborRevenue || 0)} icon="◉" />
      </div>
      <div className="card">
        <h3>Completed transactions for {report.date}{branchId ? ` · ${reportBranches.find(branch => String(branch.dbId || branch.id) === String(branchId))?.name || 'selected branch'}` : ' · All branches'}</h3>
        {sales.length ? <div className="tableWrap"><table><thead><tr><th>Work Order</th><th>Branch</th><th>Customer</th><th>Parts</th><th>Labor</th><th>Total</th></tr></thead><tbody>
          {sales.map(sale => <tr key={sale.workOrderId}>
            <td>{sale.workOrderNumber}</td><td>{sale.branchName}</td><td>{sale.customerName}</td>
            <td>{money(sale.partsTotal)}</td><td>{money(sale.laborFee)}</td><td>{money(sale.total)}</td>
          </tr>)}
        </tbody></table></div> : <div className="empty">No completed transactions were recorded for these filters.</div>}
      </div>
    </>}
  </>;
}
