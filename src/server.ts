import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { cleanupExpired, migrate } from './db.js';
import { createProvider } from './provider.js';
import { createLimiter } from './ratelimit.js';
import { checkCredentials } from './users.js';
import { consentPage, loginPage } from './views.js';

await migrate();
const provider = await createProvider();

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

const loginLimiter = createLimiter(10, 15 * 60 * 1000); // 10 tries per 15 min per IP+email

function pageHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
  });
  next();
}

const body = express.urlencoded({ extended: false });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

async function clientName(clientId: unknown) {
  const client = await provider.Client.find(String(clientId));
  return (client?.clientName as string | undefined) ?? 'an application';
}

app.get('/healthz', (_req, res) => res.send('ok'));

app.get('/interaction/:uid', pageHeaders, wrap(async (req, res) => {
  const { uid, prompt, params } = await provider.interactionDetails(req, res);
  const name = await clientName(params.client_id);
  if (prompt.name === 'login') return res.send(loginPage({ uid, clientName: name }));
  const scopes = String(params.scope ?? '').split(' ').filter(Boolean);
  return res.send(consentPage({ uid, clientName: name, scopes }));
}));

app.post('/interaction/:uid/login', pageHeaders, body, wrap(async (req, res) => {
  const { uid, prompt, params } = await provider.interactionDetails(req, res);
  if (prompt.name !== 'login') return res.status(400).send('Unexpected step');
  const email = String(req.body.email ?? '').trim();
  const password = String(req.body.password ?? '');

  if (!loginLimiter(`${req.ip}|${email.toLowerCase()}`)) {
    return res.status(429).send(loginPage({ uid, clientName: await clientName(params.client_id), email, error: 'Too many attempts. Try again in 15 minutes.' }));
  }
  const user = await checkCredentials(email, password);
  if (!user) {
    return res.status(401).send(loginPage({ uid, clientName: await clientName(params.client_id), email, error: 'Wrong email or password.' }));
  }
  await provider.interactionFinished(req, res, { login: { accountId: user.id } }, { mergeWithLastSubmission: false });
}));

app.post('/interaction/:uid/confirm', pageHeaders, body, wrap(async (req, res) => {
  const details = await provider.interactionDetails(req, res);
  const { prompt, params, session } = details;
  if (prompt.name !== 'consent' || !session) return res.status(400).send('Unexpected step');

  const grant = details.grantId
    ? (await provider.Grant.find(details.grantId))!
    : new provider.Grant({ accountId: session.accountId, clientId: String(params.client_id) });

  const missing = prompt.details as {
    missingOIDCScope?: string[];
    missingOIDCClaims?: string[];
    missingResourceScopes?: Record<string, string[]>;
  };
  if (missing.missingOIDCScope) grant.addOIDCScope(missing.missingOIDCScope.join(' '));
  if (missing.missingOIDCClaims) grant.addOIDCClaims(missing.missingOIDCClaims);
  for (const [indicator, scopes] of Object.entries(missing.missingResourceScopes ?? {})) {
    grant.addResourceScope(indicator, scopes.join(' '));
  }
  const grantId = await grant.save();
  await provider.interactionFinished(req, res, { consent: details.grantId ? {} : { grantId } }, { mergeWithLastSubmission: true });
}));

app.get('/interaction/:uid/abort', pageHeaders, wrap(async (req, res) => {
  await provider.interactionFinished(
    req,
    res,
    { error: 'access_denied', error_description: 'The user cancelled the sign-in' },
    { mergeWithLastSubmission: false },
  );
}));

// Everything else (/.well-known/openid-configuration, /auth, /token, /jwks, /me, /session/end ...) is OIDC.
app.use(provider.callback());

setInterval(() => cleanupExpired().catch(console.error), 60 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`TeddyBiere SSO listening on :${config.port}, issuer ${config.issuer}`);
});
