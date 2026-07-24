// ============================================
// PRIO · auth page logic
// ============================================

const tabSwitch = document.getElementById("tabSwitch");
const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const nameField = document.getElementById("nameField");
const authTitle = document.getElementById("authTitle");
const authSub = document.getElementById("authSub");
const submitBtn = document.getElementById("submitBtn");
const authMsg = document.getElementById("authMsg");
const authCard = document.getElementById("authCard");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const displayNameInput = document.getElementById("displayName");
const togglePw = document.getElementById("togglePw");

let mode = "login"; // or "signup"

const hasSupabase = typeof db !== "undefined" && db?.auth;

// ---------- messages ----------
function showMsg(text, type) {
  authMsg.textContent = text;
  authMsg.className = "auth-msg " + type;
  if (type === "error") {
    authCard.classList.remove("shake");
    void authCard.offsetWidth; // restart animation
    authCard.classList.add("shake");
  }
}

function hideMsg() { authMsg.className = "auth-msg"; }

function friendlyAuthError(message = "") {
  const msg = String(message);

  if (msg.toLowerCase().includes("email not confirmed")) {
    return "This account exists but email confirmation is still on in Supabase. Turn OFF Authentication → Providers → Email → Confirm email, then delete/recreate this test user or manually confirm them in Supabase.";
  }

  const friendly = {
    "Invalid login credentials": "That email and password don't match. If you just signed up, check Supabase has Confirm email turned OFF.",
    "User already registered": "You already have an account with this email. Try logging in instead.",
  };

  return friendly[msg] || msg || "Something went wrong. Try again.";
}

// ---------- tab switching ----------
function setMode(next) {
  mode = next;
  const signup = mode === "signup";
  tabSwitch.classList.toggle("signup", signup);
  tabLogin.classList.toggle("active", !signup);
  tabSignup.classList.toggle("active", signup);
  nameField.style.display = signup ? "block" : "none";
  authTitle.textContent = signup ? "Create your space" : "Welcome back";
  authSub.textContent = signup
    ? "One account, all your tasks, in your colours."
    : "Log in to pick up where you left off.";
  submitBtn.textContent = signup ? "Create account" : "Log in";
  passwordInput.autocomplete = signup ? "new-password" : "current-password";
  const gLabel = document.getElementById("googleAuthLabel");
  if (gLabel) gLabel.textContent = signup ? "Sign up with Google" : "Continue with Google";
  hideMsg();
}

// ---------- show / hide password ----------
function togglePassword() {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  togglePw.textContent = showing ? "SHOW" : "HIDE";
  togglePw.classList.toggle("on", !showing);
}

// ---------- submit ----------
async function handleSubmit() {
  if (!hasSupabase) {
    return showMsg(
      "Supabase config is missing. Keep your config.js file in the project with your Project URL and anon key.",
      "error"
    );
  }

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!email || !password) return showMsg("Please fill in your email and password.", "error");
  if (password.length < 6) return showMsg("Password needs to be at least 6 characters.", "error");
  if (mode === "signup" && !displayNameInput.value.trim()) {
    return showMsg("Tell us your name so we can greet you properly.", "error");
  }

  submitBtn.disabled = true;
  submitBtn.textContent = mode === "signup" ? "Creating…" : "Logging in…";

  try {
    if (mode === "signup") {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayNameInput.value.trim() },
          emailRedirectTo: `${window.location.origin}/app.html`,
        },
      });
      if (error) throw error;

      // If Supabase email confirmation is OFF, a session is returned and we can enter immediately.
      if (data?.session) {
        sessionStorage.setItem("showSplash", "1");
        window.location.href = "app.html";
        return;
      }

      // If we get here, Supabase email confirmation is still ON.
      showMsg(
        "Account created, but Supabase email confirmation is still ON. To log users in straight away: Supabase → Authentication → Providers → Email → turn OFF Confirm email. Then delete/recreate this test user or manually confirm them.",
        "error"
      );
      return;
    }

    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;

    sessionStorage.setItem("showSplash", "1");
    window.location.href = "app.html";
  } catch (err) {
    showMsg(friendlyAuthError(err.message), "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = mode === "signup" ? "Create account" : "Log in";
  }
}

// ---------- sign in with Google ----------
// Deliberately requests NO calendar scope. Signing in only needs identity;
// calendar access is a separate opt-in inside the app, so new users aren't
// asked to hand over their calendar before they've even seen Prio.
async function handleGoogleAuth() {
  if (!hasSupabase) {
    return showMsg("Supabase config is missing. Add/restore config.js, then redeploy.", "error");
  }
  const btn = document.getElementById("googleAuthBtn");
  const label = document.getElementById("googleAuthLabel");
  btn.disabled = true;
  if (label) label.textContent = "Opening Google…";

  try {
    sessionStorage.setItem("showSplash", "1");
    const { error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/app.html" },
    });
    if (error) throw error;
    // browser redirects to Google from here
  } catch (err) {
    sessionStorage.removeItem("showSplash");
    showMsg(err.message || "Couldn't open Google sign-in. Try again.", "error");
    btn.disabled = false;
    if (label) label.textContent = "Continue with Google";
  }
}

// Wire buttons first, before any Supabase call.
tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));
togglePw.addEventListener("click", togglePassword);
document.getElementById("googleAuthBtn")?.addEventListener("click", handleGoogleAuth);
submitBtn.addEventListener("click", handleSubmit);
[emailInput, passwordInput, displayNameInput].forEach((el) => {
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSubmit(); });
});

// Already logged in? Straight to the app. Do this after UI is wired.
if (hasSupabase) {
  db.auth.getSession().then(({ data }) => {
    if (data.session) window.location.href = "app.html";
  }).catch(() => {
    showMsg("Couldn’t connect to Supabase. Check your config.js values.", "error");
  });
} else {
  showMsg("Supabase config is missing. Add/restore config.js, then redeploy.", "error");
}
