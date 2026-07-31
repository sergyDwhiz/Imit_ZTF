-- Christian Missionary Fellowship International (CMFI)
-- Foundation Camp 2026 - Trimestral Accountability Form
-- PostgreSQL schema

CREATE TABLE IF NOT EXISTS accountability_returns (
    id                          BIGSERIAL PRIMARY KEY,
    submitted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    form_language               TEXT NOT NULL DEFAULT 'en' CHECK (form_language IN ('en', 'fr')),

    -- Identification
    full_name                   TEXT NOT NULL,
    phone                       TEXT,
    locality                    TEXT,
    spiritual_province          TEXT,
    trimester_number            SMALLINT CHECK (trimester_number BETWEEN 1 AND 4),
    month_from                  SMALLINT CHECK (month_from BETWEEN 1 AND 12),
    month_to                    SMALLINT CHECK (month_to BETWEEN 1 AND 12),

    -- 1. Accounts given
    acct_walk_with_god          BOOLEAN NOT NULL DEFAULT FALSE,
    acct_studies                BOOLEAN NOT NULL DEFAULT FALSE,
    acct_finances               BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE INDEX IF NOT EXISTS idx_returns_name
    ON accountability_returns (lower(full_name));
CREATE INDEX IF NOT EXISTS idx_returns_period
    ON accountability_returns (trimester_number, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_province
    ON accountability_returns (spiritual_province);

-- Convenience view for the province secretaries
CREATE OR REPLACE VIEW accountability_summary AS
SELECT
    id,
    submitted_at,
    full_name,
    phone,
    locality,
    spiritual_province,
    trimester_number,
    ddeg_number,
    bible_chapters,
    people_reached,
    conversions,
    added_to_church,
    fasts_wednesday + fasts_complete_3days AS total_fasts,
    proclamations,
    idols_uprooted
FROM accountability_returns;
