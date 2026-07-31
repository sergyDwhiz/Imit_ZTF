# Imitators of ZTF — Accountability Form

Bilingual (English / French) trimestral accountability form for Foundation
Camp 2026. Static front end, a few Netlify serverless functions, PostgreSQL.

**Live:** https://imitators-of-ztf-accountability-form.netlify.app

```
public/index.html            the whole site, one file
netlify/functions/
  returns.mjs                POST + GET /api/returns
  migrate.mjs                GET /api/migrate?token=...     (create/update schema)
  export.mjs                 GET /api/export?token=...      (full CSV of every field)
  health.mjs                 GET /api/health
  _db.mjs                    connection, column list, type coercion, phone/name normalising
  schema.sql                 tables, indexes, summary view — single source of truth
netlify.toml                 publish dir, function dir, headers
```

## How a submission gets matched to a person

There's no login. A submission is linked to an existing person by **phone
number** (normalised to digits, country code required — the form has a
country-code dropdown so a bare local number is never guessed at). If a
phone number already has more than one name on record (e.g. siblings on a
shared phone), the submitter is asked which one is them before saving. A
second submission for a trimester that person already has on file is
flagged too, so a resend isn't a silent duplicate.

## Endpoints

| Method | Path           | Purpose                                  |
|--------|----------------|-------------------------------------------|
| POST   | `/api/returns` | Save a completed form                    |
| GET    | `/api/returns` | Summary list, newest first — open, no token |
| GET    | `/api/health`  | Database reachability                    |
| GET    | `/api/migrate` | Create/update the schema, token required |
| GET    | `/api/export`  | Full CSV, every field, token required — hand this URL to whoever needs the raw data |

## Local development

```bash
npm install
npm install -g netlify-cli
netlify link                # links this folder to the Netlify site
netlify env:pull             # pulls DATABASE_URL / MIGRATE_TOKEN locally
netlify dev
```

Serves `public/` and the functions together on http://localhost:8888 with
the same `/api/...` paths as production. Against a local PostgreSQL without
SSL, add `PGSSL=false` to `.env`.

## Redeploying elsewhere

Pick a Postgres provider (Neon or Supabase), copy the **pooled** connection
string (not direct — functions open a new connection per cold start). In
Netlify: set `DATABASE_URL` and `MIGRATE_TOKEN` as environment variables,
deploy, then open `/api/migrate?token=...` once to create the schema.

## Notes

Drafts autosave to the browser as you type, so a dropped connection doesn't
cost the whole form. The draft clears once a submission succeeds.

Every label lives in the `I18N` object near the bottom of `public/index.html`.
Adding a third language means one key there plus one button in the top bar.

`GET /api/returns` is open to anyone with the URL and exposes the trimmed
summary (names, phone numbers, a handful of numeric fields) — not the full
export. If that shouldn't be public, put a token or auth in front of it.
