# Fantasy Triathlon

Mobile-friendly fantasy triathlon scoring app for the Deer Creek Olympic-distance race
(**Saturday, August 8, 2026** · New Holland, Ohio).

Shared race data syncs via **Supabase** so spectators at
[gdjenks13.github.io/FantasyTriathlon](https://gdjenks13.github.io/FantasyTriathlon/)
see the same predictions and results. The race editor logs in to publish changes.

## Tabs

1. **Predict** — enter fantasy predictions (editor only)
2. **Pool** — everyone’s predicted orders + statistics
3. **Race** — fantasy standings, official results, cloud login/publish
4. **Info** — race details and scoring rules

## Supabase setup (one-time)

### 1. Create the table + policies

In [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**,
paste and run everything in [`supabase/schema.sql`](supabase/schema.sql).

### 2. Create an editor account

**Authentication** → **Users** → **Add user**:

- Email: something you’ll remember (e.g. your wife’s email)
- Password: a strong password she will use to log in
- Auto-confirm: **on** (so she can log in immediately)

Optional: **Authentication** → **Providers** → Email → disable new public signups
after the editor account exists.

### 3. Put the anon key in the app

Dashboard → **Project Settings** → **API**:

- Project URL is already in `config.js`
- Copy the **anon public** key into `config.js` → `supabaseAnonKey`

```js
window.FANTASY_CONFIG = {
  supabaseUrl: "https://ayicngoasguoqegxoptd.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  pollIntervalMs: 5000,
};
```

Or copy `config.local.js.example` → `config.local.js` (gitignored) and keep the key
out of commits if you prefer — for GitHub Pages the key must be available to the
browser either way. The **anon** key is public by design; security is RLS + Auth.

**Never put the database password or service_role key in the frontend.**

### 4. Enable Realtime (if the SQL publication step failed)

**Database** → **Publications** → `supabase_realtime` → enable `app_state`.

## How sync works

| Role | Behavior |
|------|----------|
| **Spectator** (not logged in) | Reads cloud state; auto-refresh via Realtime + 5s poll; cannot edit |
| **Editor** (logged in) | Full edit; every save also **publishes** to Supabase; manual **Publish to cloud** button |

Login is on the **Race** tab under **Shared cloud data**.

## Local files

- `index.html` / `styles.css` / `app.js` — UI and logic
- `config.js` — public Supabase URL + anon key
- `supabase/schema.sql` — database setup
- `.env` — local secrets only (gitignored); not used by the static site

## Run locally

Open `index.html` in a browser, or:

```bash
python -m http.server 8000
```

Visit http://localhost:8000/

## Manual backup

**Race** tab still has Export / Import JSON for offline backups.
