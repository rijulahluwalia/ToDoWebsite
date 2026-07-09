// ============================================
// PRIO · Supabase connection
// 1. Go to your Supabase project → Settings → API
// 2. Copy "Project URL" and the "anon public" key
// 3. Paste them below (the anon key is safe to ship
//    in the browser because Row Level Security is on)
// ============================================

const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_ANON_KEY_HERE";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
