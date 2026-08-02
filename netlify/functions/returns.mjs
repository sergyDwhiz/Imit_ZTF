import sql, { buildRow, json, normPhone, normName } from './_db.mjs';

// The primary phone plus the optional second number, normalised and
// deduplicated. A person can be found later by either one.
function submittedPhones(body) {
  return [...new Set([normPhone(body.phone), body.phone2 ? normPhone(body.phone2) : null].filter(Boolean))];
}

async function recordPhones(personId, phones) {
  for (const phone of phones) {
    await sql`INSERT INTO person_phones (person_id, phone) VALUES (${personId}, ${phone}) ON CONFLICT DO NOTHING`;
  }
}

async function createPerson(body, phones) {
  const [person] = await sql`
    INSERT INTO people (full_name, phone)
    VALUES (${String(body.full_name).trim()}, ${phones[0] || null})
    RETURNING id, full_name
  `;
  await recordPhones(person.id, phones);
  return person;
}

// Fallback for someone with no phone at all — not even a shared or
// borrowed one. Matches by name + locality instead, and only against
// other phone-less people (people.phone IS NULL): a name+locality
// coincidence must never attach a submission to someone who actually has
// a phone-verified identity, so the two matching paths stay fully
// separate. Weaker than phone matching (names collide more easily), which
// is why it only applies when phone genuinely isn't available.
async function resolvePersonByNameLocality(body) {
  const name = normName(body.full_name);
  const locality = normName(body.locality);

  const matches = await sql`
    SELECT DISTINCT p.id, p.full_name FROM people p
    JOIN accountability_returns r ON r.person_id = p.id
    WHERE p.phone IS NULL
      AND lower(trim(p.full_name)) = ${name}
      AND lower(trim(r.locality)) = ${locality}
  `;
  if (matches.length === 0) return { person: await createPerson(body, []), isNew: true };
  if (matches.length === 1) return { person: matches[0], isNew: false };
  return { candidates: matches.map(m => ({ id: m.id, full_name: m.full_name })) };
}

// Matches a submission to a person by phone number — checking every number
// on record for every person, not just one, since a person can have more
// than one (a second SIM, a changed number, or one given up front). A
// phone with no prior name match (new sibling on a shared phone, or the
// same person's name drifted since last time) comes back as `candidates`
// instead of a resolved person — the client must ask the submitter which
// one is them and resubmit with either `person_id` or `new_person: true`
// set. Whichever numbers were submitted this time are recorded against the
// resolved person, so a second number typed later still links up.
async function resolvePerson(body) {
  if (body.person_id) {
    const [person] = await sql`SELECT id, full_name, phone FROM people WHERE id = ${body.person_id}`;
    if (!person) return null;
    if (body.no_phone) {
      if (person.phone !== null) return null;
      return { person, isNew: false };
    }
    const phones = submittedPhones(body);
    const [known] = await sql`
      SELECT 1 FROM person_phones WHERE person_id = ${body.person_id} AND phone = ANY(${phones})
    `;
    if (!known) return null;
    await recordPhones(person.id, phones);
    return { person, isNew: false };
  }

  if (body.no_phone) {
    if (body.new_person) return { person: await createPerson(body, []), isNew: true };
    return resolvePersonByNameLocality(body);
  }

  const phones = submittedPhones(body);
  if (body.new_person) {
    return { person: await createPerson(body, phones), isNew: true };
  }

  const matches = await sql`
    SELECT DISTINCT p.id, p.full_name FROM people p
    JOIN person_phones pp ON pp.person_id = p.id
    WHERE pp.phone = ANY(${phones})
  `;
  if (matches.length === 0) {
    return { person: await createPerson(body, phones), isNew: true };
  }

  const exact = matches.filter(m => normName(m.full_name) === normName(body.full_name));
  if (exact.length === 1) {
    await recordPhones(exact[0].id, phones);
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
    if (body.no_phone) {
      // With no phone, locality is the only other piece of the fallback
      // match — without it there'd be nothing but a name to go on.
      if (!body?.locality || !String(body.locality).trim()) {
        return json({ error: 'missing_locality' }, 400);
      }
    } else if (!body?.phone || !String(body.phone).trim()) {
      // Required: it's the only thing that links this submission to the
      // person's next one. Without it every submission becomes an orphan.
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
      // One goal and one result per person per trimester — those two are a
      // pair, not duplicates of each other, so the check is scoped to the
      // same entry_type. A repeat of the *same* type isn't blocked outright
      // (it might be a genuine correction) but must be explicitly confirmed.
      if (row.trimester_number != null && !body.confirm_duplicate) {
        const [dup] = await sql`
          SELECT id, submitted_at FROM accountability_returns
          WHERE person_id = ${resolved.person.id} AND trimester_number = ${row.trimester_number}
            AND entry_type = ${row.entry_type}
          ORDER BY submitted_at DESC LIMIT 1
        `;
        if (dup) {
          return json({ error: 'duplicate_trimester', existing: dup, trimester_number: row.trimester_number, entry_type: row.entry_type }, 409);
        }
      }

      const [saved] = await sql`
        INSERT INTO accountability_returns ${sql(row)}
        RETURNING id, submitted_at
      `;
      return json({ ...saved, person_id: resolved.person.id, is_new_person: resolved.isNew, entry_type: row.entry_type }, 201);
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
