import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const listeners = new Map<string, ((error?: Error) => void)[]>();
  let startupEvent: 'listening' | 'error' = 'listening';
  const server = {
    once: vi.fn((event: string, listener: (error?: Error) => void) => listeners.set(event, [...(listeners.get(event) ?? []), listener])),
    off: vi.fn((event: string, listener: (error?: Error) => void) => listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== listener))),
    emit: (event: string, error?: Error) => (listeners.get(event) ?? []).forEach((listener) => listener(error)),
    listen: vi.fn(),
  };
  server.listen = vi.fn((_: number) => queueMicrotask(() => server.emit(startupEvent, new Error('port unavailable'))));
  const state = {
    server,
    createServer: vi.fn(() => server),
    createApp: vi.fn(() => ({ marker: 'app' })),
    closeSocket: vi.fn().mockResolvedValue(undefined),
    disconnectPrisma: vi.fn().mockResolvedValue(undefined),
    endSessionPool: vi.fn().mockResolvedValue(undefined),
    createSocketServer: vi.fn(),
    startPollSweeper: vi.fn(() => 1 as unknown as NodeJS.Timeout),
    info: vi.fn(),
    fatal: vi.fn(),
  };
  return Object.assign(state, {
    reset(event: 'listening' | 'error') {
      startupEvent = event;
      listeners.clear();
      Object.values(state).forEach((value) => { if (typeof value === 'function' && 'mockClear' in value) value.mockClear(); });
      state.createSocketServer.mockReturnValue({ close: state.closeSocket });
    },
  });
});

state.createSocketServer.mockReturnValue({ close: state.closeSocket });

vi.mock('node:http', () => ({ default: { createServer: state.createServer } }));
vi.mock('../src/app.ts', () => ({ createApp: state.createApp }));
vi.mock('../src/config/env.ts', () => ({ env: { PORT: 4100, NODE_ENV: 'test' } }));
vi.mock('../src/db.ts', () => ({ prisma: { $disconnect: state.disconnectPrisma } }));
vi.mock('../src/middleware/session.ts', () => ({ sessionMiddleware: {}, sessionPool: { end: state.endSessionPool } }));
vi.mock('../src/modules/polls/poll.service.ts', () => ({ startPollSweeper: state.startPollSweeper }));
vi.mock('../src/realtime/socket.ts', () => ({ createSocketServer: state.createSocketServer }));
vi.mock('../src/utils/logger.ts', () => ({ logger: { info: state.info, error: vi.fn(), fatal: state.fatal } }));

afterEach(() => {
  vi.restoreAllMocks();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('server startup', () => {
  it('creates the HTTP and socket servers, starts the poll sweeper, and logs once listening', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await import('../src/server.ts');
    await vi.waitFor(() => expect(state.info).toHaveBeenCalledWith({ port: 4100, env: 'test' }, 'API listening'));

    expect(state.createApp).toHaveBeenCalledOnce();
    expect(state.createServer).toHaveBeenCalledWith({ marker: 'app' });
    expect(state.createSocketServer).toHaveBeenCalledWith(state.server, {});
    expect(state.startPollSweeper).toHaveBeenCalledOnce();
    expect(state.server.listen).toHaveBeenCalledWith(4100);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(state.closeSocket).toHaveBeenCalledOnce();
    expect(state.disconnectPrisma).toHaveBeenCalledOnce();
    expect(state.endSessionPool).toHaveBeenCalledOnce();
  });

  it('cleans up resources and records startup failures without exiting immediately', async () => {
    const originalExitCode = process.exitCode;
    state.reset('error');
    vi.resetModules();

    await import('../src/server.ts');
    await vi.waitFor(() => expect(state.fatal).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'API server failed to start'));
    expect(state.closeSocket).toHaveBeenCalledOnce();
    expect(state.disconnectPrisma).toHaveBeenCalledOnce();
    expect(state.endSessionPool).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });
});
