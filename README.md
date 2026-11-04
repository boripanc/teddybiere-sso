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
- CLI to add users and register apps

Planned: web admin page, 2FA (authenticator apps / passkeys), SAML for apps that only speak SAML.

## Run locally

```sh
npm install
# needs Postgres at postgres://postgres@localhost:5432/sso (override with DATABASE_URL)
npm run dev
```

Discovery document: http://localhost:3000/.well-known/openid-configuration

## Deploy on a VPS

1. Point a DNS record (e.g. `sso.example.com`) at the VPS.
2. `cp .env.example .env` and fill it in (`openssl rand -base64 32` for the secrets).
3. `docker compose up -d --build`

Caddy handles HTTPS certificates automatically.

## Add users and apps

```sh
# locally: npm run cli -- ...   on the VPS: docker compose exec sso npx tsx src/cli.ts ...
npm run cli -- create-user you@example.com "Your Name" --admin
npm run cli -- create-client "Grafana" https://grafana.example.com/login/generic_oauth
npm run cli -- create-client "My SPA" https://app.example.com/callback --public
npm run cli -- list-clients
```

Give each app the issuer URL, its `client_id` and `client_secret`. Most apps only need the
issuer URL because they read the rest from the discovery document.
