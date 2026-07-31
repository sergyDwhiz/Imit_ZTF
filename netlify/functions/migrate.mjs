import sql, { json } from './_db.mjs';
import { readFile } from 'node:fs/promises';

// Creates the table on a fresh database. Idempotent, but gated so it is not
// a public endpoint. Set MIGRATE_TOKEN in the Netlify environment, then call
// /api/migrate?token=... once after deploying.
export default async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!process.env.MIGRATE_TOKEN || token !== process.env.MIGRATE_TOKEN) {
    return json({ error: 'forbidden' }, 403);
  }
  try {
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await sql.unsafe(schema);
    return json({ status: 'schema_ready' });
  } catch (err) {
    console.error('Migration failed:', err.message);
    return json({ error: 'migration_failed', detail: err.message }, 500);
  }
};

export const config = { path: '/api/migrate' };
