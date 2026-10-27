const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error('This browser cannot create a secure request key. Update the browser and try again.');
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function loadPendingRequest(storageKey) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return null;
    const attempt = JSON.parse(stored);
    if (!uuidPattern.test(attempt?.key || '') || !attempt.payload || typeof attempt.payload !== 'object') return null;
    return attempt;
  } catch {
    return null;
  }
}

export function savePendingRequest(storageKey, attempt) {
  window.localStorage.setItem(storageKey, JSON.stringify(attempt));
}

export function clearPendingRequest(storageKey) {
  window.localStorage.removeItem(storageKey);
}
