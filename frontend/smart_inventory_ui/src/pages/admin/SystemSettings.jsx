import { useState } from 'react';
import { api, expireSession } from '../../data/api';
import { useInventory } from '../../data/InventoryContext';

export default function SystemSettings() {
  const { branches, createSetupCode } = useInventory();
  const [role, setRole] = useState('branch_manager');
  const [branchId, setBranchId] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [setupError, setSetupError] = useState('');
  const [issuingSetupCode, setIssuingSetupCode] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const issueSetupCode = async event => {
    event.preventDefault();
    if (issuingSetupCode) return;
    setIssuingSetupCode(true);
    setSetupError('');
    setSetupCode('');
    try {
      const result = await createSetupCode({ role, ...(role === 'branch_manager' ? { branchId: branches.find(branch => branch.id === branchId)?.dbId } : {}) });
      setSetupCode(result.code);
    } catch (error) {
      const uncertain = !error.status || error.status >= 500;
      setSetupError(uncertain
        ? `${error.message} The code may already have been issued; verify with the intended recipient before generating another.`
        : error.message);
    } finally {
      setIssuingSetupCode(false);
    }
  };
  const changePassword = async event => {
    event.preventDefault();
    if (changingPassword) return;
    setChangingPassword(true);
    setPasswordError('');
    let passwordChanged = false;
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword('');
      setNewPassword('');
      passwordChanged = true;
    } catch (error) {
      setPasswordError(error.message);
    } finally {
      setChangingPassword(false);
    }
    if (passwordChanged) expireSession('Your password was changed. Please sign in again.');
  };

  return <><div className="pageHead"><div><h1>System Settings</h1><p>Manage staff onboarding and your account security.</p></div></div>
    <div className="grid2">
      <section className="card"><h3>Create Staff Setup Code</h3><p>Setup codes are single-use and expire after 24 hours. Share the generated code with the intended staff member.</p>
        <form onSubmit={issueSetupCode}>
          <label>Account Type<select value={role} disabled={issuingSetupCode} onChange={event => { setRole(event.target.value); setSetupCode(''); }}><option value="branch_manager">Branch Manager</option><option value="head_office_admin">Head Office Admin</option></select></label>
          {role === 'branch_manager' && <label>Branch<select value={branchId} onChange={event => setBranchId(event.target.value)} disabled={issuingSetupCode} required><option value="">Select a branch</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
          <button className="primary" type="submit" disabled={issuingSetupCode || role === 'branch_manager' && !branchId}>{issuingSetupCode ? 'Generating...' : 'Generate Setup Code'}</button>
        </form>
        {setupCode && <p className="notice" role="status">Copy and securely share this one-time code: <b>{setupCode}</b></p>}
        {setupError && <p className="notice" role="alert">{setupError}</p>}
      </section>
      <section className="card"><h3>Change Password</h3><form onSubmit={changePassword}>
        <label>Current Password<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required autoComplete="current-password" disabled={changingPassword}/></label>
        <label>New Password<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required minLength="8" maxLength="128" autoComplete="new-password" disabled={changingPassword}/></label>
        <button className="primary" type="submit" disabled={changingPassword}>{changingPassword ? 'Updating...' : 'Update Password'}</button>
      </form>{passwordError && <p className="notice" role="alert">{passwordError}</p>}</section>
    </div>
    <section className="card"><h3>System Policy</h3><p>Transfer stock reservation, low-stock thresholds, and audit logging are enforced by the API and PostgreSQL workflow SQL. The current backend does not expose editable global policy settings.</p></section>
  </>;
}
