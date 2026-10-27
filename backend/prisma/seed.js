import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL
  })
});

try {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const firstName = process.env.INITIAL_ADMIN_FIRST_NAME?.trim();
  const lastName = process.env.INITIAL_ADMIN_LAST_NAME?.trim();

  if (!email || !password || !firstName || !lastName) {
    throw new Error(
      'Set INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_FIRST_NAME, and INITIAL_ADMIN_LAST_NAME before seeding.'
    );
  }

  if (password.length < 12) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be at least 12 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'head_office_admin',
        isActive: true
      }
    });
    await tx.auditLog.create({
      data: {
        tableName: 'users',
        operation: 'INSERT',
        recordId: created.id,
        performedByUserId: created.id,
        oldData: { action: 'INITIAL_ADMIN_CREATED', role: created.role }
      }
    });
    return created;
  });

  console.log(`Initial administrator is ready: ${user.email}`);
} finally {
  await prisma.$disconnect();
}
