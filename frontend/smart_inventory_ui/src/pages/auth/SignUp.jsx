import { useEffect, useState } from 'react';
import { api } from '../../data/api';

const roleValues = { Technician: 'technician', 'Branch Manager': 'branch_manager', 'Head Office Admin': 'head_office_admin' };

export default function SignUp({ onBack, onCreated, error: serverError }) {
  const [role, setRole] = useState('Technician');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [branchId, setBranchId] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [branches, setBranches] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/branches').then(setBranches).catch(requestError => setError(requestError.message));
  }, []);

  const submit = event => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    onCreated({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      password,
      role: roleValues[role],
      ...(role !== 'Head Office Admin' ? { branchId } : {}),
      ...(role !== 'Technician' ? { setupCode: setupCode.trim() } : {})
    });
  };

  return <div className="auth"><div className="authCard"><div className="authLogo">S</div><h1>Create Account</h1><p className="muted">Create an account for the Smart Inventory system.</p><form onSubmit={submit}>
    <label>First Name<input value={firstName} onChange={event => setFirstName(event.target.value)} autoComplete="given-name" required maxLength="75" /></label>
    <label>Last Name<input value={lastName} onChange={event => setLastName(event.target.value)} autoComplete="family-name" required maxLength="75" /></label>
    <label>Email<input value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" required maxLength="255" /></label>
    <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required minLength="8" maxLength="128" /></label>
    <label>Confirm Password<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></label>
    <label>Account Type<select value={role} onChange={event => { setRole(event.target.value); setBranchId(''); setSetupCode(''); setError(''); }}><option>Technician</option><option>Branch Manager</option><option>Head Office Admin</option></select></label>
    {role !== 'Head Office Admin' && <label>{role === 'Technician' ? 'Home Branch' : 'Assigned Branch'}<select value={branchId} onChange={event => setBranchId(event.target.value)} required><option value="">Select a branch</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
    {role !== 'Technician' && <label>Setup Code<input value={setupCode} onChange={event => setSetupCode(event.target.value)} autoComplete="off" required /></label>}
    {(error || serverError) && <p className="notice" role="alert">{error || serverError}</p>}
    <button className="primary wide" type="submit">Create Account</button>
  </form><button className="linkBtn wide" onClick={onBack}>Back to login</button></div></div>;
}
