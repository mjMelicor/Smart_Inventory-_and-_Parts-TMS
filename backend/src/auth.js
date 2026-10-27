import jwt from 'jsonwebtoken';
import { prisma } from './db.js';
import { credentialVersionMatches } from './tokenVersion.js';

export async function authenticate(req, res, next) {
  const value = req.get('authorization');
  const token = value?.startsWith('Bearer ') ? value.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const userId = BigInt(claims.sub);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        branchId: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
        branch: { select: { name: true } }
      }
    });
    if (!user?.isActive) return res.status(401).json({ error: 'Account is inactive or no longer exists.' });
    if (!credentialVersionMatches(claims.credentialVersion, user.passwordHash, process.env.JWT_SECRET)) {
      return res.status(401).json({ error: 'Your session expired or was revoked. Please sign in again.' });
    }
    const { passwordHash: _passwordHash, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError || error instanceof SyntaxError) {
      return res.status(401).json({ error: 'Invalid or expired authentication token.' });
    }
    next(error);
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

export function requireBranch(req, branchId, message = 'You cannot access another branch.') {
  if (req.user.role !== 'head_office_admin' && String(req.user.branchId) !== String(branchId)) {
    const error = new Error(message);
    error.status = 403;
    throw error;
  }
}
