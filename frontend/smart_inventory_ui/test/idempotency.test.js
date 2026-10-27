import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPendingRequest,
  createIdempotencyKey,
  loadPendingRequest,
  savePendingRequest
} from '../src/data/idempotency.js';

const storageKey = 'receipt-attempt-test';
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createWindow(storage = new Map()) {
  return {
    crypto: globalThis.crypto,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    }
  };
}

test('creates a random UUID v4 request key', () => {
  globalThis.window = createWindow();
  assert.match(createIdempotencyKey(), uuidV4Pattern);
});

test('pending request keeps the same key and payload after a page reload', () => {
  const storage = new Map();
  globalThis.window = createWindow(storage);
  const attempt = { key: createIdempotencyKey(), payload: { quantity: 2 } };
  savePendingRequest(storageKey, attempt);

  globalThis.window = createWindow(storage);
  assert.deepEqual(loadPendingRequest(storageKey), attempt);
});

test('pending request is removed only when explicitly cleared', () => {
  const storage = new Map();
  globalThis.window = createWindow(storage);
  savePendingRequest(storageKey, { key: createIdempotencyKey(), payload: { quantity: 2 } });
  clearPendingRequest(storageKey);

  assert.equal(loadPendingRequest(storageKey), null);
});

test('malformed pending data is rejected safely', () => {
  const storage = new Map([[storageKey, '{invalid json']]);
  globalThis.window = createWindow(storage);

  assert.equal(loadPendingRequest(storageKey), null);
});
