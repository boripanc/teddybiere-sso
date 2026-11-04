import { exportJWK, generateKeyPair, calculateJwkThumbprint, type JWK } from 'jose';
import { pool } from './db.js';

async function newKey(alg: 'RS256' | 'ES256'): Promise<JWK> {
  const { privateKey } = await generateKeyPair(alg, { extractable: true, ...(alg === 'RS256' ? { modulusLength: 2048 } : {}) });
  const jwk = await exportJWK(privateKey);
  return { ...jwk, alg, use: 'sig', kid: await calculateJwkThumbprint(jwk) };
}

// Loads signing keys from the database, creating them on first start.
// RS256 is listed first because it is the algorithm every OIDC app supports.
export async function loadSigningKeys(): Promise<JWK[]> {
  const { rows } = await pool.query(`SELECT jwk FROM signing_keys ORDER BY id DESC`);
  if (rows.length > 0) return rows.map((r) => r.jwk);
  const keys = [await newKey('RS256'), await newKey('ES256')];
  for (const k of keys.slice().reverse()) await pool.query(`INSERT INTO signing_keys (jwk) VALUES ($1)`, [k]);
  return keys;
}
