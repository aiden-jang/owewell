/*
 * Stands in for the shared auth service during e2e.
 *
 * The session is checked by the Worker, not the browser, so Playwright cannot intercept it the way
 * it intercepts a fetch from the page. Pointing AUTH_URL here is the only seam. Anyone holding a
 * cookie is signed in as the same person; the tests are about owewell's own screens, not sign-in.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_AUTH_PORT ?? 34199);
const USER = { id: 'e2e-user', email: 'e2e@example.com', displayName: 'Robin' };

createServer((req, res) => {
  if (req.url?.startsWith('/auth/me')) {
    const signedIn = (req.headers.cookie ?? '').includes('platform_session=');
    res.writeHead(signedIn ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(signedIn ? { user: USER } : {}));
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`fake auth on ${PORT}`));
