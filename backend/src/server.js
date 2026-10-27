import 'dotenv/config';
import { app } from './app.js';
import { prisma } from './db.js';

const required = ['DATABASE_URL', 'JWT_SECRET'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}

const port = Number(process.env.PORT || 4000);
await prisma.$connect();
const server = app.listen(port, () => console.log(`Smart Inventory API listening on port ${port}`));
server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. The API may already be running.`);
  } else {
    console.error('The API server failed to start.');
  }
  await prisma.$disconnect();
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close(async error => {
      if (error) {
        console.error('Failed to close API server:', error);
        process.exitCode = 1;
      }
      await prisma.$disconnect();
      process.exit();
    });
  });
}
