import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email         text NOT NULL UNIQUE,
      name          text NOT NULL DEFAULT '',
      password_hash text NOT NULL,
      is_admin      boolean NOT NULL DEFAULT false,
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    -- Registered apps ("clients"). metadata holds the OIDC client metadata.
    CREATE TABLE IF NOT EXISTS clients (
      client_id  text PRIMARY KEY,
      name       text NOT NULL,
      metadata   jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Sessions, auth codes, tokens, grants etc. stored by oidc-provider.
    CREATE TABLE IF NOT EXISTS oidc_payloads (
      id          text NOT NULL,
      type        text NOT NULL,
      payload     jsonb NOT NULL,
      grant_id    text,
      user_code   text,
      uid         text,
      expires_at  timestamptz,
      consumed_at timestamptz,
      PRIMARY KEY (id, type)
    );
    CREATE INDEX IF NOT EXISTS oidc_payloads_grant_id ON oidc_payloads (grant_id);
    CREATE INDEX IF NOT EXISTS oidc_payloads_uid ON oidc_payloads (uid);
    CREATE INDEX IF NOT EXISTS oidc_payloads_user_code ON oidc_payloads (user_code);
    CREATE INDEX IF NOT EXISTS oidc_payloads_expires_at ON oidc_payloads (expires_at);

    -- Token signing keys (private JWKs). Newest key signs; all are published for verification.
    CREATE TABLE IF NOT EXISTS signing_keys (
      id         serial PRIMARY KEY,
      jwk        jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

// Remove expired sessions/tokens. Run periodically.
export async function cleanupExpired(): Promise<void> {
  await pool.query(`DELETE FROM oidc_payloads WHERE expires_at IS NOT NULL AND expires_at < now()`);
}
