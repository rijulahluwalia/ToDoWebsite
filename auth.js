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

// IMPORTANT:
// Keep the UI controls wired even if config.js / Supabase is missing.
// Without this guard, one missing config value makes every login-page button feel dead.
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

  const email = emailInput.value.trim();
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
        options: { data: { display_name: displayNameInput.value.trim() } },
      });
      if (error) throw error;

      // If email confirmation is ON in Supabase, there's no session yet.
      if (!data.session) {
        showMsg("Account created! Check your inbox to confirm your email, then log in.", "ok");
      } else {
        sessionStorage.setItem("showSplash", "1");
        window.location.href = "app.html";
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      sessionStorage.setItem("showSplash", "1");
      window.location.href = "app.html";
    }
  } catch (err) {
    const friendly = {
      "Invalid login credentials": "That email and password don't match. Try again?",
      "User already registered": "You already have an account with this email. Log in instead.",
    };
    showMsg(friendly[err.message] || err.message || "Something went wrong. Try again.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = mode === "signup" ? "Create account" : "Log in";
  }
}

// Wire buttons first, before any Supabase call.
tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));
togglePw.addEventListener("click", togglePassword);
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
