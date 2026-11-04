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
