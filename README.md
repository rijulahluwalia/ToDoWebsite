# Rooted · grow a well-rooted life

An animated, mobile-friendly life management app with accounts, a dashboard, planner, projects, routines, and a calendar. Built with plain HTML/CSS/JavaScript + Supabase, ready to deploy on Vercel.

## What's inside

- **Dashboard** — quote of the day, habit streaks, today's red/yellow priorities, productivity score (with green-task bonus above 100%), today's wins, weather
- **Planner** — Daily / Weekly / Monthly / Half-Yearly / Yearly tabs + an autosaving Brain Dump
- **Projects (Phase 2)** — unlimited projects, each with autosaving notes, nested sections, and items with links, notes, and deadlines. Progress % updates live; the nearest deadline shows on each project card
- **Routines (Phase 2)** — build master routines (steps with optional times) scheduled on chosen weekdays. On their days they auto-populate the Daily planner as a fresh per-day copy — check off, rename, add, or remove steps for *today only*; the master never changes
- **Tasks** with title, notes, priority, and due date — add, edit, tick off, delete
- **Colour lab** — the classic green/yellow/red comes built in, but you can rename any label, change its colour with a colour picker, or create brand-new ones
- **Calendar** — every task with a due date shows as a coloured dot; tap a day to see or add tasks
- **Profile** — change your display name, email, or password, and log out
- Fully responsive with a bottom nav bar on phones, and animations everywhere (that respect reduced-motion settings)

## Setup (about 10 minutes)

### 1. Supabase

1. Go to [supabase.com](https://supabase.com) → New project (free tier is fine).
2. Once it's created, open **SQL Editor → New query** and run these three files in order (each once): `schema.sql`, then `schema-update.sql`, then `schema-update-2.sql`. Together they create the `profiles`, `priorities`, `tasks`, `habits`, `brain_dump`, `projects`, and `routines` tables (and friends), all with Row Level Security so each user only ever sees their own data. If your project already has the first two from earlier phases, just run `schema-update-2.sql`.
3. Go to **Settings → API** and copy:
   - Project URL
   - `anon` `public` key
4. Open `js/config.js` and paste both values in. (The anon key is designed to be public — RLS is what protects the data.)

**Optional but recommended while testing:** In **Authentication → Providers → Email**, turn OFF "Confirm email" so you can sign up and log in instantly. Turn it back on before sharing the site with others.

### 2. GitHub

```bash
cd prio
git init
git add .
git commit -m "Prio v1"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/prio.git
git push -u origin main
```

### 3. Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import your `prio` repo.
2. Framework preset: **Other**. No build command, no output directory — it's a static site. Just hit **Deploy**.
3. Done. Every `git push` redeploys automatically.

**Last step:** In Supabase → **Authentication → URL Configuration**, set the Site URL to your Vercel URL (e.g. `https://prio.vercel.app`) so email confirmation links point to the right place.

## File map

```
rooted/
├── index.html            ← login / sign up page
├── app.html              ← the app (dashboard, planner, projects, routines, calendar, colours, profile)
├── style.css             ← all styling + animations
├── config.js             ← paste your Supabase keys here
├── auth.js               ← auth page logic
├── app.js                ← app logic
├── schema.sql            ← run once (base tables)
├── schema-update.sql     ← run once (Phase 1: habits, brain dump, task scopes)
└── schema-update-2.sql   ← run once (Phase 2: projects + routines)
```

## Roadmap

- **Phase 3:** University (notes + results/WAM) + Knowledge (nested folders)
- **Phase 4:** Achievements & trophies, theme customisation + dark mode, reminders, Sunday review
- Also on the list: drag-and-drop reordering, workout of the day, cycle tracker
