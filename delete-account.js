// ============================================
// PRIO · Delete account (Vercel serverless)
//
// Deleting an auth user requires the Supabase service role key, which
// bypasses Row Level Security — so it can only ever live server-side.
//
// Safety design:
//  * The user id comes from the VERIFIED session, never the request body,
//    so nobody can delete someone else's account by editing the request.
//  * The caller must re-type their own email as confirmation.
//  * Everything else cascades: schema.sql uses ON DELETE CASCADE on every
//    table keyed to auth.users, so removing the user wipes their data.
//
// Uses the same environment variables as api/google-refresh.js:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in Vercel." });
  }

  // ---- 1. Verify the caller ----
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not logged in" });

  const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY },
  });
  const caller = await whoRes.json();
  if (!whoRes.ok || !caller?.id) {
    return res.status(401).json({ error: "Invalid session — log in again." });
  }

  // ---- 2. Confirmation must match the caller's own email ----
  const { confirm_email } = req.body || {};
  if (!confirm_email || String(confirm_email).trim().toLowerCase() !== String(caller.email).toLowerCase()) {
    return res.status(400).json({ error: "EMAIL_MISMATCH" });
  }

  const userId = caller.id;
  const H = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // ---- 3. Clean up rows that aren't cascade-linked to auth.users ----
    // Invites this person received point at OTHER people's events, so they
    // aren't removed by the cascade on their own user row.
    await fetch(`${SUPABASE_URL}/rest/v1/event_invites?invitee_id=eq.${userId}`, {
      method: "DELETE", headers: H,
    }).catch(() => {});

    // ---- 4. Delete the auth user; everything keyed to it cascades ----
    const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE", headers: H,
    });

    if (!delRes.ok) {
      let detail = "";
      try { detail = (await delRes.json())?.msg || ""; } catch {}
      return res.status(500).json({ error: detail || "Couldn't delete the account." });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Account deletion failed." });
  }
}
