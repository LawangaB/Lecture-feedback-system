import { env, isProd } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development/test outbox. Messages are kept in memory and printed to the server console. */
export const devOutbox: MailMessage[] = [];

class DevMailer implements Mailer {
  async send(message: MailMessage) {
    devOutbox.push(message);
    if (devOutbox.length > 50) devOutbox.shift();
    if (env.NODE_ENV === 'development') {
      console.log(`\n[dev mail] to=${message.to}\n${message.subject}\n${message.text}\n`);
    }
  }
}

/**
 * No SMTP transport is implemented. In production this mailer drops the message (without logging the body, which
 * contains a reset token) and warns, so password reset cannot work until a real Mailer is supplied.
 */
class UnconfiguredMailer implements Mailer {
  async send() {
    logger.warn('No mail transport configured; password-reset email was not sent.');
  }
}

export const mailer: Mailer = isProd ? new UnconfiguredMailer() : new DevMailer();
