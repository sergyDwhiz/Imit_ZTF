-- Christian Missionary Fellowship International (CMFI)
-- Foundation Camp 2026 - Trimestral Accountability Form
-- PostgreSQL schema

-- One row per person. A later submission is matched back to an existing
-- row by phone number (normalised to digits only); if that phone has more
-- than one name on record (e.g. siblings sharing a household phone), the
-- submitter is asked to pick which one is them rather than guessing.
-- phone is nullable: someone with no phone at all (not even a shared or
-- borrowed one) is matched by name + locality instead — weaker, but the
-- only option when there is truly no number to use.
CREATE TABLE IF NOT EXISTS people (
    id                          BIGSERIAL PRIMARY KEY,
    full_name                   TEXT NOT NULL,
    phone                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cleans up the member-code approach from an earlier revision, superseded
-- by phone-based matching above. The old accountability_summary view read
-- this column, so it must be dropped first (recreated further down).
DROP VIEW IF EXISTS accountability_summary;
ALTER TABLE people DROP COLUMN IF EXISTS member_code;

-- A person can have more than one phone number over time (a second SIM, a
-- changed number) or may simply give a second number up front so either
-- one finds their record next time. Every number a person has ever
-- submitted lives here; matching checks all of them, not just one.
CREATE TABLE IF NOT EXISTS person_phones (
    person_id                   BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    phone                       TEXT NOT NULL,
    PRIMARY KEY (person_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_person_phones_phone ON person_phones (phone);

-- Backfill: every person created before this table existed only has their
-- one phone recorded on the people row itself.
INSERT INTO person_phones (person_id, phone)
SELECT id, phone FROM people
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS accountability_returns (
    id                          BIGSERIAL PRIMARY KEY,
    submitted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A trimester has two distinct entries: the goal set beforehand and
    -- the actual result reported afterwards. They are a pair, not
    -- duplicates of each other. Never shown or chosen on the form itself —
    -- an internal distinction, set only via a hidden URL flag staff use.
    entry_type                  TEXT NOT NULL DEFAULT 'result' CHECK (entry_type IN ('goal', 'result')),

    -- Identification
    full_name                   TEXT NOT NULL,
    phone                       TEXT,
    phone2                      TEXT,
    -- 0 means "not specified", not unknown/missing — a real, comparable
    -- value so the duplicate-trimester check still applies to it.
    trimester_number             SMALLINT NOT NULL DEFAULT 0 CHECK (trimester_number BETWEEN 0 AND 4),
    locality                    TEXT,
    spiritual_province          TEXT,
    month_from                  SMALLINT CHECK (month_from BETWEEN 1 AND 12),
    month_to                    SMALLINT CHECK (month_to BETWEEN 1 AND 12),

    -- Links each return to a person (see people table above) so their
    -- trimestral reports stack up into one history instead of
    -- disconnected rows. Resolved by phone number at submit time.
    person_id                   BIGINT REFERENCES people(id),

    -- 1. Accounts given
    acct_walk_with_god          BOOLEAN NOT NULL DEFAULT FALSE,
    acct_studies                BOOLEAN NOT NULL DEFAULT FALSE,
    acct_finances                BOOLEAN NOT NULL DEFAULT FALSE,
    acct_service_to_god         BOOLEAN NOT NULL DEFAULT FALSE,
    acct_given_to               TEXT,
    acct_frequency              TEXT CHECK (acct_frequency IN ('day', 'week', 'month')),

    -- 2. Daily dynamic encounters with God
    ddeg_number                 INTEGER CHECK (ddeg_number >= 0),
    ddeg_time                   TEXT,

    -- 3. Bible reading
    bible_chapters              INTEGER CHECK (bible_chapters >= 0),
    bible_time                  TEXT,

    -- 4. Bible memorisation
    bible_memorisation          TEXT,

    -- 5. Christian literature: [{ title, pages, author }, ...]
    literature                  JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- 6. Prayer alone
    prayer_alone_time           TEXT,
    retreats_15min              INTEGER CHECK (retreats_15min >= 0),
    thanksgiving_topics         INTEGER CHECK (thanksgiving_topics >= 0),
    prayer_topics               INTEGER CHECK (prayer_topics >= 0),
    prayers_answered            INTEGER CHECK (prayers_answered >= 0),

    -- 7. Prayer with others / house church / local church
    prayer_with_others          TEXT,

    -- 8. Soul winning
    people_reached              INTEGER CHECK (people_reached >= 0),
    conversions                 INTEGER CHECK (conversions >= 0),
    baptised_water              INTEGER CHECK (baptised_water >= 0),
    baptised_holy_spirit        INTEGER CHECK (baptised_holy_spirit >= 0),
    added_to_church             INTEGER CHECK (added_to_church >= 0),
    churches_planted            INTEGER CHECK (churches_planted >= 0),
    members_per_church          TEXT,

    -- 9. Fasts
    fasts_wednesday             INTEGER CHECK (fasts_wednesday >= 0),
    fasts_complete_3days        INTEGER CHECK (fasts_complete_3days >= 0),
    people_encouraged_to_fast   INTEGER CHECK (people_encouraged_to_fast >= 0),

    -- 10. Proclamations of the prophecy
    prophecy_proclamations      INTEGER CHECK (prophecy_proclamations >= 0),

    -- 11. Finances
    giving_percentage           NUMERIC(5,2) CHECK (giving_percentage >= 0 AND giving_percentage <= 100),
    giving_faithful             BOOLEAN,
    has_savings                 BOOLEAN,
    savings_amount              NUMERIC(14,2) CHECK (savings_amount >= 0),
    is_indebted                 BOOLEAN,
    debt_amount                 NUMERIC(14,2) CHECK (debt_amount >= 0),
    debt_reimbursed             NUMERIC(14,2) CHECK (debt_reimbursed >= 0),

    -- 12. Bertoua message
    bertoua_units_completed     INTEGER CHECK (bertoua_units_completed >= 0),
    bertoua_times_done          INTEGER CHECK (bertoua_times_done >= 0),

    -- 13. Uprooting of idols
    idols_uprooted              INTEGER CHECK (idols_uprooted >= 0),

    -- 14. Proclamations
    proclamations               INTEGER CHECK (proclamations >= 0),

    -- 15-17. Narrative sections
    five_year_goal              TEXT,
    distinct_service            TEXT,
    making_disciples            TEXT
);

-- Idempotent safety net for any environment where these were added after
-- the initial release via ALTER TABLE, rather than being present in the
-- CREATE TABLE above from the start (a fresh database already has them).
ALTER TABLE accountability_returns ADD COLUMN IF NOT EXISTS person_id BIGINT REFERENCES people(id);
-- Reversed from an earlier revision: phone was made required, but someone
-- with no phone at all still needs to be able to submit (matched by name +
-- locality instead).
ALTER TABLE people ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE accountability_returns ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE accountability_returns
    ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'result'
    CHECK (entry_type IN ('goal', 'result'));
ALTER TABLE accountability_returns ADD COLUMN IF NOT EXISTS phone2 TEXT;

-- 0 now means "not specified" instead of leaving trimester_number null,
-- so the duplicate check still applies to blank-trimester submissions.
-- The old constraint (1-4 only) must go first, or the UPDATE below that
-- sets 0 would violate it. Dropped by scanning for it rather than by a
-- fixed expected name — an earlier table rebuild left this one under an
-- auto-suffixed name (a naming collision at the time), not the plain one.
DO $$
DECLARE con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'accountability_returns'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%trimester_number%'
  LOOP
    EXECUTE 'ALTER TABLE accountability_returns DROP CONSTRAINT ' || quote_ident(con.conname);
  END LOOP;
END $$;
UPDATE accountability_returns SET trimester_number = 0 WHERE trimester_number IS NULL;
ALTER TABLE accountability_returns ALTER COLUMN trimester_number SET DEFAULT 0;
ALTER TABLE accountability_returns ALTER COLUMN trimester_number SET NOT NULL;
ALTER TABLE accountability_returns ADD CONSTRAINT accountability_returns_trimester_number_check
    CHECK (trimester_number BETWEEN 0 AND 4);

-- Not useful data for tracking anyone's progress — dropped, the EN/FR
-- toggle on the form itself is untouched, this only stops recording it.
ALTER TABLE accountability_returns DROP COLUMN IF EXISTS form_language;

CREATE INDEX IF NOT EXISTS idx_returns_name
    ON accountability_returns (lower(full_name));
CREATE INDEX IF NOT EXISTS idx_returns_period
    ON accountability_returns (trimester_number, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_province
    ON accountability_returns (spiritual_province);
CREATE INDEX IF NOT EXISTS idx_returns_person
    ON accountability_returns (person_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_person_trimester_type
    ON accountability_returns (person_id, trimester_number, entry_type);
CREATE INDEX IF NOT EXISTS idx_people_phone
    ON people (phone);

-- Convenience view for the province secretaries.
-- Dropped and recreated (rather than CREATE OR REPLACE) because the column
-- list has changed shape since the view was first created, which CREATE OR
-- REPLACE VIEW does not allow.
DROP VIEW IF EXISTS accountability_summary;
CREATE VIEW accountability_summary AS
SELECT
    r.id,
    r.submitted_at,
    r.person_id,
    r.entry_type,
    r.full_name,
    r.phone,
    r.trimester_number,
    r.locality,
    r.spiritual_province,
    r.ddeg_number,
    r.bible_chapters,
    r.people_reached,
    r.conversions,
    r.added_to_church,
    r.fasts_wednesday + r.fasts_complete_3days AS total_fasts,
    r.proclamations,
    r.idols_uprooted
FROM accountability_returns r;
