// ============================================
// PRIO · Supabase connection
// 1. Go to your Supabase project → Settings → API
// 2. Copy "Project URL" and the "anon public" key
// 3. Paste them below (the anon key is safe to ship
//    in the browser because Row Level Security is on)
// ============================================

const SUPABASE_URL = "https://uzbguavvdzxpqvjpjuex.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtpc2hhbnBteWhjbGpmbG5vdHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NDIxMzEsImV4cCI6MjA5OTExODEzMX0.KiI05oFiNunEAFpXGMACP5xkuhr5flVlnJzN5W1hfkY";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
