import type { Adapter, AdapterPayload } from 'oidc-provider';
import { pool } from './db.js';

// Storage adapter for oidc-provider backed by Postgres.
// Clients come from the `clients` table; everything else lives in `oidc_payloads`.
export class PgAdapter implements Adapter {
  constructor(private readonly name: string) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    if (this.name === 'Client') throw new Error('Clients are managed through the CLI/admin, not the adapter');
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    await pool.query(
      `INSERT INTO oidc_payloads (id, type, payload, grant_id, user_code, uid, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id, type) DO UPDATE
         SET payload = EXCLUDED.payload, grant_id = EXCLUDED.grant_id, user_code = EXCLUDED.user_code,
             uid = EXCLUDED.uid, expires_at = EXCLUDED.expires_at`,
      [id, this.name, payload, payload.grantId ?? null, payload.userCode ?? null, payload.uid ?? null, expiresAt],
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    if (this.name === 'Client') {
      const { rows } = await pool.query(`SELECT metadata FROM clients WHERE client_id = $1`, [id]);
      return rows[0]?.metadata;
    }
    return this.findWhere('id', id);
  }

  findByUid(uid: string) {
    return this.findWhere('uid', uid);
  }

  findByUserCode(userCode: string) {
    return this.findWhere('user_code', userCode);
  }

  private async findWhere(column: 'id' | 'uid' | 'user_code', value: string): Promise<AdapterPayload | undefined> {
    const { rows } = await pool.query(
      `SELECT payload, consumed_at FROM oidc_payloads
       WHERE ${column} = $1 AND type = $2 AND (expires_at IS NULL OR expires_at > now())`,
      [value, this.name],
    );
    if (!rows[0]) return undefined;
    const payload = rows[0].payload as AdapterPayload;
    if (rows[0].consumed_at) payload.consumed = Math.floor(new Date(rows[0].consumed_at).getTime() / 1000);
    return payload;
  }

  async consume(id: string): Promise<void> {
    await pool.query(`UPDATE oidc_payloads SET consumed_at = now() WHERE id = $1 AND type = $2`, [id, this.name]);
  }

  async destroy(id: string): Promise<void> {
    await pool.query(`DELETE FROM oidc_payloads WHERE id = $1 AND type = $2`, [id, this.name]);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await pool.query(`DELETE FROM oidc_payloads WHERE grant_id = $1`, [grantId]);
  }
}
