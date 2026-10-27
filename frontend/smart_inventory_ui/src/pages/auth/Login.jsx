import { useState } from 'react';

export default function Login({ onLogin, onSignUp, error }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setSubmitting(true);
    await onLogin({ email, password });
    setSubmitting(false);
  };

  return <div className="auth"><div className="authCard"><div className="authLogo">S</div><h1>Smart Inventory</h1><p className="muted">Multi-Branch Automotive Parts Transfer Management</p>
    <form onSubmit={submit}>
      <label>Email<input autoComplete="username" type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary wide" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign In'}</button>
    </form>
    <button className="linkBtn wide" onClick={onSignUp}>Create a new account</button>
  </div></div>;
}
