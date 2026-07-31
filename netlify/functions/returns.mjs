import sql, { buildRow, json, normPhone, normName } from './_db.mjs';

// people.phone always stores the normalised digits, never what was typed —
// that's what makes the exact-match lookup below reliable regardless of
// whether a submission included a country code or not.
async function createPerson(body) {
  const [person] = await sql`
    INSERT INTO people (full_name, phone)
    VALUES (${String(body.full_name).trim()}, ${normPhone(body.phone)})
    RETURNING id, full_name, phone
  `;
  return person;
}

// Matches a submission to a person by phone number. A phone with no prior
// name match (new sibling on a shared phone, or the same person's name
// drifted since last time) comes back as `candidates` instead of a
// resolved person — the client must ask the submitter which one is them
// and resubmit with either `person_id` or `new_person: true` set.
async function resolvePerson(body) {
  const phone = normPhone(body.phone);

  if (body.person_id) {
    const [person] = await sql`SELECT id, full_name, phone FROM people WHERE id = ${body.person_id}`;
    if (!person || person.phone !== phone) return null;
    return { person, isNew: false };
  }

  if (body.new_person) {
    return { person: await createPerson(body), isNew: true };
  }

  const matches = await sql`SELECT id, full_name, phone FROM people WHERE phone = ${phone}`;
  if (matches.length === 0) {
    return { person: await createPerson(body), isNew: true };
  }

  const exact = matches.filter(m => normName(m.full_name) === normName(body.full_name));
  if (exact.length === 1) {
    return { person: exact[0], isNew: false };
  }

  return { candidates: matches.map(m => ({ id: m.id, full_name: m.full_name })) };
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
    // Required: it's the only thing that links this submission to the
    // person's next one. Without it every submission becomes an orphan.
    if (!body?.phone || !String(body.phone).trim()) {
      return json({ error: 'missing_phone' }, 400);
    }

    let resolved;
    try {
      resolved = await resolvePerson(body);
    } catch (err) {
      console.error('Person lookup/create failed:', err.message);
      return json({ error: 'person_resolution_failed' }, 500);
    }
    if (!resolved) {
      return json({ error: 'person_mismatch' }, 400);
    }
    if (resolved.candidates) {
      return json({ error: 'confirm_person', candidates: resolved.candidates }, 409);
    }

    const row = buildRow(body);
    row.person_id = resolved.person.id;

    try {
      // One report per person per trimester. A repeat isn't blocked outright
      // (it might be a genuine correction) but must be explicitly confirmed.
      if (row.trimester_number != null && !body.confirm_duplicate) {
        const [dup] = await sql`
          SELECT id, submitted_at FROM accountability_returns
          WHERE person_id = ${resolved.person.id} AND trimester_number = ${row.trimester_number}
          ORDER BY submitted_at DESC LIMIT 1
        `;
        if (dup) {
          return json({ error: 'duplicate_trimester', existing: dup, trimester_number: row.trimester_number }, 409);
        }
      }

      const [saved] = await sql`
        INSERT INTO accountability_returns ${sql(row)}
        RETURNING id, submitted_at
      `;
      return json({ ...saved, person_id: resolved.person.id, is_new_person: resolved.isNew }, 201);
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
