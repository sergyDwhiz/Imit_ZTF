import postgres from 'postgres';

// One connection per Lambda container. Managed Postgres providers hand out a
// pooled connection string; keeping max at 1 stops cold starts from exhausting it.
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  ssl: process.env.PGSSL === 'false' ? false : 'require'
});

export default sql;

export const COLUMNS = [
  'form_language', 'full_name', 'phone', 'locality', 'spiritual_province',
  'trimester_number', 'month_from', 'month_to',
  'acct_walk_with_god', 'acct_studies', 'acct_finances', 'acct_service_to_god',
  'acct_given_to', 'acct_frequency',
  'ddeg_number', 'ddeg_time',
  'bible_chapters', 'bible_time', 'bible_memorisation',
  'literature',
  'prayer_alone_time', 'retreats_15min', 'thanksgiving_topics', 'prayer_topics',
  'prayers_answered', 'prayer_with_others',
  'people_reached', 'conversions', 'baptised_water', 'baptised_holy_spirit',
  'added_to_church', 'churches_planted', 'members_per_church',
  'fasts_wednesday', 'fasts_complete_3days', 'people_encouraged_to_fast',
  'prophecy_proclamations',
  'giving_percentage', 'giving_faithful', 'has_savings', 'savings_amount',
  'is_indebted', 'debt_amount', 'debt_reimbursed',
  'bertoua_units_completed', 'bertoua_times_done',
  'idols_uprooted', 'proclamations',
  'five_year_goal', 'distinct_service', 'making_disciples'
];

const INTEGERS = new Set([
  'trimester_number', 'month_from', 'month_to', 'ddeg_number', 'bible_chapters',
  'retreats_15min', 'thanksgiving_topics', 'prayer_topics', 'prayers_answered',
  'people_reached', 'conversions', 'baptised_water', 'baptised_holy_spirit',
  'added_to_church', 'churches_planted', 'fasts_wednesday', 'fasts_complete_3days',
  'people_encouraged_to_fast', 'prophecy_proclamations', 'bertoua_units_completed',
  'bertoua_times_done', 'idols_uprooted', 'proclamations'
]);

const DECIMALS = new Set([
  'giving_percentage', 'savings_amount', 'debt_amount', 'debt_reimbursed'
]);

// Tick boxes: the column is NOT NULL, and an absent value means "not ticked".
const CHECKBOXES = new Set([
  'acct_walk_with_god', 'acct_studies', 'acct_finances', 'acct_service_to_god'
]);

// Yes / no dropdowns: the column is nullable, and "left blank" is a real,
// distinct answer that must not be recorded as "no".
const TRISTATE = new Set(['giving_faithful', 'has_savings', 'is_indebted']);

const TEXT_LIMIT = 4000;

export function coerce(column, raw) {
  if (column === 'literature') {
    const rows = Array.isArray(raw) ? raw : [];
    return rows
      .filter(r => r && (r.title || r.author || r.pages))
      .slice(0, 20)
      .map(r => ({
        title: String(r.title ?? '').slice(0, 300),
        pages: r.pages === '' || r.pages == null ? null : Number(r.pages) || null,
        author: String(r.author ?? '').slice(0, 300)
      }));
  }
  if (CHECKBOXES.has(column)) {
    return raw === true || raw === 'true' || raw === 'yes' || raw === 'on';
  }
  if (TRISTATE.has(column)) {
    if (raw === true || raw === 'true' || raw === 'yes') return true;
    if (raw === false || raw === 'false' || raw === 'no') return false;
    return null;
  }
  if (raw === '' || raw === undefined || raw === null) return null;
  if (INTEGERS.has(column)) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (DECIMALS.has(column)) {
    const n = parseFloat(String(raw).replace(/[\s,]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return String(raw).trim().slice(0, TEXT_LIMIT);
}

export function buildRow(body) {
  const row = {};
  for (const c of COLUMNS) row[c] = coerce(c, body[c]);
  if (!['en', 'fr'].includes(row.form_language)) row.form_language = 'en';
  return row;
}

// Digits only, so "+237 600 000 001" and "237-600-000-001" match as the same phone.
export const normPhone = raw => String(raw ?? '').replace(/\D/g, '');

// Case/whitespace-insensitive, so retyping a name slightly differently
// between trimesters still counts as the same name.
export const normName = raw => String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
