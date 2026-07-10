# Prio · your day, in colour

An animated, mobile-friendly life management app with accounts, a dashboard, planner, projects, routines, and a calendar. Built with plain HTML/CSS/JavaScript + Supabase, ready to deploy on Vercel.

## What's inside

- **Dashboard** — quote of the day, habit streaks, today's red/yellow priorities, productivity score (with green-task bonus above 100%), today's wins, weather
- **Planner** — Daily / Weekly / Monthly / Half-Yearly / Yearly tabs + an autosaving Brain Dump
- **Projects (Phase 2)** — unlimited projects, each with autosaving notes, nested sections, and items with links, notes, and deadlines. Progress % updates live; the nearest deadline shows on each project card
- **Routines (Phase 2)** — build master routines (steps with optional times) scheduled on chosen weekdays. On their days they auto-populate the Daily planner as a fresh per-day copy — check off, rename, add, or remove steps for *today only*; the master never changes
- **University (Phase 3 starter)** — subjects, class timetable, assessment list, due dates, weighting, group/individual type, and assessment breakdown steps with progress %.
- **Tasks** with title, notes, priority, and due date — add, edit, tick off, delete
- **Colour lab** — the classic green/yellow/red comes built in, but you can rename any label, change its colour with a colour picker, or create brand-new ones
- **Calendar** — every task with a due date shows as a coloured dot; tap a day to see or add tasks
- **Profile** — change your display name, email, or password, and log out
- Fully responsive with an animated mobile menu on phones, and animations everywhere (that respect reduced-motion settings)

## Setup (about 10 minutes)

### 1. Supabase

1. Go to [supabase.com](https://supabase.com) → New project (free tier is fine).
2. Once it's created, open **SQL Editor → New query** and run these three files in order (each once): `schema.sql`, then `schema-update.sql`, then `schema-update-2.sql`, then `schema-update-3.sql`. Together they create the `profiles`, `priorities`, `tasks`, `habits`, `brain_dump`, `projects`, and `routines` tables (and friends), all with Row Level Security so each user only ever sees their own data. If your project already has the first two from earlier phases, just run `schema-update-2.sql`, then run `schema-update-3.sql`.
3. Go to **Settings → API** and copy:
   - Project URL
   - `anon` `public` key
4. Open `js/config.js` and paste both values in. (The anon key is designed to be public — RLS is what protects the data.)

**Required for instant sign-up/login:** In **Authentication → Providers → Email**, turn OFF **Confirm email** so new users can sign up and enter Prio immediately.

If you created a test user while Confirm email was ON, that user may stay stuck as unconfirmed. In Supabase, go to **Authentication → Users** and either:
- delete the test user and sign up again, or
- manually confirm the user.

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
prio/
├── index.html            ← login / sign up page
├── app.html              ← the app (dashboard, planner, projects, routines, calendar, colours, profile)
├── style.css             ← all styling + animations
├── config.js             ← paste your Supabase keys here
├── auth.js               ← auth page logic
├── app.js                ← app logic
├── schema.sql            ← run once (base tables)
├── schema-update.sql     ← run once (Phase 1: habits, brain dump, task scopes)
└── schema-update-2.sql   ← run once (Phase 2: projects + routines)
schema-update-3.sql   ← run once (Phase 3 starter: university)
```

## Polish & personalisation

This version adds the Prio command centre: earned achievement badges, an upcoming reminder hub, a Sunday review modal, and a theme studio with light/dark mode plus accent colours.

## Roadmap

- **Phase 3:** University starter is included; next expansion is notes, results/WAM, and Knowledge nested folders
- **Polish & personalisation:** Achievements & trophies, theme customisation + dark mode, reminder hub, Sunday review
- Also on the list: drag-and-drop reordering, workout of the day, cycle tracker


## Prio v1.0 Stability Update

This build uses the last stable Prio base and applies a consistency pass only. It fixes Uni due-date badges, dark-mode surface leaks, compact reminder badges, assessment empty states, modal/dropdown contrast, and keeps the updated planner/date/filter UI intact.


## V1.1 add-on

- Semester calendar sync: Uni timetable classes now appear on the Calendar between your semester start/end dates.
- Semester breaks: add multiple break periods so classes pause during mid-semester breaks.
- Uni assessments appear on the Calendar on their due dates.


## Tour root fix

Fixed the mobile onboarding spotlight so the filter highlight is recalculated from the live DOM element on every Next/Back step, without reusing an expanded rectangle. Also fixed the mobile + button tour card so it docks above the button instead of covering it.
