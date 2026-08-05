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

// The actual form question wording for each column, not the database's
// internal short name — shared by the CSV export and the admin browse
// page, both of which show this to a human rather than a developer.
export const FIELD_LABELS = [
  ['submitted_at', 'Date Submitted'],
  ['entry_type', 'Goal or Result'],
  ['full_name', 'Name'],
  ['phone', 'Phone'],
  ['phone2', 'Second Phone'],
  ['locality', 'Locality'],
  ['spiritual_province', 'Spiritual Province or Nation'],
  ['trimester_number', 'Trimester'],
  ['month_from', 'From the Month Of'],
  ['month_to', 'To the Month Of'],
  ['acct_walk_with_god', 'I Gave Accounts Of: My Walk With God'],
  ['acct_studies', 'I Gave Accounts Of: My Studies'],
  ['acct_finances', 'I Gave Accounts Of: My Finances'],
  ['acct_service_to_god', 'I Gave Accounts Of: My Service To God'],
  ['acct_given_to', 'Accounts Given To'],
  ['acct_frequency', 'Frequency Of Giving Accounts'],
  ['ddeg_number', 'Daily Dynamic Encounters With God: Number'],
  ['ddeg_time', 'Daily Dynamic Encounters With God: Time'],
  ['bible_chapters', 'Bible Reading: Chapters Read'],
  ['bible_time', 'Bible Reading: Time Spent Reading'],
  ['bible_memorisation', 'Bible Memorisation: Passages Memorised'],
  ['literature', 'Reading Of Christian Literature'],
  ['prayer_alone_time', 'Prayer Alone: Time Spent Praying Alone'],
  ['retreats_15min', 'Prayer Alone: 15 Minute Retreats'],
  ['thanksgiving_topics', 'Prayer Alone: Thanksgiving Topics Recorded'],
  ['prayer_topics', 'Prayer Alone: Prayer Topics Recorded'],
  ['prayers_answered', 'Prayer Alone: Prayers Answered'],
  ['prayer_with_others', 'Prayer With Others, The House Church Or The Local Church'],
  ['people_reached', 'Soul Winning: People Reached With The Gospel'],
  ['conversions', 'Soul Winning: Conversions'],
  ['baptised_water', 'Soul Winning: Baptised In Water'],
  ['baptised_holy_spirit', 'Soul Winning: Baptised In The Holy Spirit'],
  ['added_to_church', 'Soul Winning: Added To The Church'],
  ['churches_planted', 'Soul Winning: Churches Planted'],
  ['members_per_church', 'Soul Winning: Members Per Church'],
  ['fasts_wednesday', 'Fasts: Wednesday Fasts'],
  ['fasts_complete_3days', 'Fasts: Complete Fasts Of 3 Days Or More'],
  ['people_encouraged_to_fast', 'Fasts: People Encouraged To Fast'],
  ['prophecy_proclamations', 'Proclamation Of The Prophecy: Number'],
  ['giving_percentage', 'Giving To God: Percentage'],
  ['giving_faithful', 'Giving To God: Faithfulness'],
  ['has_savings', 'Savings: Do You Have Savings'],
  ['savings_amount', 'Savings: How Much (FCFA)'],
  ['is_indebted', 'Debts: Are You Indebted'],
  ['debt_amount', 'Debts: If Yes, How Much (FCFA)'],
  ['debt_reimbursed', 'Debts: Reimbursed So Far (FCFA)'],
  ['bertoua_units_completed', 'Bertoua Message: Teaching Units Completed And Marked'],
  ['bertoua_times_done', 'Bertoua Message: Number Of Times You Did Them'],
  ['idols_uprooted', 'Uprooting Of Idols: Idols Uprooted'],
  ['proclamations', 'Proclamations: Number'],
  ['five_year_goal', 'Your Involvement In The Five Year Goal'],
  ['distinct_service', 'Distinct Service To God And To Man'],
  ['making_disciples', 'Making Of Disciples']
];

export const COLUMNS = [
  'entry_type', 'full_name', 'phone', 'phone2', 'locality', 'spiritual_province',
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

// Every bound the database enforces, restated here so a value that would
// break a CHECK is caught while we still know which question it came from.
// Postgres only tells us the constraint name after the fact, and only for
// the first failure; the submitter needs the field, not the constraint.
//
// The upper bounds are not decoration. INTEGER stops at 2147483647, and a
// phone number typed into a counting box clears that easily, which is one
// of the two ways submissions were being lost. NUMERIC(5,2) with a 0-100
// CHECK is the other: the paper form labels the box only "Pourcentage (%)"
// and a member who gives 5000 FCFA writes 5000.
const INT_MAX = 2147483647;
const RANGES = {
  trimester_number: [0, 4],
  month_from: [1, 12],
  month_to: [1, 12],
  giving_percentage: [0, 100],
  // NUMERIC(14,2): twelve digits before the decimal point.
  savings_amount: [0, 999999999999.99],
  debt_amount: [0, 999999999999.99],
  debt_reimbursed: [0, 999999999999.99]
};
for (const column of INTEGERS) if (!RANGES[column]) RANGES[column] = [0, INT_MAX];

// Free-text columns the schema pins to a fixed vocabulary. The form uses a
// dropdown, so these should never fail — but "should never" is what the
// giving percentage looked like too, and an unexpected value here is the
// same silent 500.
const ENUMS = {
  entry_type: ['goal', 'result'],
  acct_frequency: ['day', 'week', 'month']
};

// Returns the first problem found, or null. Shape is deliberately small and
// serialisable: the client needs the field name to focus the right input and
// the bounds to tell the member what to type instead.
export function validateRow(row) {
  for (const [column, [min, max]] of Object.entries(RANGES)) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    if (value < min || value > max) {
      return { field: column, reason: 'out_of_range', min, max, received: value };
    }
  }
  for (const [column, allowed] of Object.entries(ENUMS)) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    if (!allowed.includes(value)) {
      return { field: column, reason: 'not_allowed', allowed, received: value };
    }
  }
  return null;
}

// Last line of defence. If a constraint still fires — because the schema
// moved and this file did not — recover the column from the constraint name
// so the member is told which line to fix instead of being handed a blank
// "something went wrong on our side".
export function fieldFromDbError(err) {
  const name = err?.constraint_name || err?.constraint || '';
  const match = /^accountability_returns_(.+?)_check$/.exec(name);
  if (match && COLUMNS.includes(match[1])) return match[1];
  if (err?.column_name && COLUMNS.includes(err.column_name)) return err.column_name;
  return null;
}

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
  if (raw === '' || raw === undefined || raw === null) {
    // 0 means "not specified" — a real, comparable value rather than null,
    // so two blank-trimester submissions from the same person still trip
    // the duplicate check instead of silently skipping it.
    return column === 'trimester_number' ? 0 : null;
  }
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
  if (!['goal', 'result'].includes(row.entry_type)) row.entry_type = 'result';
  return row;
}

// Digits only, so "+237 600 000 001" and "237-600-000-001" match as the same
// phone. The form always sends an explicit country code (the submitter
// picks it from a dropdown), so this only needs to normalise formatting —
// it must not guess a country code for a bare local number, since the same
// local-number length means something different in every country and this
// form is used by submitters from many countries.
export function normPhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2); // "00237..." dialing prefix
  return digits;
}

// Case/whitespace-insensitive, so retyping a name slightly differently
// between trimesters still counts as the same name.
export const normName = raw => String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
