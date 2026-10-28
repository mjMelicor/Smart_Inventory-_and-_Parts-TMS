import Badge from '../../components/Badge';
import StatCard from '../../components/StatCard';
import { useInventory } from '../../data/InventoryContext';
import { localDate, partsUsedOnDate } from '../../data/technicianMetrics';

export default function TechnicianDashboard({ setPage }) {
  const { jobs, transfers, parts, account, branches, availableStock } = useInventory();
  const branchId = account?.branch;
  const branchName = branches.find(branch => branch.id === branchId)?.name || account?.branchName || 'Branch';
  const branchJobs = jobs.filter(job => job.branch === branchId);
  const openJobs = branchJobs.filter(job => !['Completed', 'Cancelled'].includes(job.status));
  const partsUsedToday = partsUsedOnDate(branchJobs, localDate(new Date()));

  return <><div className="pageHead"><div><h1>Technician Dashboard</h1><p>Welcome back, {account?.name}. Here is your repair and parts activity.</p></div><button className="primary" onClick={() => setPage('parts')}>Search Parts</button></div>
    <div className="stats"><StatCard label="Open Repair Jobs" value={openJobs.length} icon="🔧"/><StatCard label="Parts Available" value={parts.reduce((total, part) => total + availableStock(part.id, branchId), 0)} sub={branchName} icon="▦"/><StatCard label="Pending Transfers" value={transfers.filter(transfer => transfer.status === 'Pending Approval').length} icon="⇄"/><StatCard label="Parts Used Today" value={partsUsedToday} sub="Units added to jobs today" icon="▦"/></div>
    <div className="grid2"><section className="card"><div className="sectionTitle"><h3>My Repair Jobs</h3><button className="linkBtn" onClick={() => setPage('jobs')}>View all</button></div>{branchJobs.length ? branchJobs.map(job => <div className="listRow" key={job.id}><div><b>{job.number} · {job.customer}</b><small>{job.vehicle}</small></div><Badge>{job.status}</Badge></div>) : <div className="empty">No repair jobs assigned yet.</div>}</section><section className="card"><div className="sectionTitle"><h3>Transfer Requests</h3><button className="linkBtn" onClick={() => setPage('transfers')}>View all</button></div>{transfers.length ? transfers.map(transfer => <div className="listRow" key={transfer.id}><div><b>{transfer.code} · {parts.find(part => part.id === transfer.part)?.name}</b><small>{transfer.qty} units · {transfer.from} → {transfer.to}</small></div><Badge>{transfer.status}</Badge></div>) : <div className="empty">No transfer activity yet.</div>}</section></div>
  </>;
}
