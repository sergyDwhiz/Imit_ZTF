import sql, { buildRow, json, genMemberCode } from './_db.mjs';

// A returning person must supply the member_code they were given on their
// first submission — that is the only thing that links a new return to an
// existing person. No code means a brand new person record is created.
async function resolvePerson(body) {
  const rawCode = body.member_code ? String(body.member_code).trim().toUpperCase() : '';

  if (rawCode) {
    const [person] = await sql`SELECT id, member_code FROM people WHERE member_code = ${rawCode}`;
    return person ? { person, isNew: false } : null;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [person] = await sql`
        INSERT INTO people (member_code, full_name, phone)
        VALUES (${genMemberCode()}, ${String(body.full_name).trim()}, ${body.phone ? String(body.phone).trim() : null})
        RETURNING id, member_code
      `;
      return { person, isNew: true };
    } catch (err) {
      if (err.code !== '23505') throw err; // unique_violation on member_code, retry with a new one
    }
  }
  throw new Error('could not generate a unique member code');
}

export default async (req) => {
  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    if (!body?.full_name || !String(body.full_name).trim()) {
      return json({ error: 'missing_name' }, 400);
    }

    let resolved;
    try {
      resolved = await resolvePerson(body);
    } catch (err) {
      console.error('Person lookup/create failed:', err.message);
      return json({ error: 'person_resolution_failed' }, 500);
    }
    if (!resolved) {
      return json({ error: 'member_code_not_found' }, 404);
    }

    const row = buildRow(body);
    row.person_id = resolved.person.id;

    try {
      const [saved] = await sql`
        INSERT INTO accountability_returns ${sql(row)}
        RETURNING id, submitted_at
      `;
      return json({ ...saved, member_code: resolved.person.member_code, is_new_member: resolved.isNew }, 201);
    } catch (err) {
      console.error('Insert failed:', err.message);
      return json({ error: 'insert_failed' }, 500);
    }
  }

  if (req.method === 'GET') {
    const limit = Math.min(
      parseInt(new URL(req.url).searchParams.get('limit'), 10) || 100,
      500
    );
    try {
      const rows = await sql`
        SELECT * FROM accountability_summary
        ORDER BY submitted_at DESC
        LIMIT ${limit}
      `;
      return json(rows);
    } catch (err) {
      console.error('Query failed:', err.message);
      return json({ error: 'query_failed' }, 500);
    }
  }

  return json({ error: 'method_not_allowed' }, 405);
};

export const config = { path: '/api/returns' };
