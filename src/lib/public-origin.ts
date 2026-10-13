// Redirects must use configured public URLs, never the server bind address or
// request/proxy headers. Next's internal request origin can be 0.0.0.0:3000.
export function publicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.APP_URL || env.GOOGLE_INTEGRATION_REDIRECT_URI;
  if (!configured && env.NODE_ENV === 'production') throw new Error('PUBLIC_URL_REQUIRED');
  const url = new URL(configured || 'http://localhost:3000');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || ['0.0.0.0', '[::]'].includes(url.hostname) ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
    throw new Error('INVALID_PUBLIC_URL');
  }
  return url.origin;
}
