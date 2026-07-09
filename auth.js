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

let mode = "login"; // or "signup"

// Already logged in? Straight to the app.
db.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = "app.html";
});

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
tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));

// ---------- show / hide password ----------
const togglePw = document.getElementById("togglePw");
togglePw.addEventListener("click", () => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  togglePw.textContent = showing ? "SHOW" : "HIDE";
  togglePw.classList.toggle("on", !showing);
});

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

// ---------- submit ----------
async function handleSubmit() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) return showMsg("Please fill in your email and password.", "error");
  if (password.length < 6) return showMsg("Password needs to be at least 6 characters.", "error");
  if (mode === "signup" && !displayNameInput.value.trim())
    return showMsg("Tell us your name so we can greet you properly.", "error");

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
        window.location.href = "app.html";
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = "app.html";
    }
  } catch (err) {
    const friendly = {
      "Invalid login credentials": "That email and password don't match. Try again?",
      "User already registered": "You already have an account with this email. Log in instead.",
    };
    showMsg(friendly[err.message] || err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = mode === "signup" ? "Create account" : "Log in";
  }
}

submitBtn.addEventListener("click", handleSubmit);
[emailInput, passwordInput, displayNameInput].forEach((el) =>
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSubmit(); })
);
