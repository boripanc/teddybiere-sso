import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createClient, deleteClient, listClients, rotateClientSecret, updateClientUris } from './clients.js';
import { config } from './config.js';
import { pool } from './db.js';
import { createLimiter } from './ratelimit.js';
import { checkCredentials, createUser, deleteUser, findUserById, listUsers, setAdmin, setPassword, type User } from './users.js';
import { esc, layout } from './views.js';

// Admin web page at /admin. Admins sign in with their SSO email + password.
// Session: random token in an HttpOnly, SameSite=Strict cookie; only its hash is stored.
// Every form also carries a per-session CSRF token.

const COOKIE = config.isProd ? '__Host-sso_admin' : 'sso_admin';
const SESSION_HOURS = 8;
const limiter = createLimiter(10, 15 * 60 * 1000);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type AdminRequest = Request & { admin: User; csrf: string };

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string, maxAgeSec: number) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

async function loadSession(req: Request) {
  const token = readCookie(req, COOKIE);
  if (!token) return undefined;
  const { rows } = await pool.query(
    `SELECT s.csrf, u.id, u.email, u.name, u.is_admin FROM admin_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row || !row.is_admin) return undefined;
  const { csrf, ...admin } = row;
  return { admin: admin as User, csrf: csrf as string, tokenHash: sha256(token) };
}

const wrap = (fn: (req: AdminRequest, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req as AdminRequest, res).catch(next);

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const s = await loadSession(req);
    if (!s) return res.redirect('/admin/login');
    Object.assign(req, { admin: s.admin, csrf: s.csrf });
    if (req.method === 'POST') {
      const sent = Buffer.from(String(req.body?._csrf ?? ''));
      const expected = Buffer.from(s.csrf);
      if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return res.status(403).send('Invalid form token. Go back and reload the page.');
    }
    next();
  } catch (e) {
    next(e);
  }
}

// After an action, go back to the dashboard with a short message.
function back(res: Response, kind: 'msg' | 'err', text: string) {
  res.redirect(`/admin?${kind}=${encodeURIComponent(text)}`);
}

const csrfField = (csrf: string) => `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;
const lines = (s: unknown) => String(s ?? '').split(/\s+/).map((x) => x.trim()).filter(Boolean);

function loginForm(error?: string, email = '') {
  return layout(
    'Admin sign in',
    `<h1>Admin</h1><p class="sub">Sign in with an admin account</p>
     ${error ? `<div class="error">${esc(error)}</div>` : ''}
     <form method="post" action="/admin/login">
       <label for="email">Email</label>
       <input id="email" name="email" type="email" required autofocus autocomplete="username" value="${esc(email)}">
       <label for="password">Password</label>
       <input id="password" name="password" type="password" required autocomplete="current-password">
       <button type="submit">Sign in</button>
     </form>`,
  );
}

async function dashboard(req: AdminRequest, notice?: string) {
  const [users, clients] = await Promise.all([listUsers(), listClients()]);
  const msg = typeof req.query.msg === 'string' ? req.query.msg : undefined;
  const err = typeof req.query.err === 'string' ? req.query.err : undefined;
  const csrf = csrfField(req.csrf);
  const action = (path: string, label: string, cls = 'ghost') =>
    `<form class="inline" method="post" action="${path}">${csrf}<button class="${cls}" type="submit">${label}</button></form>`;

  const userRows = users.map((u) => `<tr>
      <td>${esc(u.email)}${u.id === req.admin.id ? ' <span class="badge">you</span>' : ''}</td>
      <td>${esc(u.name)}</td>
      <td>${u.is_admin ? 'Admin' : 'User'}</td>
      <td><div class="row">
        ${action(`/admin/users/${u.id}/admin`, u.is_admin ? 'Remove admin' : 'Make admin')}
        <form class="inline row" method="post" action="/admin/users/${u.id}/password">${csrf}
          <input name="password" type="password" placeholder="New password" minlength="10" required autocomplete="new-password" style="width:150px;padding:5px 8px">
          <button class="ghost" type="submit">Set password</button></form>
        ${u.id === req.admin.id ? '' : action(`/admin/users/${u.id}/delete`, 'Remove', 'danger')}
      </div></td></tr>`).join('');

  const clientRows = clients.map((c) => `<tr>
      <td><strong>${esc(c.name)}</strong><br><code>${esc(c.client_id)}</code><br><span class="muted">${c.is_public ? 'Public app (PKCE, no secret)' : 'Server app (has a secret)'}</span></td>
      <td><form method="post" action="/admin/clients/${esc(c.client_id)}/uris">${csrf}
          <label class="muted" style="margin-top:0">Redirect URLs (one per line)</label>
          <textarea name="redirect_uris" required>${esc((c.redirect_uris ?? []).join('\n'))}</textarea>
          <label class="muted">After sign-out URLs (optional)</label>
          <textarea name="post_logout_redirect_uris">${esc((c.post_logout_redirect_uris ?? []).join('\n'))}</textarea>
          <button class="ghost small" type="submit" style="margin-top:8px">Save URLs</button></form></td>
      <td><div class="row" style="flex-direction:column;align-items:stretch">
        ${c.is_public ? '' : action(`/admin/clients/${esc(c.client_id)}/secret`, 'New secret', 'ghost')}
        ${action(`/admin/clients/${esc(c.client_id)}/delete`, 'Remove', 'danger')}
      </div></td></tr>`).join('');

  return layout(
    'Admin',
    `<nav><strong>TeddyBiere SSO</strong><span class="spacer"></span><span class="muted">${esc(req.admin.email)}</span>
       <form class="inline" method="post" action="/admin/logout">${csrf}<button class="ghost" type="submit">Sign out</button></form></nav>
     ${notice ? `<div class="notice">${notice}</div>` : ''}
     ${msg ? `<div class="notice">${esc(msg)}</div>` : ''}
     ${err ? `<div class="error">${esc(err)}</div>` : ''}

     <h2>Apps</h2>
     <p class="muted">Give an app this issuer URL: <code>${esc(config.issuer)}</code>. Most apps find everything else from it.</p>
     <div class="table-wrap"><table><thead><tr><th>App</th><th>URLs</th><th></th></tr></thead><tbody>
       ${clientRows || '<tr><td colspan="3" class="muted">No apps yet</td></tr>'}</tbody></table></div>
     <form method="post" action="/admin/clients">${csrf}
       <h2>Register an app</h2>
       <div class="grid2">
         <div><label for="cname">Name</label><input id="cname" name="name" required placeholder="Grafana"></div>
         <div><label for="ctype">Type</label><select id="ctype" name="type" style="width:100%">
           <option value="confidential">Server app (keeps a secret)</option>
           <option value="public">Browser or mobile app (no secret)</option></select></div>
       </div>
       <label for="curis">Redirect URLs (one per line)</label>
       <textarea id="curis" name="redirect_uris" required placeholder="https://grafana.example.com/login/generic_oauth"></textarea>
       <label for="clogout">After sign-out URLs (optional)</label>
       <textarea id="clogout" name="post_logout_redirect_uris"></textarea>
       <button type="submit" style="width:auto;padding:10px 20px">Register app</button>
     </form>

     <h2>Users</h2>
     <div class="table-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead><tbody>${userRows}</tbody></table></div>
     <form method="post" action="/admin/users">${csrf}
       <h2>Add a user</h2>
       <div class="grid2">
         <div><label for="uemail">Email</label><input id="uemail" name="email" type="email" required></div>
         <div><label for="uname">Name</label><input id="uname" name="name"></div>
         <div><label for="upw">Password</label><input id="upw" name="password" type="password" minlength="10" required autocomplete="new-password"></div>
       </div>
       <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="is_admin" value="1" style="width:auto"> Admin</label>
       <button type="submit" style="width:auto;padding:10px 20px">Add user</button>
     </form>`,
    { wide: true },
  );
}

function secretNotice(clientId: string, secret: string, intro: string) {
  return `${esc(intro)} Copy the secret now. It will not be shown again.<br><br>
    client_id: <code>${esc(clientId)}</code><br>client_secret: <code>${esc(secret)}</code>`;
}

export function adminRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false }));
  r.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  r.get('/login', wrap(async (req, res) => {
    if (await loadSession(req)) return res.redirect('/admin');
    res.send(loginForm());
  }));

  r.post('/login', wrap(async (req, res) => {
    const email = String(req.body.email ?? '').trim();
    if (!limiter(`${req.ip}|${email.toLowerCase()}`)) return res.status(429).send(loginForm('Too many attempts. Try again in 15 minutes.', email));
    const user = await checkCredentials(email, String(req.body.password ?? ''));
    if (!user || !user.is_admin) return res.status(401).send(loginForm('Wrong email or password, or this account is not an admin.', email));
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO admin_sessions (token_hash, user_id, csrf, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
      [sha256(token), user.id, randomBytes(24).toString('base64url'), SESSION_HOURS],
    );
    setSessionCookie(res, token, SESSION_HOURS * 3600);
    res.redirect('/admin');
  }));

  r.use(requireAdmin);

  r.get('/', wrap(async (req, res) => res.send(await dashboard(req))));

  r.post('/logout', wrap(async (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) await pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [sha256(token)]);
    setSessionCookie(res, '', 0);
    res.redirect('/admin/login');
  }));

  // Runs an action and reports errors (like "password too short") back on the dashboard.
  const act = (fn: (req: AdminRequest, res: Response) => Promise<unknown>) =>
    wrap(async (req, res) => {
      try {
        await fn(req, res);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        back(res, 'err', /duplicate key/.test(message) ? 'That email is already in use' : message);
      }
    });

  r.post('/users', act(async (req, res) => {
    const u = await createUser(String(req.body.email ?? '').trim(), String(req.body.name ?? '').trim(), String(req.body.password ?? ''), req.body.is_admin === '1');
    back(res, 'msg', `Added ${u.email}`);
  }));

  r.post('/users/:id/password', act(async (req, res) => {
    await setPassword(req.params.id!, String(req.body.password ?? ''));
    const u = await findUserById(req.params.id!);
    back(res, 'msg', `Password changed for ${u?.email ?? 'user'}. They were signed out everywhere.`);
  }));

  r.post('/users/:id/admin', act(async (req, res) => {
    const u = await findUserById(req.params.id!);
    if (!u) throw new Error('User not found');
    await setAdmin(u.id, !u.is_admin);
    back(res, 'msg', `${u.email} is now ${u.is_admin ? 'a regular user' : 'an admin'}`);
  }));

  r.post('/users/:id/delete', act(async (req, res) => {
    if (req.params.id === req.admin.id) throw new Error('You cannot remove yourself');
    const u = await findUserById(req.params.id!);
    await deleteUser(req.params.id!);
    back(res, 'msg', `Removed ${u?.email ?? 'user'}`);
  }));

  r.post('/clients', act(async (req, res) => {
    const name = String(req.body.name ?? '').trim();
    const c = await createClient({
      name,
      redirectUris: lines(req.body.redirect_uris),
      postLogoutRedirectUris: lines(req.body.post_logout_redirect_uris),
      type: req.body.type === 'public' ? 'public' : 'confidential',
    });
    const notice = c.clientSecret
      ? secretNotice(c.clientId, c.clientSecret, `Registered ${name}.`)
      : `Registered ${esc(name)}. client_id: <code>${esc(c.clientId)}</code>`;
    res.send(await dashboard(req, notice));
  }));

  r.post('/clients/:id/uris', act(async (req, res) => {
    await updateClientUris(req.params.id!, lines(req.body.redirect_uris), lines(req.body.post_logout_redirect_uris));
    back(res, 'msg', 'URLs saved');
  }));

  r.post('/clients/:id/secret', act(async (req, res) => {
    const secret = await rotateClientSecret(req.params.id!);
    res.send(await dashboard(req, secretNotice(req.params.id!, secret, 'New secret created. The old one no longer works.')));
  }));

  r.post('/clients/:id/delete', act(async (req, res) => {
    await deleteClient(req.params.id!);
    back(res, 'msg', 'App removed');
  }));

  return r;
}
