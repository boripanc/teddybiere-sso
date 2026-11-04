# TeddyBiere SSO

A self-built single sign-on server. Apps send users here to sign in and get back
standard OpenID Connect (OIDC) tokens, so one login works across all of them.

Built on [`oidc-provider`](https://github.com/panva/node-oidc-provider) (an OpenID-certified
library) with TypeScript, Express and Postgres.

## What works today

- OIDC authorization code flow with PKCE, refresh tokens, userinfo, token revocation and introspection
- Email + password login (argon2 hashes, rate-limited), consent screen remembered per app
- Single sign-on: once signed in, other apps sign you in without asking again (14 day session)
- Sign out (`/session/end`)
- Signing keys generated on first start and stored in Postgres; published at `/jwks`
- Admin page at `/admin`: add/remove users, reset passwords, make admins, register apps, edit redirect URLs, rotate app secrets
- CLI to add users and register apps

Planned: 2FA (authenticator apps / passkeys), SAML for apps that only speak SAML.

## Run locally

```sh
npm install
# needs Postgres at postgres://postgres@localhost:5432/sso (override with DATABASE_URL)
npm run dev          # or: npm run build && npm start
```

Discovery document: http://localhost:3000/.well-known/openid-configuration

## Deploy with Coolify

Coolify builds the app straight from this repo with Nixpacks. You don't need a Dockerfile.

1. **Database:** in your Coolify project, choose *New → Database → PostgreSQL*, start it, and copy its **Postgres URL (internal)**.
2. **App:** choose *New → Public/Private Repository*, pick this repo and the `main` branch, and set the build pack to **Nixpacks**.
3. **Port and domain:** set *Ports Exposes* to `3000` and *Domains* to e.g. `https://sso.example.com`. Coolify handles HTTPS.
4. **Environment variables:**
   - `ISSUER` = the same `https://` domain
   - `DATABASE_URL` = the internal Postgres URL from step 1
   - `COOKIE_KEYS` = output of `openssl rand -base64 32`
   - `NODE_ENV` = `production`
5. **Health check (optional):** path `/healthz`.
6. Deploy. The tables are created on first start.

Then open the app's **Terminal** in Coolify and create your first admin:

```sh
npm run cli -- create-user you@example.com "Your Name" --admin
```

## Add users and apps

The easiest way is the admin page at `https://<your-domain>/admin`. The CLI does the same (`npm run cli:dev -- ...` when developing locally):

```sh
npm run cli -- create-user you@example.com "Your Name" --admin
npm run cli -- create-client "Grafana" https://grafana.example.com/login/generic_oauth
npm run cli -- create-client "My SPA" https://app.example.com/callback --public
npm run cli -- list-clients
```

Give each app the issuer URL, its `client_id` and `client_secret`. Most apps only need the
issuer URL because they read the rest from the discovery document.
