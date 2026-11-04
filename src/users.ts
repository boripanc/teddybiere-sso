import { hash, verify } from '@node-rs/argon2';
import { pool } from './db.js';

export interface User {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
}

// Used so a login attempt for an unknown email takes as long as a real one.
const DUMMY_HASH = await hash('not-a-real-password');

export async function createUser(email: string, name: string, password: string, isAdmin = false): Promise<User> {
  if (password.length < 10) throw new Error('Password must be at least 10 characters');
  const passwordHash = await hash(password);
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash, is_admin) VALUES (lower($1), $2, $3, $4)
     RETURNING id, email, name, is_admin`,
    [email, name, passwordHash, isAdmin],
  );
  return rows[0];
}

export async function findUserById(id: string): Promise<User | undefined> {
  const { rows } = await pool.query(`SELECT id, email, name, is_admin FROM users WHERE id = $1`, [id]);
  return rows[0];
}

export async function checkCredentials(email: string, password: string): Promise<User | undefined> {
  const { rows } = await pool.query(
    `SELECT id, email, name, is_admin, password_hash FROM users WHERE email = lower($1)`,
    [email],
  );
  const row = rows[0];
  const ok = await verify(row?.password_hash ?? DUMMY_HASH, password).catch(() => false);
  if (!row || !ok) return undefined;
  const { password_hash: _, ...user } = row;
  return user;
}

export async function listUsers(): Promise<(User & { created_at: Date })[]> {
  const { rows } = await pool.query(`SELECT id, email, name, is_admin, created_at FROM users ORDER BY created_at`);
  return rows;
}

export async function setPassword(id: string, password: string): Promise<void> {
  if (password.length < 10) throw new Error('Password must be at least 10 characters');
  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, await hash(password)]);
  await revokeUserSessions(id);
}

export async function setAdmin(id: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE is_admin AND id <> $1`, [id]);
    if (rows[0].n === 0) throw new Error('There must be at least one admin');
  }
  await pool.query(`UPDATE users SET is_admin = $2 WHERE id = $1`, [id, isAdmin]);
}

export async function deleteUser(id: string): Promise<void> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE is_admin AND id <> $1`, [id]);
  const target = await findUserById(id);
  if (target?.is_admin && rows[0].n === 0) throw new Error('You cannot remove the last admin');
  await revokeUserSessions(id);
  await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
}

// Signs the user out everywhere: SSO sessions, grants and tokens, plus admin sessions.
export async function revokeUserSessions(id: string): Promise<void> {
  await pool.query(`DELETE FROM oidc_payloads WHERE payload->>'accountId' = $1`, [id]);
  await pool.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [id]);
}
