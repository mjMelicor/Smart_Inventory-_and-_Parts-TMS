import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import { allowRoles, authenticate, requireActiveAssignedBranch, requireBranch } from '../src/auth.js';
import { prisma } from '../src/db.js';
import { credentialVersion, credentialVersionMatches } from '../src/tokenVersion.js';
import { router } from '../src/routes.js';

function responseDouble() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('role middleware permits an explicitly allowed role', () => {
  const req = { user: { role: 'branch_manager' } };
  const res = responseDouble();
  let continued = false;

  allowRoles('branch_manager', 'head_office_admin')(req, res, () => { continued = true; });

  assert.equal(continued, true);
  assert.equal(res.statusCode, null);
});

test('role middleware rejects a role that is not allowed', () => {
  const req = { user: { role: 'technician' } };
  const res = responseDouble();
  let continued = false;

  allowRoles('branch_manager')(req, res, () => { continued = true; });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /permission/i);
});

test('branch guard accepts an assigned branch and rejects another branch', () => {
  const req = { user: { role: 'branch_manager', branchId: 3n, branchIsActive: true } };

  assert.doesNotThrow(() => requireBranch(req, '3'));
  assert.throws(() => requireBranch(req, 1n), error => error.status === 403);
});

test('branch guard keeps technicians scoped and allows Head Office Admin access', () => {
  assert.throws(
    () => requireBranch({ user: { role: 'technician', branchId: 3n, branchIsActive: true } }, 1n),
    error => error.status === 403
  );
  assert.doesNotThrow(() => requireBranch({ user: { role: 'head_office_admin', branchId: null } }, 1n));
});

test('credential version is stable for a password hash and secret', () => {
  const version = credentialVersion('test-only-hash', 'test-only-secret');
  assert.equal(credentialVersionMatches(version, 'test-only-hash', 'test-only-secret'), true);
  assert.equal(credentialVersionMatches(version, 'changed-test-hash', 'test-only-secret'), false);
  assert.equal(credentialVersionMatches(version, 'test-only-hash', 'changed-test-secret'), false);
  assert.equal(credentialVersionMatches(undefined, 'test-only-hash', 'test-only-secret'), false);
});

test('Admin session works until its password changes, without exposing the hash', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousLookup = prisma.user.findUnique;
  const secret = 'unit-test-only-jwt-secret';
  const passwordHash = 'unit-test-only-current-hash';
  process.env.JWT_SECRET = secret;
  prisma.user.findUnique = async () => ({
    id: 7n,
    branchId: null,
    firstName: 'Test',
    lastName: 'Admin',
    email: 'admin@example.invalid',
    role: 'head_office_admin',
    isActive: true,
    passwordHash,
    branch: null
  });

  try {
    const token = jwt.sign({
      sub: '7',
      credentialVersion: credentialVersion(passwordHash, secret)
    }, secret);
    const req = { get: () => `Bearer ${token}` };
    let continued = false;
    await authenticate(req, responseDouble(), () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(req.user.role, 'head_office_admin');
    assert.equal('passwordHash' in req.user, false);

    prisma.user.findUnique = async () => ({
      id: 7n,
      branchId: null,
      firstName: 'Test',
      lastName: 'Admin',
      email: 'admin@example.invalid',
      role: 'head_office_admin',
      isActive: true,
      passwordHash: 'unit-test-only-new-hash',
      branch: null
    });
    const response = responseDouble();
    continued = false;
    await authenticate({ get: () => `Bearer ${token}` }, response, () => { continued = true; });
    assert.equal(continued, false);
    assert.equal(response.statusCode, 401);
  } finally {
    prisma.user.findUnique = previousLookup;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('login route issues an Admin token accepted by the authentication middleware', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousLookup = prisma.user.findUnique;
  const secret = 'unit-test-only-login-secret';
  const password = 'Unit-test-password';
  const passwordHash = await bcrypt.hash(password, 4);
  process.env.JWT_SECRET = secret;
  prisma.user.findUnique = async ({ where }) => where.email === 'admin@example.invalid' || where.id === 8n ? ({
    id: 8n,
    branchId: null,
    firstName: 'Test',
    lastName: 'Admin',
    email: 'admin@example.invalid',
    role: 'head_office_admin',
    isActive: true,
    passwordHash,
    branch: null
  }) : null;

  try {
    const loginLayer = router.stack.find(layer => layer.route?.path === '/auth/login' && layer.route.methods.post);
    assert.ok(loginLayer, 'login route is registered');
    const loginHandler = loginLayer.route.stack[0].handle;
    const loginResponse = responseDouble();
    let loginError;
    await loginHandler({ body: { email: 'ADMIN@example.invalid', password } }, loginResponse, error => { loginError = error; });
    assert.equal(loginError, undefined);
    assert.equal(loginResponse.statusCode, null);
    assert.equal(loginResponse.body.user.role, 'head_office_admin');
    assert.equal('passwordHash' in loginResponse.body.user, false);
    assert.equal(typeof loginResponse.body.token, 'string');

    const authenticatedRequest = { get: () => `Bearer ${loginResponse.body.token}` };
    let continued = false;
    await authenticate(authenticatedRequest, responseDouble(), () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(authenticatedRequest.user.role, 'head_office_admin');
  } finally {
    prisma.user.findUnique = previousLookup;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('active users at inactive branches can log in and use account self-service but not branch operations', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousLookup = prisma.user.findUnique;
  const secret = 'unit-test-only-inactive-branch-secret';
  const password = 'Unit-test-password';
  const passwordHash = await bcrypt.hash(password, 4);
  const inactiveBranchUser = {
    id: 11n,
    branchId: 4n,
    firstName: 'Test',
    lastName: 'Technician',
    email: 'inactive-branch@example.invalid',
    role: 'technician',
    isActive: true,
    passwordHash,
    branch: { name: 'Inactive Test Branch', isActive: false }
  };
  process.env.JWT_SECRET = secret;
  prisma.user.findUnique = async ({ where }) => where.email === inactiveBranchUser.email || where.id === 11n
    ? inactiveBranchUser
    : null;

  try {
    const loginLayer = router.stack.find(layer => layer.route?.path === '/auth/login' && layer.route.methods.post);
    const loginResponse = responseDouble();
    let loginError;
    await loginLayer.route.stack[0].handle({
      body: { email: inactiveBranchUser.email, password }
    }, loginResponse, error => { loginError = error; });
    assert.equal(loginError, undefined);
    assert.equal(loginResponse.statusCode, null);
    assert.equal(loginResponse.body.user.branchIsActive, false);

    const token = jwt.sign({
      sub: String(inactiveBranchUser.id),
      credentialVersion: credentialVersion(passwordHash, secret)
    }, secret);
    const req = { get: () => `Bearer ${token}` };
    let continued = false;
    await authenticate(req, responseDouble(), () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(req.user.branchIsActive, false);
    assert.throws(() => requireActiveAssignedBranch(req.user), error => error.status === 403);
    assert.throws(() => requireBranch({ user: req.user }, 4n), error => error.status === 403);

    const selfService = router.stack.find(layer => layer.route?.path === '/auth/me' && layer.route.methods.get);
    const selfServiceResponse = responseDouble();
    selfService.route.stack[0].handle({ user: req.user }, selfServiceResponse);
    assert.equal(selfServiceResponse.body.user.id, '11');
    assert.equal(selfServiceResponse.body.user.branchIsActive, false);
    assert.equal('passwordHash' in selfServiceResponse.body.user, false);
  } finally {
    prisma.user.findUnique = previousLookup;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
