import { useState } from 'react';
import Badge from '../../components/Badge';
import { money } from '../../data/mockData';
import { useInventory } from '../../data/InventoryContext';

export default function RepairJobs({ onOpenWorkOrder }) {
  const { jobs, parts, account } = useInventory();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const branchJobs = jobs.filter(job => job.branch === account?.branch
    && (!status || job.status === status)
    && (!query || `${job.number} ${job.customer} ${job.vehicle}`.toLowerCase().includes(query.toLowerCase())));
  return <><div className="pageHead"><div><h1>My Repair Jobs</h1><p>Assigned customer repair work orders and billing status.</p></div></div><div className="card"><div className="toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search repair order, customer or vehicle..."/><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All Statuses</option><option>In Progress</option><option>Open</option><option>Completed</option><option>Cancelled</option></select></div>{branchJobs.length ? branchJobs.map(job => <div className="jobCard" key={job.id}><div><div className="jobTitle">{job.number} <Badge>{job.status}</Badge></div><h3>{job.customer}</h3><p>{job.vehicle} · {job.branchName}</p><div className="chips">{job.parts.map(partId => <span key={partId}>{parts.find(part => part.id === partId)?.name}</span>)}</div></div><div className="jobRight"><b>{money(job.total)}</b><button className="secondary" onClick={() => onOpenWorkOrder(job.id)}>View Details</button></div></div>) : <div className="empty">{jobs.some(job => job.branch === account?.branch) ? 'No repair jobs match these filters.' : 'No repair jobs have been assigned to this branch.'}</div>}</div></>;
}
