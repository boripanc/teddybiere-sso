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
    `SELECT client_id, name, metadata->'redirect_uris' AS redirect_uris, created_at FROM clients ORDER BY created_at`,
  );
  return rows;
}

export async function deleteClient(clientId: string) {
  await pool.query(`DELETE FROM clients WHERE client_id = $1`, [clientId]);
}
