import { useState } from 'react';
export default function SignUp({ onBack, onCreated }) {
  const [role, setRole] = useState('Technician');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [branch, setBranch] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [error, setError] = useState('');
  const submit = e => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    if (name.trim().length < 2) return setError('Enter a name with at least 2 characters.');
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}/.test(password)) return setError('Use 8–128 characters with uppercase, lowercase, and a number.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    if (role !== 'Technician' && !setupCode.trim()) return setError('Enter the setup credential provided by Head Office.');
    onCreated({ id: `USR-${Date.now()}`, name: name.trim(), email: email.trim().toLowerCase(), role, branch: role === 'Head Office Admin' ? 'Head Office' : branch });
  };
  return <div className="auth"><div className="authCard"><div className="authLogo">S</div><h1>Create Account</h1><p className="muted">Role-specific registration prototype.</p><form onSubmit={submit}>
    <label>Full Name<input value={name} onChange={e => { setName(e.target.value); setError(''); }} placeholder="Juan Dela Cruz" autoComplete="name" required minLength="2" /></label>
    <label>Email<input value={email} onChange={e => { setEmail(e.target.value); setError(''); }} type="email" placeholder="juan@example.com" autoComplete="email" required /></label>
    <label>Password<input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="8+ characters with upper, lower, and number" autoComplete="new-password" required minLength="8" maxLength="128" /></label>
    <label>Confirm Password<input type="password" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setError(''); }} autoComplete="new-password" required minLength="8" maxLength="128" /></label>
    <label>Account Type<select value={role} onChange={e => { setRole(e.target.value); setBranch(''); setSetupCode(''); setError(''); }}><option>Technician</option><option>Branch Manager</option><option>Head Office Admin</option></select></label>
    {role !== 'Head Office Admin' && <label>{role === 'Technician' ? 'Home Branch' : 'Assigned Branch'}<select value={branch} onChange={e => { setBranch(e.target.value); setError(''); }} required><option value="">Select a branch</option><option value="B001">Main Branch</option><option value="B002">North Branch</option><option value="B003">South Branch</option></select></label>}
    {role === 'Branch Manager' && <label>Manager Setup Link<input value={setupCode} onChange={e => { setSetupCode(e.target.value); setError(''); }} placeholder="Provided by Head Office" required /></label>}
    {role === 'Head Office Admin' && <label>Administrative Setup Code<input value={setupCode} onChange={e => { setSetupCode(e.target.value); setError(''); }} placeholder="Initial setup / expansion code" required /></label>}
    <button className="primary wide" type="submit">Create Account</button>
    {error && <p className="notice" role="alert">{error}</p>}
  </form><button className="linkBtn wide" onClick={onBack}>Back to login</button><div className="authHint">Registration is UI-only. Real verification will be handled by the backend.</div></div></div>;
}
