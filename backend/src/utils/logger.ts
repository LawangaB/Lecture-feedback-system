import pino from 'pino';
import { env } from '../config/env.ts';

// Never log credentials, cookies, session ids, reset tokens, or free-text answers.
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password', '*.password', 'newPassword', '*.newPassword', 'currentPassword', '*.currentPassword',
      'token', '*.token', 'code', '*.code', 'comment', '*.comment',
      'req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]',
      'headers.cookie', 'headers.authorization', 'sid', '*.sid', 'csrfToken', '*.csrfToken',
    ],
    censor: '[REDACTED]',
  },
});
