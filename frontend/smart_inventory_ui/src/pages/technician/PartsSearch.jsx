import { useState } from 'react';
import { branches } from '../../data/mockData';
import { useInventory } from '../../data/InventoryContext';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
export default function PartsSearch(){
 const {parts,availableStock}=useInventory(); const [q,setQ]=useState(''); const [selected,setSelected]=useState(null);
 return <><div className="pageHead"><div><h1>Parts Search</h1><p>Search auto parts across every branch, with available stock and shelf bin locations.</p></div></div><div className="card"><div className="searchBig">⌕<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by part name, SKU, category..."/></div><div className="tableWrap"><table><thead><tr><th>Part</th><th>SKU</th><th>Category</th>{branches.map(b=><th key={b.id}>{b.name}</th>)}<th>Status</th><th></th></tr></thead><tbody>{parts.filter(p=>(p.name+p.sku+p.category).toLowerCase().includes(q.toLowerCase())).map(p=><tr key={p.id}><td><b>{p.name}</b><small>{p.supplier}</small></td><td>{p.sku}</td><td>{p.category}</td>{branches.map(b=><td key={b.id}><b>{availableStock(p.id,b.id)}</b><small>Bin {p.bin[b.id]}</small></td>)}<td><Badge type={Object.values(p.stock).some(v=>v>=p.min)?'available':'low-stock'}>{Object.values(p.stock).some(v=>v>=p.min)?'Available':'Low Stock'}</Badge></td><td><button className="secondary" onClick={()=>setSelected(p)}>Details</button></td></tr>)}</tbody></table></div></div>{selected&&<Modal title={selected.name} onClose={()=>setSelected(null)}><p>{selected.category} · {selected.sku}</p>{branches.map(b=><div className="stockLine" key={b.id}><b>{b.name}</b><span>{availableStock(selected.id,b.id)} available · Bin {selected.bin[b.id]}</span></div>)}</Modal>}</>;
}
