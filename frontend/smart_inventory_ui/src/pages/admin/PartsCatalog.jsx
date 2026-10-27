import { useState } from 'react';
import Modal from '../../components/Modal';
import { money } from '../../data/mockData';
import { useInventory } from '../../data/InventoryContext';

export default function PartsCatalog() {
  const { parts, suppliers, createPart, updatePart } = useInventory();
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const visibleParts = parts.filter(part =>
    (!query || `${part.name} ${part.sku} ${part.category} ${part.supplier}`.toLowerCase().includes(query.toLowerCase()))
    && (!category || part.category === category)
  );
  const open = part => {
    setSelected(part || {});
    setForm(part ? {
      partNumber: part.sku,
      name: part.name,
      description: part.description || '',
      category: part.category || '',
      supplierId: part.supplierId,
      unitOfMeasure: part.unitOfMeasure || 'each',
      wholesaleCost: String(part.cost),
      retailPrice: String(part.price)
    } : { partNumber: '', name: '', description: '', category: '', supplierId: suppliers[0]?.id || '', unitOfMeasure: 'each', wholesaleCost: '', retailPrice: '' });
    setError('');
  };
  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    const body = {
      ...form,
      wholesaleCost: Number(form.wholesaleCost),
      retailPrice: Number(form.retailPrice)
    };
    const result = selected.id ? await updatePart(selected.id, body) : await createPart(body);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSelected(null);
    setMessage('Part catalog entry saved.');
  };

  return <><div className="pageHead"><div><h1>Parts Catalog & Pricing</h1><p>Manage global part details, supplier, wholesale cost and retail prices.</p></div><button className="primary" onClick={() => open(null)} disabled={!suppliers.length}>+ Add Part</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="card"><div className="toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search catalog..." /><select value={category} onChange={event => setCategory(event.target.value)}><option value="">All Categories</option>{[...new Set(parts.map(part => part.category).filter(Boolean))].map(item => <option key={item} value={item}>{item}</option>)}</select></div><div className="tableWrap"><table><thead><tr><th>Part</th><th>Category</th><th>Supplier</th><th>Wholesale</th><th>Retail</th><th>Margin</th><th>Action</th></tr></thead><tbody>{visibleParts.map(part => <tr key={part.id}><td><b>{part.name}</b><small>{part.sku}</small></td><td>{part.category}</td><td>{part.supplier}</td><td>{money(part.cost)}</td><td>{money(part.price)}</td><td>{part.price ? Math.round((part.price - part.cost) / part.price * 100) : 0}%</td><td><button className="secondary" onClick={() => open(part)}>Edit</button></td></tr>)}</tbody></table>{visibleParts.length === 0 && <div className="empty">No parts match these filters.</div>}</div></div>
    {selected && <Modal title={selected.id ? 'Edit Part' : 'Add Part'} onClose={() => setSelected(null)} actions={<><button className="secondary" onClick={() => setSelected(null)}>Cancel</button><button className="primary" type="submit" form="part-form" disabled={saving}>{saving ? 'Saving…' : 'Save Part'}</button></>}>
      <form id="part-form" onSubmit={submit}>
        <label>Part Number<input value={form.partNumber || ''} onChange={event => setForm({ ...form, partNumber: event.target.value })} required maxLength="100" /></label>
        <label>Part Name<input value={form.name || ''} onChange={event => setForm({ ...form, name: event.target.value })} required maxLength="150" /></label>
        <label>Description<textarea value={form.description || ''} onChange={event => setForm({ ...form, description: event.target.value })} maxLength="2000" /></label>
        <label>Category<input value={form.category || ''} onChange={event => setForm({ ...form, category: event.target.value })} maxLength="100" /></label>
        <label>Supplier<select value={form.supplierId || ''} onChange={event => setForm({ ...form, supplierId: event.target.value })} required>{suppliers.filter(supplier => supplier.isActive).map(supplier => <option value={supplier.id} key={supplier.id}>{supplier.companyName}</option>)}</select></label>
        <label>Unit of Measure<input value={form.unitOfMeasure || ''} onChange={event => setForm({ ...form, unitOfMeasure: event.target.value })} required maxLength="50" /></label>
        <label>Wholesale Cost<input type="number" min="0" step="0.01" value={form.wholesaleCost || ''} onChange={event => setForm({ ...form, wholesaleCost: event.target.value })} required /></label>
        <label>Retail Price<input type="number" min="0" step="0.01" value={form.retailPrice || ''} onChange={event => setForm({ ...form, retailPrice: event.target.value })} required /></label>
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    </Modal>}
  </>;
}
