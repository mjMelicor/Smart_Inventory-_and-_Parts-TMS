const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const TOKEN_KEY = 'smart-inventory-token';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function expireSession(message = 'Your session expired or was revoked. Please sign in again.') {
  clearToken();
  window.dispatchEvent(new CustomEvent('smart-inventory:session-expired', { detail: { message } }));
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    const error = new Error(`Cannot reach the API at ${API_URL}. Check that the backend is running and VITE_API_URL is correct.`);
    error.code = 'NETWORK_ERROR';
    throw error;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token) expireSession();
    const error = new Error(body?.error || `Request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }
  return body;
}
