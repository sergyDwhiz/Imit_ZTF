import sql, { buildRow, json, normPhone, normName, validateRow, fieldFromDbError } from './_db.mjs';

// Thrown inside the transaction to unwind it. Any answer that is not a
// saved return must leave the database exactly as it found it — the 20
// orphaned people in production are what happens when it does not.
class Outcome extends Error {
  constructor(status, body) { super('outcome'); this.status = status; this.body = body; }
}

// The primary phone plus the optional second number, normalised and
// deduplicated. A person can be found later by either one.
function submittedPhones(body) {
  return [...new Set([normPhone(body.phone), body.phone2 ? normPhone(body.phone2) : null].filter(Boolean))];
}

async function recordPhones(sql, personId, phones) {
  for (const phone of phones) {
    await sql`INSERT INTO person_phones (person_id, phone) VALUES (${personId}, ${phone}) ON CONFLICT DO NOTHING`;
  }
}

async function createPerson(sql, body, phones) {
  const [person] = await sql`
    INSERT INTO people (full_name, phone)
    VALUES (${String(body.full_name).trim()}, ${phones[0] || null})
    RETURNING id, full_name
  `;
  await recordPhones(sql, person.id, phones);
  return person;
}

// Fallback for someone with no phone at all — not even a shared or
// borrowed one. Matches by name + locality instead, and only against
// other phone-less people (people.phone IS NULL): a name+locality
// coincidence must never attach a submission to someone who actually has
// a phone-verified identity, so the two matching paths stay fully
// separate. Weaker than phone matching (names collide more easily), which
// is why it only applies when phone genuinely isn't available.
async function resolvePersonByNameLocality(sql, body) {
  const name = normName(body.full_name);
  const locality = normName(body.locality);

  const matches = await sql`
    SELECT DISTINCT p.id, p.full_name FROM people p
    JOIN accountability_returns r ON r.person_id = p.id
    WHERE p.phone IS NULL
      AND lower(trim(p.full_name)) = ${name}
      AND lower(trim(r.locality)) = ${locality}
  `;
  if (matches.length === 0) return { person: await createPerson(sql, body, []), isNew: true };
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
async function resolvePerson(sql, body) {
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
    await recordPhones(sql, person.id, phones);
    return { person, isNew: false };
  }

  if (body.no_phone) {
    if (body.new_person) return { person: await createPerson(sql, body, []), isNew: true };
    return resolvePersonByNameLocality(sql, body);
  }

  const phones = submittedPhones(body);
  if (body.new_person) {
    return { person: await createPerson(sql, body, phones), isNew: true };
  }

  const matches = await sql`
    SELECT DISTINCT p.id, p.full_name FROM people p
    JOIN person_phones pp ON pp.person_id = p.id
    WHERE pp.phone = ANY(${phones})
  `;
  if (matches.length === 0) {
    return { person: await createPerson(sql, body, phones), isNew: true };
  }

  const exact = matches.filter(m => normName(m.full_name) === normName(body.full_name));
  if (exact.length === 1) {
    await recordPhones(sql, exact[0].id, phones);
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

    // Checked before a single row is written. Every bound here is one the
    // database also enforces, so reaching Postgres with a bad value can only
    // ever produce a 500 the submitter cannot act on. Catching it up front
    // means we still know which question the value came from, and means a
    // rejected submission never leaves a half-created person behind.
    const row = buildRow(body);
    const problem = validateRow(row);
    if (problem) {
      return json({ error: 'field_invalid', ...problem }, 400);
    }

    try {
      const result = await sql.begin(async tx => {
        const resolved = await resolvePerson(tx, body);
        if (!resolved) throw new Outcome(400, { error: 'person_mismatch' });
        if (resolved.candidates) {
          throw new Outcome(409, { error: 'confirm_person', candidates: resolved.candidates });
        }

        row.person_id = resolved.person.id;

        // One goal and one result per person per trimester — those two are a
        // pair, not duplicates of each other, so the check is scoped to the
        // same entry_type. A repeat of the *same* type isn't blocked outright
        // (it might be a genuine correction) but must be explicitly confirmed.
        if (row.trimester_number != null && !body.confirm_duplicate) {
          const [dup] = await tx`
            SELECT id, submitted_at FROM accountability_returns
            WHERE person_id = ${resolved.person.id} AND trimester_number = ${row.trimester_number}
              AND entry_type = ${row.entry_type}
            ORDER BY submitted_at DESC LIMIT 1
          `;
          if (dup) {
            throw new Outcome(409, {
              error: 'duplicate_trimester', existing: dup,
              trimester_number: row.trimester_number, entry_type: row.entry_type
            });
          }
        }

        const [saved] = await tx`
          INSERT INTO accountability_returns ${tx(row)}
          RETURNING id, submitted_at
        `;
        return { ...saved, person_id: resolved.person.id, is_new_person: resolved.isNew, entry_type: row.entry_type };
      });
      return json(result, 201);
    } catch (err) {
      // Every non-201 answer arrives here, because unwinding the transaction
      // is the only way to guarantee nothing was left behind.
      if (err instanceof Outcome) return json(err.body, err.status);

      // A constraint we do not know about. Name the column if the error
      // carries one, so the submitter still learns which line to fix.
      const field = fieldFromDbError(err);
      console.error('Submission failed:', err.code || '', err.constraint_name || '', err.message);
      if (field) return json({ error: 'field_invalid', field, reason: 'rejected_by_database' }, 400);
      return json({ error: 'insert_failed', detail: err.code || null }, 500);
    }
  }

  if (req.method === 'GET') {
    // Same guard as people.mjs and export.mjs. This route returns every
    // member's name, phone, locality and province, and was the only one
    // reading member data without a token. Nothing in the site calls it —
    // index.html only ever POSTs here — so nothing breaks by closing it.
    const token = new URL(req.url).searchParams.get('token');
    if (!process.env.MIGRATE_TOKEN || token !== process.env.MIGRATE_TOKEN) {
      return json({ error: 'forbidden' }, 403);
    }

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
