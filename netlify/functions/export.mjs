import sql, { COLUMNS, json } from './_db.mjs';

// Every raw field, unlike GET /api/returns which only exposes the trimmed
// accountability_summary view. Same admin token as /api/migrate — opening
// this URL in a browser downloads a CSV, no database client needed.
const EXPORT_COLUMNS = ['id', 'submitted_at', 'person_id', ...COLUMNS];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!process.env.MIGRATE_TOKEN || token !== process.env.MIGRATE_TOKEN) {
    return json({ error: 'forbidden' }, 403);
  }
  try {
    const rows = await sql`SELECT * FROM accountability_returns ORDER BY submitted_at`;
    const lines = [EXPORT_COLUMNS.join(',')];
    for (const r of rows) lines.push(EXPORT_COLUMNS.map(c => csvEscape(r[c])).join(','));
    const date = new Date().toISOString().slice(0, 10);
    return new Response(lines.join('\r\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cmfi-accountability-export-${date}.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    console.error('Export failed:', err.message);
    return json({ error: 'export_failed' }, 500);
  }
};

export const config = { path: '/api/export' };
