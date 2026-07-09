# Prio · your day, in colour

An animated, mobile-friendly to-do app with accounts, custom colour priorities, and a calendar. Built with plain HTML/CSS/JavaScript + Supabase, ready to deploy on Vercel.

## What's inside

- **Sign up / log in** with email + password, including a SHOW/HIDE password button
- **Tasks** with title, notes, priority, and due date — add, edit, tick off, delete
- **Colour lab** — the classic green/yellow/red comes built in, but you can rename any label, change its colour with a colour picker, or create brand-new ones
- **Calendar** — every task with a due date shows as a coloured dot; tap a day to see or add tasks
- **Profile** — change your display name, email, or password, and log out
- Fully responsive with a bottom nav bar on phones, and animations everywhere (that respect reduced-motion settings)

## Setup (about 10 minutes)

### 1. Supabase

1. Go to [supabase.com](https://supabase.com) → New project (free tier is fine).
2. Once it's created, open **SQL Editor → New query**, paste the whole contents of `supabase/schema.sql`, and hit **Run**. This creates the `profiles`, `priorities`, and `tasks` tables with Row Level Security so each user only ever sees their own data.
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
prio/
├── index.html          ← login / sign up page
├── app.html            ← the app (tasks, calendar, colours, profile)
├── css/style.css       ← all styling + animations
├── js/config.js        ← paste your Supabase keys here
├── js/auth.js          ← auth page logic
├── js/app.js           ← app logic
└── supabase/schema.sql ← run once in Supabase SQL Editor
```

## Ideas for v2

- Drag-and-drop reordering
- Recurring tasks
- Dark mode
- Push/email reminders (Supabase Edge Functions)
