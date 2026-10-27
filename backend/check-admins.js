import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL
  })
});

try {
  const users = await prisma.user.findMany({
    where: { role: 'head_office_admin' },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      isActive: true
    }
  });

  console.log('Head Office Admin accounts:', users.length);
  console.table(users);
} catch (error) {
  console.error('Database check failed:', error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}