import http from 'node:http';
import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { prisma } from './db.ts';
import { sessionMiddleware, sessionPool } from './middleware/session.ts';
import { startPollSweeper } from './modules/polls/poll.service.ts';
import { createSocketServer } from './realtime/socket.ts';
import { logger } from './utils/logger.ts';

const app = createApp();
const server = http.createServer(app);
const io = createSocketServer(server, sessionMiddleware);
const sweeper = startPollSweeper();

server.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  clearInterval(sweeper);
  io.close();
  server.close(async () => {
    await prisma.$disconnect();
    await sessionPool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
