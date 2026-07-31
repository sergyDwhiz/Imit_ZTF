import sql, { json } from './_db.mjs';

export default async () => {
  try {
    await sql`SELECT 1`;
    return json({ database: 'up' });
  } catch {
    return json({ database: 'down' }, 503);
  }
};

export const config = { path: '/api/health' };
