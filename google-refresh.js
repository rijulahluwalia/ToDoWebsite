// ============================================
// PRIO · Google token refresh (Vercel serverless)
//
// Why this exists: Google access tokens die after ~1 hour. Swapping a
// refresh token for a new one requires the Google CLIENT SECRET, which
// must never appear in browser code — anyone could read it and
// impersonate Prio. So the exchange happens here, server-side.
//
// Required environment variables in Vercel → Settings → Environment Variables:
//   GOOGLE_CLIENT_ID           → from Google Cloud → Credentials
//   GOOGLE_CLIENT_SECRET       → same place (KEEP SECRET)
//   SUPABASE_URL               → same URL as in config.js
//   SUPABASE_SERVICE_ROLE_KEY  → Supabase → Settings → API → service_role (KEEP SECRET)
// ============================================

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in Vercel." });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in Vercel." });
  }

  // ---- 1. Verify the caller is a real, logged-in Prio user ----
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not logged in" });

  const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY },
  });
  const caller = await whoRes.json();
  if (!whoRes.ok || !caller?.id) {
    return res.status(401).json({ error: "Invalid session — log in again." });
  }
  const userId = caller.id;

  const H = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // ---- 2. Look up THIS user's refresh token ----
    // The user id comes from the verified session above, never from the
    // request body, so one user can't fetch another's token.
    const rowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/google_tokens?user_id=eq.${userId}&select=refresh_token`,
      { headers: H }
    );
    const rows = await rowRes.json();
    const refreshToken = rows?.[0]?.refresh_token;

    if (!refreshToken) {
      return res.status(404).json({ error: "NO_REFRESH_TOKEN" });
    }

    // ---- 3. Swap it for a fresh access token ----
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const googleRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const tokens = await googleRes.json();

    if (!googleRes.ok) {
      // invalid_grant = user revoked access, or the token was rotated away
      const revoked = tokens.error === "invalid_grant";
      if (revoked) {
        await fetch(`${SUPABASE_URL}/rest/v1/google_tokens?user_id=eq.${userId}`, {
          method: "DELETE", headers: H,
        });
      }
      return res.status(revoked ? 410 : 500).json({
        error: revoked ? "REVOKED" : (tokens.error_description || "Google refused the refresh"),
      });
    }

    // ---- 4. Record when we last refreshed (useful for debugging) ----
    await fetch(`${SUPABASE_URL}/rest/v1/google_tokens?user_id=eq.${userId}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ last_refreshed_at: new Date().toISOString() }),
    });

    return res.status(200).json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in || 3600,
    });
  } catch (err) {
    return res.status(500).json({ error: "Token refresh failed." });
  }
}
