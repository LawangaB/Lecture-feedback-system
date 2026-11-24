const TEST_DATABASE_NAME = 'lecture_feedback_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function requireTestDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      'TEST_DATABASE_URL is required. Set it to the local lecture_feedback_test PostgreSQL database before running backend tests.',
    );
  }

  let url: URL;
  let databaseName: string;
  try {
    url = new URL(value);
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !LOCAL_HOSTS.has(hostname) ||
    databaseName !== TEST_DATABASE_NAME
  ) {
    throw new Error(
      `TEST_DATABASE_URL must target the local ${TEST_DATABASE_NAME} database (localhost, 127.0.0.1, or ::1).`,
    );
  }

  return value;
}
