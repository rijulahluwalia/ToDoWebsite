// ============================================
// PRIO · Supabase connection
// 1. Go to your Supabase project → Settings → API
// 2. Copy "Project URL" and the "anon public" key
// 3. Paste them below (the anon key is safe to ship
//    in the browser because Row Level Security is on)
// ============================================

const SUPABASE_URL = "https://uzbguavvdzxpqvjpjuex.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6Ymd1YXZ2ZHp4cHF2anBqdWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMDYxOTMsImV4cCI6MjA5ODg4MjE5M30.Im2R93vLQnkBnhK-DAOdLFMr1wPtg5bvnTjafgX9Njs";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
