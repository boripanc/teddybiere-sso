import { randomBytes } from 'node:crypto';
import { pool } from './db.js';

export interface NewClient {
  name: string;
  redirectUris: string[];
  postLogoutRedirectUris?: string[];
  // "confidential" apps have a server that can keep a secret; "public" apps (SPA, mobile) use PKCE only.
  type?: 'confidential' | 'public';
}

export async function createClient(input: NewClient) {
  if (!input.name.trim()) throw new Error('App name is required');
  if (input.redirectUris.length === 0) throw new Error('At least one redirect URL is required');
  validateUris(input.redirectUris);
  validateUris(input.postLogoutRedirectUris ?? []);
  const clientId = randomBytes(12).toString('base64url');
  const isPublic = input.type === 'public';
  const clientSecret = isPublic ? undefined : randomBytes(32).toString('base64url');
  const metadata = {
    client_id: clientId,
    client_name: input.name,
    redirect_uris: input.redirectUris,
    post_logout_redirect_uris: input.postLogoutRedirectUris ?? [],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: isPublic ? 'none' : 'client_secret_basic',
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  };
  await pool.query(`INSERT INTO clients (client_id, name, metadata) VALUES ($1, $2, $3)`, [clientId, input.name, metadata]);
  return { clientId, clientSecret };
}

export async function listClients() {
  const { rows } = await pool.query(
    `SELECT client_id, name, metadata->'redirect_uris' AS redirect_uris,
            metadata->'post_logout_redirect_uris' AS post_logout_redirect_uris,
            metadata->>'token_endpoint_auth_method' = 'none' AS is_public, created_at
     FROM clients ORDER BY created_at`,
  );
  return rows;
}

export async function updateClientUris(clientId: string, redirectUris: string[], postLogoutRedirectUris: string[]) {
  validateUris(redirectUris);
  validateUris(postLogoutRedirectUris);
  await pool.query(
    `UPDATE clients SET metadata = metadata || jsonb_build_object('redirect_uris', $2::jsonb, 'post_logout_redirect_uris', $3::jsonb)
     WHERE client_id = $1`,
    [clientId, JSON.stringify(redirectUris), JSON.stringify(postLogoutRedirectUris)],
  );
}

// Creates a new secret. The old one stops working immediately.
export async function rotateClientSecret(clientId: string): Promise<string> {
  const secret = randomBytes(32).toString('base64url');
  const { rowCount } = await pool.query(
    `UPDATE clients SET metadata = jsonb_set(metadata, '{client_secret}', to_jsonb($2::text))
     WHERE client_id = $1 AND metadata->>'token_endpoint_auth_method' <> 'none'`,
    [clientId, secret],
  );
  if (!rowCount) throw new Error('This app has no secret (it is a public app)');
  return secret;
}

export async function deleteClient(clientId: string) {
  await pool.query(`DELETE FROM oidc_payloads WHERE payload->>'clientId' = $1`, [clientId]);
  await pool.query(`DELETE FROM clients WHERE client_id = $1`, [clientId]);
}

function validateUris(uris: string[]) {
  for (const u of uris) {
    let url: URL;
    try { url = new URL(u); } catch { throw new Error(`Not a valid URL: ${u}`); }
    if (url.hash) throw new Error(`Redirect URLs cannot contain #: ${u}`);
  }
}
