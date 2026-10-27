import { createHmac, timingSafeEqual } from 'node:crypto';

export function credentialVersion(passwordHash, secret) {
  return createHmac('sha256', secret).update(passwordHash).digest('base64url');
}

export function credentialVersionMatches(version, passwordHash, secret) {
  if (typeof version !== 'string' || !passwordHash || !secret) return false;
  const expected = Buffer.from(credentialVersion(passwordHash, secret));
  const actual = Buffer.from(version);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
