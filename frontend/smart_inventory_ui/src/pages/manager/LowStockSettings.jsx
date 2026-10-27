import { useEffect, useState } from 'react';
import { useInventory } from '../../data/InventoryContext';

export default function LowStockSettings() {
  const { parts, account, branches, availableStock, saveReorderLevels } = useInventory();
  const branchId = account.branch;
  const branchName = branches.find(branch => branch.id === branchId)?.name || account.branchName;
  const [thresholds, setThresholds] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setThresholds(Object.fromEntries(parts.map(part => [part.id, String(part.reorderLevels[branchId] || 0)])));
  }, [parts, branchId]);

  const save = async event => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const result = await saveReorderLevels(branchId, thresholds);
    if (!result.ok) {
      setMessage(result.message);
      setSaving(false);
      return;
    }
    setMessage('Low-stock thresholds saved.');
    setSaving(false);
  };

  return <><div className="pageHead"><div><h1>Low Stock & Settings</h1><p>Set {branchName} minimum stock thresholds.</p></div><button className="primary" form="low-stock-settings" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    <form id="low-stock-settings" onSubmit={save}><div className="card"><div className="tableWrap"><table><thead><tr><th>Part</th><th>Available Stock</th><th>Minimum Threshold</th><th>Warning</th></tr></thead><tbody>{parts.map(part => {
      const available = availableStock(part.id, branchId);
      const threshold = Number(thresholds[part.id] || 0);
      return <tr key={part.id}><td><b>{part.name}</b><small>{part.sku}</small></td><td>{available}</td><td><input className="smallInput" type="number" min="0" max="1000000" step="1" value={thresholds[part.id] ?? '0'} onChange={event => setThresholds(values => ({ ...values, [part.id]: event.target.value }))} required aria-label={`${part.name} minimum threshold`} /></td><td>{threshold > 0 && available <= threshold ? 'Low stock' : 'Healthy'}</td></tr>;
    })}</tbody></table></div></div></form>
  </>;
}
