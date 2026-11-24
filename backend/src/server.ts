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

function listen(): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError);
      logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
      resolve();
    };
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(env.PORT);
  });
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  clearInterval(sweeper);
  const timeout = setTimeout(() => {
    logger.error({ signal }, 'shutdown timed out');
    process.exit(1);
  }, 10_000).unref();

  try {
    await io.close();
    await prisma.$disconnect();
    await sessionPool.end();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    logger.error({ err: error, signal }, 'shutdown failed');
    process.exit(1);
  }
}

function handleShutdown(signal: string) {
  shutdown(signal).catch((error: unknown) => {
    logger.fatal({ err: error, signal }, 'unexpected shutdown failure');
    process.exit(1);
  });
}

listen().catch(async (error: unknown) => {
  logger.fatal({ err: error }, 'API server failed to start');
  clearInterval(sweeper);
  const cleanupResults = await Promise.allSettled([
    io.close(),
    prisma.$disconnect(),
    sessionPool.end(),
  ]);
  for (const result of cleanupResults) {
    if (result.status === 'rejected') logger.error({ err: result.reason }, 'startup cleanup failed');
  }
  process.exitCode = 1;
});

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
