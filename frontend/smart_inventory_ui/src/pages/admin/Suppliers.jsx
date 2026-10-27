import { useState } from 'react';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { useInventory } from '../../data/InventoryContext';
import { clearPendingRequest, createIdempotencyKey, loadPendingRequest, savePendingRequest } from '../../data/idempotency';

const emptyForm = { companyName: '', contactPerson: '', email: '', phone: '', address: '' };

export default function Suppliers() {
  const { account, suppliers, createSupplier, updateSupplier, parts } = useInventory();
  const storageKey = `smart-inventory:pending-supplier:${account.id}`;
  const [attempt, setAttempt] = useState(() => loadPendingRequest(storageKey));
  const [selected, setSelected] = useState(() => loadPendingRequest(storageKey) ? {} : null);
  const [form, setForm] = useState(() => loadPendingRequest(storageKey)?.payload || emptyForm);
  const [error, setError] = useState(() => loadPendingRequest(storageKey)?.requiresReview
    ? 'This supplier request key conflicts with an earlier attempt. Review it before starting another.'
    : loadPendingRequest(storageKey) ? 'A supplier request is saved. Retry it to reuse the same key.' : '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(() => Boolean(loadPendingRequest(storageKey)?.requiresReview));

  const open = supplier => {
    setSelected(supplier || {});
    setForm(supplier ? {
      companyName: supplier.companyName,
      contactPerson: supplier.contactPerson || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || ''
    } : emptyForm);
    setError('');
  };

  const submit = async event => {
    event.preventDefault();
    if (saving || conflict) return;
    if (selected?.id) {
      setSaving(true);
      const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''));
      const result = await updateSupplier(selected.id, body);
      setSaving(false);
      if (!result.ok) { setError(result.message); return; }
      setSelected(null);
      setMessage('Supplier saved.');
      return;
    }

    let current = attempt;
    if (!current) {
      const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''));
      try {
        current = { key: createIdempotencyKey(), payload };
        savePendingRequest(storageKey, current);
        setAttempt(current);
      } catch (storageError) {
        setError(`${storageError.message || 'The request key could not be saved.'} No supplier was created.`);
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      const result = await createSupplier(current.payload, current.key);
      if (!result.ok) {
        if (result.conflict) {
          const reviewAttempt = { ...current, requiresReview: true };
          try { savePendingRequest(storageKey, reviewAttempt); } catch { /* Preserve the saved attempt. */ }
          setAttempt(reviewAttempt);
          setConflict(true);
          setError('This key conflicts with a previously submitted supplier request. Review it before starting another; the saved details are being kept.');
        } else if (result.uncertain) {
          setError(`${result.message} Retry this supplier request; the same key and details will be reused.`);
        } else {
          clearPendingRequest(storageKey);
          setAttempt(null);
          setError(result.message);
        }
        return;
      }
      clearPendingRequest(storageKey);
      setAttempt(null);
      setSelected(null);
      setForm(emptyForm);
      setMessage('Supplier saved.');
    } catch (requestError) {
      setError(`${requestError.message} The result may be uncertain; retry to reuse the saved request key.`);
    } finally {
      setSaving(false);
    }
  };

  const resolveConflict = () => {
    if (!window.confirm('Have you reviewed the earlier supplier request? Confirming discards only the saved local retry details. It does not change any records. You can then deliberately submit a new supplier.')) return;
    try {
      clearPendingRequest(storageKey);
      setAttempt(null);
      setConflict(false);
      setForm(emptyForm);
      setError('');
      setMessage('Earlier request reviewed. Add Supplier will create a new record only when you choose it.');
    } catch {
      setError('The saved request could not be cleared and remains unchanged. Check browser storage and try again.');
    }
  };

  const toggleActive = async supplier => {
    const result = await updateSupplier(supplier.id, { isActive: !supplier.isActive });
    setMessage(result.ok ? 'Supplier status updated.' : result.message);
  };

  return <><div className="pageHead"><div><h1>Suppliers</h1><p>Manage approved automotive parts suppliers.</p></div><button className="primary" onClick={() => open(null)} disabled={Boolean(attempt)}>+ Add Supplier</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="cards3">{suppliers.map(supplier => <div className="card" key={supplier.id}><h3>{supplier.companyName}</h3><p>{supplier.contactPerson || supplier.contact || 'No contact listed'}</p><p>{supplier.email || supplier.phone}</p><div className="health"><span>Parts supplied</span><b>{parts.filter(part => part.supplierId === supplier.id).length}</b></div><Badge type={supplier.isActive ? 'active' : ''}>{supplier.isActive ? 'Active' : 'Inactive'}</Badge><button className="secondary wide" onClick={() => open(supplier)} disabled={Boolean(attempt)}>Edit Supplier</button><button className="linkBtn wide" onClick={() => toggleActive(supplier)} disabled={Boolean(attempt)}>{supplier.isActive ? 'Deactivate' : 'Activate'}</button></div>)}</div>
    {selected && <Modal title={selected.id ? 'Edit Supplier' : 'Add Supplier'} onClose={() => !attempt && !saving && setSelected(null)} actions={<><button className="secondary" onClick={() => !attempt && setSelected(null)} disabled={saving || Boolean(attempt)}>Cancel</button><button className="primary" type="submit" form="supplier-form" disabled={saving || conflict}>{saving ? 'Saving...' : attempt ? 'Retry Supplier Request' : 'Save Supplier'}</button>{conflict && <button type="button" onClick={resolveConflict} disabled={saving}>I reviewed it; allow a new supplier</button>}</>}>
      <form id="supplier-form" onSubmit={submit}>
        <label>Company Name<input value={attempt?.payload.companyName ?? form.companyName} onChange={event => setForm({ ...form, companyName: event.target.value })} required maxLength="150" disabled={saving || Boolean(attempt)}/></label>
        <label>Contact Person<input value={attempt?.payload.contactPerson ?? form.contactPerson} onChange={event => setForm({ ...form, contactPerson: event.target.value })} maxLength="150" disabled={saving || Boolean(attempt)}/></label>
        <label>Email<input type="email" value={attempt?.payload.email ?? form.email} onChange={event => setForm({ ...form, email: event.target.value })} maxLength="255" disabled={saving || Boolean(attempt)}/></label>
        <label>Phone<input value={attempt?.payload.phone ?? form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} maxLength="20" disabled={saving || Boolean(attempt)}/></label>
        <label>Address<textarea value={attempt?.payload.address ?? form.address} onChange={event => setForm({ ...form, address: event.target.value })} maxLength="1000" disabled={saving || Boolean(attempt)}/></label>
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    </Modal>}
  </>;
}
