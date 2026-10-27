import { useState } from 'react';
import { useInventory } from '../../data/InventoryContext';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';

export default function PartsSearch() {
  const { parts, branches, availableStock } = useInventory();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const visibleParts = parts.filter(part => `${part.name} ${part.sku} ${part.category} ${part.supplier}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="pageHead"><div><h1>Parts Search</h1><p>Search auto parts across every branch, with available stock and shelf bin locations.</p></div></div><div className="card"><div className="searchBig">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by part name, SKU, category..."/></div><div className="tableWrap"><table><thead><tr><th>Part</th><th>SKU</th><th>Category</th>{branches.map(branch => <th key={branch.id}>{branch.name}</th>)}<th>Status</th><th></th></tr></thead><tbody>{visibleParts.map(part => {
    const lowAtAnyBranch = branches.some(branch => {
      const minimum = part.reorderLevels[branch.id] || 0;
      return minimum > 0 && availableStock(part.id, branch.id) <= minimum;
    });
    return <tr key={part.id}><td><b>{part.name}</b><small>{part.supplier}</small></td><td>{part.sku}</td><td>{part.category}</td>{branches.map(branch => <td key={branch.id}><b>{availableStock(part.id, branch.id)}</b><small>Bin {part.bin[branch.id] || '-'}</small></td>)}<td><Badge type={lowAtAnyBranch ? 'low-stock' : 'available'}>{lowAtAnyBranch ? 'Low Stock' : 'Available'}</Badge></td><td><button className="secondary" onClick={() => setSelected(part)}>Details</button></td></tr>;
  })}</tbody></table>{visibleParts.length === 0 && <div className="empty">No parts match this search.</div>}</div></div>{selected && <Modal title={selected.name} onClose={() => setSelected(null)}><p>{selected.category} · {selected.sku}</p>{branches.map(branch => <div className="stockLine" key={branch.id}><b>{branch.name}</b><span>{availableStock(selected.id, branch.id)} available · Bin {selected.bin[branch.id] || '-'}</span></div>)}</Modal>}</>;
}
