import { useState } from 'react';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { useInventory } from '../../data/InventoryContext';

export default function Branches() {
  const { branchAdminRows, users, createBranch, updateBranch } = useInventory();
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const open = branch => {
    setSelected(branch || {});
    setForm(branch ? { code: branch.code, name: branch.name, address: branch.address, phone: branch.phone || '' } : { code: '', name: '', address: '', phone: '' });
    setError('');
  };
  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''));
    const result = selected.id ? await updateBranch(selected.dbId, body) : await createBranch(body);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSelected(null);
    setMessage('Branch saved.');
  };
  const toggleActive = async branch => {
    const result = await updateBranch(branch.dbId, { isActive: !branch.isActive });
    setMessage(result.ok ? 'Branch status updated.' : result.message);
  };

  return <><div className="pageHead"><div><h1>Branches</h1><p>Manage shop locations and branch managers.</p></div><button className="primary" onClick={() => open(null)}>+ Add Branch</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="cards3">{branchAdminRows.map(branch => {
      const manager = users.find(user => user.branch === branch.code && user.role === 'Branch Manager');
      return <div className="card branchCard" key={branch.id}><div className="branchIcon">⌂</div><h3>{branch.name}</h3><p>{branch.address}</p><div className="health"><span>Branch code</span><b>{branch.code}</b></div><div className="health"><span>Manager</span><b>{manager?.name || 'Not assigned'}</b></div><div className="health"><span>Staff / Inventory records</span><b>{branch.userCount} / {branch.inventoryCount}</b></div><Badge type={branch.isActive ? 'active' : ''}>{branch.isActive ? 'Active' : 'Inactive'}</Badge><button className="secondary wide" onClick={() => open(branch)}>Edit Branch</button><button className="linkBtn wide" onClick={() => toggleActive(branch)}>{branch.isActive ? 'Deactivate' : 'Activate'}</button></div>;
    })}</div>
    {selected && <Modal title={selected.id ? 'Edit Branch' : 'Add Branch'} onClose={() => setSelected(null)} actions={<><button className="secondary" onClick={() => setSelected(null)}>Cancel</button><button className="primary" type="submit" form="branch-form" disabled={saving}>{saving ? 'Saving…' : 'Save Branch'}</button></>}>
      <form id="branch-form" onSubmit={submit}>
        <label>Branch Code<input value={form.code || ''} onChange={event => setForm({ ...form, code: event.target.value.toUpperCase() })} required maxLength="10" /></label>
        <label>Name<input value={form.name || ''} onChange={event => setForm({ ...form, name: event.target.value })} required maxLength="100" /></label>
        <label>Address<input value={form.address || ''} onChange={event => setForm({ ...form, address: event.target.value })} required maxLength="1000" /></label>
        <label>Phone<input value={form.phone || ''} onChange={event => setForm({ ...form, phone: event.target.value })} maxLength="20" /></label>
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    </Modal>}
  </>;
}
