import { useState } from 'react';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { useInventory } from '../../data/InventoryContext';
import { money } from '../../data/mockData';
import { clearPendingRequest, createIdempotencyKey, loadPendingRequest, savePendingRequest } from '../../data/idempotency';

const emptyForm = { customerName: '', customerPhone: '', vehicleModel: '', vehicleVinOrPlate: '', laborFee: '0', assignedTechnicianId: '' };

export default function ManagerWorkOrders() {
  const { jobs, technicians, account, createWorkOrder, updateWorkOrder } = useInventory();
  const orders = jobs.filter(job => job.branch === account.branch);
  const storageKey = `smart-inventory:pending-work-order:${account.id}`;
  const [attempt, setAttempt] = useState(() => loadPendingRequest(storageKey));
  const [show, setShow] = useState(() => Boolean(loadPendingRequest(storageKey)));
  const [form, setForm] = useState(() => loadPendingRequest(storageKey)?.payload || emptyForm);
  const [error, setError] = useState(() => loadPendingRequest(storageKey)?.requiresReview
    ? 'This key conflicts with an earlier work-order request. Review that request before starting another.'
    : loadPendingRequest(storageKey) ? 'A work-order request is saved. Retry it to reuse the same request key.' : '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(() => Boolean(loadPendingRequest(storageKey)?.requiresReview));
  const [editingWorkOrder, setEditingWorkOrder] = useState(null);

  const submit = async event => {
    event.preventDefault();
    if (saving || conflict) return;
    let current = attempt;
    if (!current && !editingWorkOrder) {
      const { assignedTechnicianId, ...formFields } = form;
      const payload = {
        ...formFields,
        laborFee: Number(form.laborFee),
        ...(assignedTechnicianId ? { assignedTechnicianId } : {})
      };
      try {
        current = { key: createIdempotencyKey(), payload };
        savePendingRequest(storageKey, current);
        setAttempt(current);
      } catch (storageError) {
        setError(`${storageError.message || 'The request key could not be saved.'} No work order was created.`);
        return;
      }
    }
    if (editingWorkOrder) {
      current = { payload: { ...form, laborFee: Number(form.laborFee), assignedTechnicianId: form.assignedTechnicianId || null } };
    }

    setSaving(true);
    setError('');
    try {
      const result = editingWorkOrder
        ? await updateWorkOrder(editingWorkOrder.id, {
          ...current.payload,
          assignedTechnicianId: current.payload.assignedTechnicianId || null
        })
        : await createWorkOrder(current.payload, account.branch, current.key);
      if (!result.ok) {
        if (result.conflict) {
          const reviewAttempt = { ...current, requiresReview: true };
          try { savePendingRequest(storageKey, reviewAttempt); } catch { /* Keep the saved attempt locked. */ }
          setAttempt(reviewAttempt);
          setConflict(true);
          setError('This key conflicts with an earlier work order. Review that request before starting another. The saved details are being kept.');
        } else if (result.uncertain) {
          setError(`${result.message} Retry the same request; its saved key and details will be reused.`);
        } else {
          clearPendingRequest(storageKey);
          setAttempt(null);
          setError(result.message);
        }
        return;
      }

      if (!editingWorkOrder) {
        clearPendingRequest(storageKey);
        setAttempt(null);
      }
      setShow(false);
      setEditingWorkOrder(null);
      setForm(emptyForm);
      setMessage(editingWorkOrder ? 'Work order updated.' : 'Work order created.');
    } catch (requestError) {
      setError(`${requestError.message} The result may be uncertain; retry to reuse the saved request key.`);
    } finally {
      setSaving(false);
    }
  };

  const resolveConflict = () => {
    if (!window.confirm('Have you reviewed the earlier work-order request? Confirming discards only the saved local retry details. It does not change any records. You can then deliberately create a new work order.')) return;
    try {
      clearPendingRequest(storageKey);
      setAttempt(null);
      setConflict(false);
      setEditingWorkOrder(null);
      setForm(emptyForm);
      setError('');
      setMessage('Earlier request reviewed. Create Work Order will create a new record only when you choose it.');
    } catch {
      setError('The saved request could not be cleared and remains unchanged. Check browser storage and try again.');
    }
  };

  const openForEdit = order => {
    setEditingWorkOrder(order);
    setForm({
      customerName: order.customer,
      customerPhone: order.customerPhone || '',
      vehicleModel: order.vehicleModel || '',
      vehicleVinOrPlate: order.vehicleVinOrPlate,
      laborFee: String(order.labor),
      assignedTechnicianId: order.assignedTechnicianId || ''
    });
    setError('');
    setShow(true);
  };

  return <><div className="pageHead"><div><h1>Work Orders</h1><p>Create and assign repair jobs for your branch technicians.</p></div><button className="primary" onClick={() => { setError(''); setShow(true); }} disabled={Boolean(attempt)}>+ Create Work Order</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="card">{orders.length ? <div className="tableWrap"><table><thead><tr><th>Work Order</th><th>Customer</th><th>Vehicle</th><th>Technician</th><th>Status</th><th>Billing</th><th>Actions</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td>{order.number}</td><td>{order.customer}</td><td>{order.vehicle}</td><td>{technicians.find(tech => tech.id === order.assignedTechnicianId)?.name || 'Unassigned'}</td><td><Badge>{order.status}</Badge></td><td>{money(order.total)}</td><td><button className="secondary" onClick={() => openForEdit(order)} disabled={Boolean(attempt) || ['Completed', 'Cancelled'].includes(order.status)}>Edit</button></td></tr>)}</tbody></table></div> : <div className="empty">No work orders are recorded for this branch.</div>}</div>
    {show && <Modal title={editingWorkOrder ? `Edit ${editingWorkOrder.number}` : 'Create Work Order'} onClose={() => !saving && !attempt && (setShow(false), setEditingWorkOrder(null))} actions={<><button className="secondary" onClick={() => !attempt && (setShow(false), setEditingWorkOrder(null))} disabled={saving || Boolean(attempt)}>Cancel</button><button className="primary" form="work-order-form" type="submit" disabled={saving || conflict}>{saving ? 'Saving...' : attempt ? 'Retry Work Order' : editingWorkOrder ? 'Save Changes' : 'Create Work Order'}</button>{conflict && <button type="button" onClick={resolveConflict} disabled={saving}>I reviewed it; allow a new work order</button>}</>}>
      <form id="work-order-form" onSubmit={submit}>
        <label>Customer Name<input value={attempt?.payload.customerName ?? form.customerName} onChange={event => setForm({ ...form, customerName: event.target.value })} required maxLength="150" disabled={saving || Boolean(attempt)}/></label>
        <label>Customer Phone<input value={attempt?.payload.customerPhone ?? form.customerPhone} onChange={event => setForm({ ...form, customerPhone: event.target.value })} maxLength="20" disabled={saving || Boolean(attempt)}/></label>
        <label>Vehicle Model<input value={attempt?.payload.vehicleModel ?? form.vehicleModel} onChange={event => setForm({ ...form, vehicleModel: event.target.value })} maxLength="150" disabled={saving || Boolean(attempt)}/></label>
        <label>VIN or Plate<input value={attempt?.payload.vehicleVinOrPlate ?? form.vehicleVinOrPlate} onChange={event => setForm({ ...form, vehicleVinOrPlate: event.target.value })} required maxLength="50" disabled={saving || Boolean(attempt)}/></label>
        <label>Labor Fee<input type="number" min="0" step="0.01" value={attempt?.payload.laborFee ?? form.laborFee} onChange={event => setForm({ ...form, laborFee: event.target.value })} required disabled={saving || Boolean(attempt)}/></label>
        <label>Assign Technician<select value={attempt?.payload.assignedTechnicianId || form.assignedTechnicianId || ''} onChange={event => setForm({ ...form, assignedTechnicianId: event.target.value })} disabled={saving || Boolean(attempt)}><option value="">Leave unassigned</option>{technicians.filter(technician => String(technician.branchId) === String(account.branchId)).map(technician => <option key={technician.id} value={technician.id}>{technician.name} ({technician.email})</option>)}</select></label>
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    </Modal>}
  </>;
}
