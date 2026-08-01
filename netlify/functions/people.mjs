import sql, { json, FIELD_LABELS } from './_db.mjs';

// Fields already shown as headline info on a person's detail page, so they
// aren't repeated again inside each entry's field list.
const HEADLINE_FIELDS = new Set(['full_name', 'phone', 'phone2', 'entry_type', 'trimester_number', 'submitted_at']);

function isBlank(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

async function listPeople() {
  return sql`
    SELECT
      p.id,
      p.full_name,
      array_remove(array_agg(DISTINCT pp.phone), NULL) AS phones,
      array_remove(array_agg(DISTINCT NULLIF(r.trimester_number, 0)), NULL) AS trimesters
    FROM people p
    LEFT JOIN person_phones pp ON pp.person_id = p.id
    LEFT JOIN accountability_returns r ON r.person_id = p.id
    GROUP BY p.id, p.full_name
    ORDER BY p.full_name
  `;
}

async function personDetail(id) {
  const [person] = await sql`SELECT id, full_name FROM people WHERE id = ${id}`;
  if (!person) return null;

  const phoneRows = await sql`SELECT phone FROM person_phones WHERE person_id = ${id} ORDER BY phone`;
  const returns = await sql`
    SELECT * FROM accountability_returns
    WHERE person_id = ${id}
    ORDER BY trimester_number NULLS LAST, entry_type, submitted_at
  `;

  const entries = returns.map(r => ({
    id: r.id,
    trimester_number: r.trimester_number,
    entry_type: r.entry_type,
    submitted_at: r.submitted_at,
    fields: FIELD_LABELS
      .filter(([col]) => !HEADLINE_FIELDS.has(col))
      .map(([col, label]) => ({ label, value: r[col] }))
      .filter(f => !isBlank(f.value))
  }));

  return { person: { id: person.id, full_name: person.full_name, phones: phoneRows.map(p => p.phone) }, entries };
}

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!process.env.MIGRATE_TOKEN || token !== process.env.MIGRATE_TOKEN) {
    return json({ error: 'forbidden' }, 403);
  }

  try {
    const id = url.searchParams.get('id');
    if (id) {
      const detail = await personDetail(id);
      if (!detail) return json({ error: 'not_found' }, 404);
      return json(detail);
    }
    return json(await listPeople());
  } catch (err) {
    console.error('People lookup failed:', err.message);
    return json({ error: 'lookup_failed' }, 500);
  }
};

export const config = { path: '/api/people' };
