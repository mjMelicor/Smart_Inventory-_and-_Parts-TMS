import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL
  })
});

const oldEmail = 'admin@example.com';
const newEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.INITIAL_ADMIN_PASSWORD;
const firstName = process.env.INITIAL_ADMIN_FIRST_NAME?.trim();
const lastName = process.env.INITIAL_ADMIN_LAST_NAME?.trim();

try {
  if (!process.argv.includes('--confirm-existing-admin-update')) {
    throw new Error('This utility changes an existing administrator account. No changes made. Use --confirm-existing-admin-update only for an approved account update.');
  }

  if (!newEmail || !password || !firstName || !lastName) {
    throw new Error('Check your four INITIAL_ADMIN variables in backend/.env.');
  }

  if (password.length < 12) {
    throw new Error('The configured password must be at least 12 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const updatedAdmin = await prisma.$transaction(async tx => {
    const existingAdmin = await tx.user.findUnique({ where: { email: oldEmail } });
    if (!existingAdmin || existingAdmin.role !== 'head_office_admin') {
      throw new Error('The expected existing administrator was not found. No changes made.');
    }
    if (!existingAdmin.isActive) {
      throw new Error('The existing administrator is inactive. No changes made.');
    }
    if (newEmail !== oldEmail) {
      const emailInUse = await tx.user.findUnique({ where: { email: newEmail } });
      if (emailInUse) throw new Error('The new email already belongs to an account. No changes made.');
    }

    const updated = await tx.user.update({
      where: { id: existingAdmin.id },
      data: { email: newEmail, passwordHash, firstName, lastName }
    });
    await tx.auditLog.create({
      data: {
        tableName: 'users', operation: 'UPDATE', recordId: existingAdmin.id,
        branchId: existingAdmin.branchId,
        oldData: { action: 'ADMIN_ACCOUNT_UPDATED', changedFields: ['email', 'password', 'firstName', 'lastName'] }
      }
    });
    return updated;
  });

  console.log('Administrator account updated successfully.');
  console.log(`Email: ${updatedAdmin.email}`);
  console.log(`Role: ${updatedAdmin.role}`);
  console.log(`Active: ${updatedAdmin.isActive}`);
} catch (error) {
  console.error('Administrator update failed:', error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
