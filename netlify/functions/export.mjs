import sql, { json } from './_db.mjs';

// Every raw field, unlike GET /api/returns which only exposes the trimmed
// accountability_summary view. Same admin token as /api/migrate — opening
// this URL in a browser downloads a CSV, no database client needed.
//
// Column headers are the actual form question wording, not the database's
// internal short names — this is what someone reads or prints, not a
// database dump. id and person_id are internal row-linking plumbing with
// no meaning to a reader, so they're left out entirely; a row is already
// identified by name, trimester, entry type and date.
const EXPORT_FIELDS = [
  ['submitted_at', 'Date Submitted'],
  ['entry_type', 'Goal or Result'],
  ['full_name', 'Name'],
  ['phone', 'Phone'],
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

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!process.env.MIGRATE_TOKEN || token !== process.env.MIGRATE_TOKEN) {
    return json({ error: 'forbidden' }, 403);
  }
  try {
    const rows = await sql`SELECT * FROM accountability_returns ORDER BY submitted_at`;
    const lines = [EXPORT_FIELDS.map(([, label]) => csvEscape(label)).join(',')];
    for (const r of rows) lines.push(EXPORT_FIELDS.map(([col]) => csvEscape(r[col])).join(','));
    const date = new Date().toISOString().slice(0, 10);
    return new Response(lines.join('\r\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="imitators-of-ztf-accountability-export-${date}.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    console.error('Export failed:', err.message);
    return json({ error: 'export_failed' }, 500);
  }
};

export const config = { path: '/api/export' };
