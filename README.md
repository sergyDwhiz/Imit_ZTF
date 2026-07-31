# CMFI Trimestral Accountability Form

Bilingual single page form (English / French) for the Foundation Camp 2026
trimestral accountability. Static front end plus a Netlify serverless function
writing to PostgreSQL.

```
public/index.html            the whole site, one file
netlify/functions/
  returns.mjs                POST + GET /api/returns
  migrate.mjs                GET /api/migrate?token=...
  health.mjs                 GET /api/health
  _db.mjs                    connection, column list, type coercion
  schema.sql                 table, indexes, summary view (single source of truth)
netlify.toml                 publish dir, function dir, headers
```

## 1. Get a database

Netlify does not host PostgreSQL, so pick a provider with a free tier.
Neon (neon.tech) and Supabase both work. Create a database and copy the
**pooled** connection string, not the direct one. Serverless functions open a
new connection on every cold start and a direct connection will run out.

## 2. Deploy

Push this folder to GitHub, then in Netlify: Add new site, Import an existing
project, pick the repo. Netlify reads `netlify.toml`, so leave the build
settings alone.

Under Site configuration, Environment variables, add:

| Key             | Value                                             |
|-----------------|---------------------------------------------------|
| `DATABASE_URL`  | your pooled PostgreSQL connection string          |
| `MIGRATE_TOKEN` | any long random string you invent                 |

Deploy. The site is live.

## 3. Create the table, once

Open `https://YOUR-SITE.netlify.app/api/migrate?token=YOUR_MIGRATE_TOKEN`
in a browser. It returns `{"status":"schema_ready"}`. Running it again is
harmless, everything is `IF NOT EXISTS`.

Check `https://YOUR-SITE.netlify.app/api/health` to confirm the database
is reachable.

## 4. Local development

```bash
npm install
npm install -g netlify-cli
netlify env:pull            # or set DATABASE_URL in a .env file
netlify dev
```

`netlify dev` serves `public/` and the functions together on
http://localhost:8888, with the same `/api/...` paths as production.

Against a local PostgreSQL without SSL, add `PGSSL=false` to `.env`.

## Endpoints

| Method | Path           | Purpose                            |
|--------|----------------|------------------------------------|
| POST   | `/api/returns` | Save a completed form              |
| GET    | `/api/returns` | Summary list, newest first         |
| GET    | `/api/health`  | Database reachability              |
| GET    | `/api/migrate` | Create the schema, token required  |

## Notes

Drafts save to the browser as you type, so a dropped connection in the middle
of entry 14 does not cost the whole form. The draft clears once a submission
succeeds.

Every label lives in the `I18N` object near the bottom of `public/index.html`.
Adding a third language means adding one key there and one button in the top
bar. The language used is stored on each row in `form_language`.

Export for the province secretary:

```sql
\copy (SELECT * FROM accountability_summary ORDER BY submitted_at) TO 'returns.csv' CSV HEADER;
```

`GET /api/returns` is open. If the returns should not be public, put Netlify
Identity or a shared token in front of it before you share the URL.
