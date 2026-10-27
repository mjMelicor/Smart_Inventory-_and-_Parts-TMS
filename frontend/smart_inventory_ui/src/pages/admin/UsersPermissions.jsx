import { useState } from 'react';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { useInventory } from '../../data/InventoryContext';

const roleToApi = { Technician: 'technician', 'Branch Manager': 'branch_manager', 'Head Office Admin': 'head_office_admin' };

export default function UsersPermissions() {
  const { users, branches, createUser, updateUser } = useInventory();
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const visibleUsers = users.filter(user =>
    (!query || `${user.name} ${user.email} ${user.branch}`.toLowerCase().includes(query.toLowerCase()))
    && (!roleFilter || user.role === roleFilter)
  );
  const open = user => {
    setSelected(user || {});
    setForm(user ? {
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      branchId: branches.find(branch => branch.id === user.branch)?.dbId || ''
    } : { firstName: '', lastName: '', email: '', role: 'Technician', branchId: '' });
    setMessage('');
    setError('');
  };
  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    const body = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      ...(selected.id ? {} : { email: form.email.trim(), role: roleToApi[form.role] }),
      ...(selected.id ? { role: roleToApi[form.role] } : {}),
      branchId: form.role === 'Head Office Admin' ? null : form.branchId
    };
    const result = selected.id ? await updateUser(selected.id, body) : await createUser(body);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.response?.temporaryPassword) {
      setMessage(`User created. Temporary password: ${result.response.temporaryPassword}. Save this now; it will not be shown again.`);
    }
    setSelected(null);
  };
  const toggleActive = async user => {
    const result = await updateUser(user.id, { isActive: user.status !== 'Active' });
    setMessage(result.ok ? `Account ${user.status === 'Active' ? 'deactivated' : 'activated'}.` : result.message);
  };

  return <><div className="pageHead"><div><h1>Users & Permissions</h1><p>Create, update, deactivate and assign staff roles.</p></div><button className="primary" onClick={() => open(null)}>+ Add User</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="card"><div className="toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search users..." /><select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">All Roles</option><option>Technician</option><option>Branch Manager</option><option>Head Office Admin</option></select></div>{users.length ? <div className="tableWrap"><table><thead><tr><th>User</th><th>Role</th><th>Branch</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleUsers.map(user => <tr key={user.id}><td><b>{user.name}</b><small>{user.email}</small></td><td>{user.role}</td><td>{branches.find(branch => branch.id === user.branch)?.name || user.branch}</td><td><Badge type={user.status === 'Active' ? 'active' : ''}>{user.status}</Badge></td><td><button className="secondary" onClick={() => open(user)}>Edit</button> <button className="danger ghost" onClick={() => toggleActive(user)}>{user.status === 'Active' ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table>{visibleUsers.length === 0 && <div className="empty">No users match these filters.</div>}</div> : <div className="empty">No users have been added.</div>}</div>
    {selected && <Modal title={selected.id ? 'Edit User' : 'Add User'} onClose={() => setSelected(null)} actions={<><button className="secondary" onClick={() => setSelected(null)}>Cancel</button><button className="primary" form="user-form" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save User'}</button></>}>
      <form id="user-form" onSubmit={submit}>
        <label>First Name<input value={form.firstName || ''} onChange={event => setForm({ ...form, firstName: event.target.value })} required maxLength="75" /></label>
        <label>Last Name<input value={form.lastName || ''} onChange={event => setForm({ ...form, lastName: event.target.value })} required maxLength="75" /></label>
        {!selected.id && <label>Email<input type="email" value={form.email || ''} onChange={event => setForm({ ...form, email: event.target.value })} required /></label>}
        <label>Role<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value, branchId: '' })}><option>Technician</option><option>Branch Manager</option><option>Head Office Admin</option></select></label>
        {form.role !== 'Head Office Admin' && <label>Branch<select value={form.branchId || ''} onChange={event => setForm({ ...form, branchId: event.target.value })} required><option value="">Select a branch</option>{branches.map(branch => <option value={branch.dbId} key={branch.id}>{branch.name}</option>)}</select></label>}
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    </Modal>}
  </>;
}
