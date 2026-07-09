// ============================================
// PRIO · main app logic
// ============================================

let user = null;
let profile = null;
let priorities = [];
let tasks = [];
let activeFilter = "all";      // "all" | priority id | "done"
let editingTaskId = null;
let modalPriorityId = null;
let selectedDate = null;       // "YYYY-MM-DD" chosen in calendar
let calCursor = new Date();    // month shown in calendar
let habits = [];
let habitChecks = new Set();   // "habitId|YYYY-MM-DD"
let activeScope = "daily";     // planner tab
let editingHabitId = null;
let habitIcon = "⭐";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DEFAULT_PRIORITIES = [
  { name: "Low", color: "#2fbf71", position: 0 },
  { name: "Medium", color: "#f5a623", position: 1 },
  { name: "High", color: "#f0455a", position: 2 },
];
const PRESET_COLORS = ["#2fbf71", "#f5a623", "#f0455a", "#4353ff", "#8a63ff", "#ff6fae", "#18c2c2", "#171b36"];

// ---------- boot ----------
runSplash();
init();

function runSplash() {
  const splash = $("splash");
  if (sessionStorage.getItem("showSplash")) {
    sessionStorage.removeItem("showSplash");
    splash.classList.add("run");
    setTimeout(() => splash.remove(), 2800);
  } else {
    splash.remove();
  }
}

async function init() {
  const { data } = await db.auth.getSession();
  if (!data.session) { window.location.href = "index.html"; return; }
  user = data.session.user;

  await loadProfile();
  await loadPriorities();
  await loadTasks();
  await loadHabits();

  renderGreeting();
  renderQuote();
  renderAll();
  wireEvents();
  wireRootedEvents();
  loadWeather();
  loadDump();
}

async function loadProfile() {
  const { data } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  profile = data || { id: user.id, display_name: user.email.split("@")[0] };
  if (!data) await db.from("profiles").upsert(profile);
}

async function loadPriorities() {
  let { data } = await db.from("priorities").select("*").eq("user_id", user.id).order("position");
  if (!data || data.length === 0) {
    // First visit — seed the classic green / yellow / red
    const seed = DEFAULT_PRIORITIES.map((p) => ({ ...p, user_id: user.id }));
    const res = await db.from("priorities").insert(seed).select();
    data = res.data || [];
  }
  priorities = data;
}

async function loadTasks() {
  const { data } = await db.from("tasks").select("*").eq("user_id", user.id)
    .order("completed").order("created_at", { ascending: false });
  tasks = data || [];
}

// ---------- helpers ----------
function prioById(id) { return priorities.find((p) => p.id === id) || null; }
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2400);
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function niceDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function renderGreeting() {
  const hour = new Date().getHours();
  const word = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = profile.display_name || "there";
  $("greetName").textContent = `${word}, ${name}`;
  $("greetDate").textContent = new Date().toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long",
  });
  $("avatarBtn").textContent = name.charAt(0).toUpperCase();
}

function renderAll() {
  renderFilterChips();
  renderTasks();
  renderCalendar();
  renderPriorities();
  renderProfileForm();
  renderDashboard();
}

// ---------- navigation ----------
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view-" + name).classList.add("active");
  document.querySelectorAll("[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  $("fabBtn").style.display = (name === "home" || name === "tasks" || name === "calendar") ? "grid" : "none";
}

// ---------- filter chips ----------
function renderFilterChips() {
  const wrap = $("filterChips");
  const chips = [
    { id: "all", label: "All", color: null },
    ...priorities.map((p) => ({ id: p.id, label: p.name, color: p.color })),
    { id: "done", label: "Done ✓", color: null },
  ];
  wrap.innerHTML = chips.map((c) => `
    <button class="chip ${activeFilter === c.id ? "active" : ""}" data-filter="${c.id}">
      ${c.color ? `<span class="swatch" style="background:${c.color}"></span>` : ""}${esc(c.label)}
    </button>`).join("");
  wrap.querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { activeFilter = b.dataset.filter; renderFilterChips(); renderTasks(); }));
}

// ---------- tasks ----------
function taskHTML(t, i) {
  const p = prioById(t.priority_id);
  const color = p ? p.color : "#c3c8dd";
  return `
    <div class="task ${t.completed ? "done" : ""}" data-id="${t.id}"
         style="--task-color:${color}; animation-delay:${Math.min(i * 0.05, 0.4)}s">
      <button class="check" aria-label="Toggle done">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
      </button>
      <div class="task-body">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">
          ${p ? `<span class="pill">${esc(p.name)}</span>` : ""}
          ${t.due_date ? `<span>📅 ${niceDate(t.due_date)}</span>` : ""}
        </div>
        ${t.notes ? `<div class="task-notes">${esc(t.notes)}</div>` : ""}
      </div>
      <button class="icon-btn edit" aria-label="Edit task">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/></svg>
      </button>
      ${t.due_date ? `<button class="icon-btn gcal" title="Add to Google Calendar" aria-label="Add to Google Calendar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M12 14v4M10 16h4"/></svg>
      </button>` : ""}
      <button class="icon-btn del" aria-label="Delete task">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg>
      </button>
    </div>`;
}

function scopeTasks() {
  const today = todayStr();
  if (activeScope === "daily")
    return tasks.filter((t) => (t.scope || "daily") === "daily")
      .filter((t) => t.due_date === today || (!t.completed && t.due_date && t.due_date < today) || !t.due_date);
  return tasks.filter((t) => t.scope === activeScope);
}

function renderTasks() {
  const list = $("taskList");
  const pool = scopeTasks();
  let shown = pool;
  if (activeFilter === "done") shown = pool.filter((t) => t.completed);
  else if (activeFilter !== "all") shown = pool.filter((t) => t.priority_id === activeFilter && !t.completed);
  else shown = pool.filter((t) => !t.completed);

  if (shown.length === 0) {
    const msg = activeFilter === "done"
      ? { e: "🌱", t: "Nothing finished yet — small steps count." }
      : { e: "🎉", t: "All clear! Tap + to add your first task." };
    list.innerHTML = `<div class="empty"><span class="emoji">${msg.e}</span>${msg.t}</div>`;
    return;
  }
  list.innerHTML = shown.map(taskHTML).join("");
  wireTaskEvents(list);
}

function wireTaskEvents(scope) {
  scope.querySelectorAll(".task").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".check").addEventListener("click", () => toggleTask(id, el));
    el.querySelector(".del").addEventListener("click", () => removeTask(id, el));
    el.querySelector(".edit").addEventListener("click", () => openModal(id));
    const gcal = el.querySelector(".gcal");
    if (gcal) gcal.addEventListener("click", () => openGoogleCalendar(id));
    el.querySelector(".task-body").addEventListener("click", () => openModal(id));
  });
}

async function toggleTask(id, el) {
  const t = tasks.find((x) => x.id === id);
  t.completed = !t.completed;
  el.classList.toggle("done", t.completed);
  t.completed_at = t.completed ? new Date().toISOString() : null;
  const { error } = await db.from("tasks").update({ completed: t.completed, completed_at: t.completed_at }).eq("id", id);
  if (error) { t.completed = !t.completed; el.classList.toggle("done"); return toast("Couldn't save — try again"); }
  if (t.completed) toast("Nice one ✓");
  setTimeout(() => { renderTasks(); renderCalendar(); renderDashboard(); }, 500);
}

async function removeTask(id, el) {
  el.classList.add("leaving");
  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) { el.classList.remove("leaving"); return toast("Couldn't delete — try again"); }
  tasks = tasks.filter((t) => t.id !== id);
  setTimeout(() => { renderTasks(); renderCalendar(); renderDashboard(); }, 350);
  toast("Task removed");
}

// ---------- task modal ----------
function openModal(taskId = null, presetDate = null) {
  editingTaskId = taskId;
  const t = taskId ? tasks.find((x) => x.id === taskId) : null;
  $("modalTitle").textContent = t ? "Edit task" : "New task";
  $("taskTitle").value = t ? t.title : "";
  $("taskNotes").value = t ? t.notes || "" : "";
  $("taskDate").value = t ? t.due_date || "" : (presetDate || "");
  modalPriorityId = t ? t.priority_id : (priorities[0]?.id ?? null);
  renderPrioPick();
  $("taskModal").classList.add("open");
  setTimeout(() => $("taskTitle").focus(), 250);
}
function closeModal() { $("taskModal").classList.remove("open"); editingTaskId = null; }

function renderPrioPick() {
  $("prioPick").innerHTML = priorities.map((p) => `
    <button type="button" data-id="${p.id}" style="background:${p.color}"
      class="${modalPriorityId === p.id ? "active" : ""}">${esc(p.name)}</button>`).join("");
  $("prioPick").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { modalPriorityId = b.dataset.id; renderPrioPick(); }));
}

async function saveTask() {
  const title = $("taskTitle").value.trim();
  if (!title) return toast("Give your task a name first");
  const existing = editingTaskId ? tasks.find((x) => x.id === editingTaskId) : null;
  const payload = {
    title,
    notes: $("taskNotes").value.trim() || null,
    priority_id: modalPriorityId,
    due_date: $("taskDate").value || null,
    user_id: user.id,
    scope: existing ? existing.scope || "daily" : (activeScope === "dump" ? "daily" : activeScope),
  };
  const btn = $("modalSave");
  btn.disabled = true;
  let error;
  if (editingTaskId) {
    ({ error } = await db.from("tasks").update(payload).eq("id", editingTaskId));
  } else {
    ({ error } = await db.from("tasks").insert(payload));
  }
  btn.disabled = false;
  if (error) return toast("Couldn't save — try again");
  const wasEditing = !!editingTaskId;
  await loadTasks();
  renderTasks();
  renderCalendar();
  renderDashboard();
  closeModal();
  toast(wasEditing ? "Task updated" : "Task added ✨");
}

// ---------- calendar ----------
function renderCalendar() {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  $("calTitle").textContent = calCursor.toLocaleDateString("en-AU", { month: "long", year: "numeric" });

  const firstDow = new Date(y, m, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayStr();

  let html = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day blank"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayTasks = tasks.filter((t) => t.due_date === iso);
    const dots = dayTasks.slice(0, 4).map((t, i) => {
      const p = prioById(t.priority_id);
      return `<i style="background:${p ? p.color : "#c3c8dd"};animation-delay:${i * 0.06}s"></i>`;
    }).join("");
    const cls = ["cal-day", iso === today ? "today" : "", iso === selectedDate ? "selected" : ""].join(" ");
    html += `<button class="${cls}" data-date="${iso}"><span>${d}</span><span class="cal-dots">${dots}</span></button>`;
  }
  $("calGrid").innerHTML = html;
  $("calGrid").querySelectorAll(".cal-day:not(.blank)").forEach((b) =>
    b.addEventListener("click", () => {
      selectedDate = selectedDate === b.dataset.date ? null : b.dataset.date;
      renderCalendar();
    }));
  renderDayPanel();
}

function renderDayPanel() {
  const panel = $("dayPanel");
  if (!selectedDate) { panel.innerHTML = ""; return; }
  const dayTasks = tasks.filter((t) => t.due_date === selectedDate);
  const pretty = new Date(selectedDate + "T00:00").toLocaleDateString("en-AU",
    { weekday: "long", day: "numeric", month: "long" });
  panel.innerHTML = `
    <div class="section-head">
      <h3>${pretty}</h3>
      <button class="btn-ghost" id="addOnDay">+ Add task this day</button>
    </div>
    <div class="task-list">${dayTasks.length
      ? dayTasks.map(taskHTML).join("")
      : `<div class="empty"><span class="emoji">🗓️</span>Nothing planned — a rare free day!</div>`}</div>`;
  $("addOnDay").addEventListener("click", () => openModal(null, selectedDate));
  wireTaskEvents(panel);
}

// ---------- colour lab (priorities) ----------
function renderPriorities() {
  const wrap = $("prioList");
  wrap.innerHTML = priorities.map((p, i) => `
    <div class="prio-row" data-id="${p.id}" style="animation-delay:${i * 0.06}s">
      <span class="color-well" style="background:${p.color}">
        <input type="color" value="${p.color}" aria-label="Change colour" />
      </span>
      <input type="text" value="${esc(p.name)}" maxlength="24" aria-label="Priority name" />
      <button class="icon-btn del" aria-label="Delete priority">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg>
      </button>
    </div>`).join("");

  wrap.querySelectorAll(".prio-row").forEach((row) => {
    const id = row.dataset.id;
    const colorInput = row.querySelector("input[type=color]");
    const nameInput = row.querySelector("input[type=text]");

    colorInput.addEventListener("input", (e) => {
      row.querySelector(".color-well").style.background = e.target.value;
    });
    colorInput.addEventListener("change", async (e) => {
      await db.from("priorities").update({ color: e.target.value }).eq("id", id);
      const p = prioById(id); if (p) p.color = e.target.value;
      renderTasks(); renderCalendar(); renderFilterChips();
      toast("Colour updated 🎨");
    });
    nameInput.addEventListener("change", async (e) => {
      const name = e.target.value.trim();
      if (!name) { e.target.value = prioById(id).name; return; }
      await db.from("priorities").update({ name }).eq("id", id);
      const p = prioById(id); if (p) p.name = name;
      renderTasks(); renderFilterChips();
      toast("Renamed");
    });
    row.querySelector(".del").addEventListener("click", async () => {
      if (priorities.length === 1) return toast("Keep at least one priority");
      const inUse = tasks.filter((t) => t.priority_id === id).length;
      if (inUse && !confirm(`${inUse} task(s) use this label. They'll become uncoloured. Delete anyway?`)) return;
      await db.from("priorities").delete().eq("id", id);
      priorities = priorities.filter((p) => p.id !== id);
      tasks.forEach((t) => { if (t.priority_id === id) t.priority_id = null; });
      if (activeFilter === id) activeFilter = "all";
      renderAll();
      toast("Priority deleted");
    });
  });
}

async function addPriority() {
  const color = PRESET_COLORS[priorities.length % PRESET_COLORS.length];
  const { data, error } = await db.from("priorities")
    .insert({ user_id: user.id, name: "New label", color, position: priorities.length })
    .select().single();
  if (error) return toast("Couldn't create — try again");
  priorities.push(data);
  renderPriorities();
  renderFilterChips();
  // focus the new name field so it can be renamed straight away
  const rows = document.querySelectorAll(".prio-row");
  const last = rows[rows.length - 1];
  const input = last.querySelector("input[type=text]");
  input.focus(); input.select();
}

// ---------- profile ----------
function renderProfileForm() {
  $("profileName").value = profile.display_name || "";
  $("profileEmail").value = user.email || "";
}

async function saveName() {
  const name = $("profileName").value.trim();
  if (!name) return toast("Name can't be empty");
  const { error } = await db.from("profiles").update({ display_name: name }).eq("id", user.id);
  if (error) return toast("Couldn't save — try again");
  profile.display_name = name;
  renderGreeting();
  toast("Name updated");
}

async function saveEmail() {
  const email = $("profileEmail").value.trim();
  if (!email || email === user.email) return toast("Enter a new email first");
  const { error } = await db.auth.updateUser({ email });
  if (error) return toast(error.message);
  toast("Check both inboxes to confirm the change 📧");
}

async function savePassword() {
  const pw = $("profilePassword").value;
  if (pw.length < 6) return toast("Password needs at least 6 characters");
  const { error } = await db.auth.updateUser({ password: pw });
  if (error) return toast(error.message);
  $("profilePassword").value = "";
  toast("Password changed 🔒");
}

// ---------- events ----------
function wireEvents() {
  document.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view)));
  $("avatarBtn").addEventListener("click", () => switchView("profile"));

  $("fabBtn").addEventListener("click", () => {
    const inCalendar = $("view-calendar").classList.contains("active");
    openModal(null, inCalendar ? selectedDate : null);
  });
  $("modalCancel").addEventListener("click", closeModal);
  $("modalSave").addEventListener("click", saveTask);
  $("taskModal").addEventListener("click", (e) => { if (e.target.id === "taskModal") closeModal(); });
  $("taskTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") saveTask(); });

  $("calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
  $("calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
  $("calToday").addEventListener("click", () => { calCursor = new Date(); selectedDate = todayStr(); renderCalendar(); });

  $("addPrioBtn").addEventListener("click", addPriority);

  $("saveNameBtn").addEventListener("click", saveName);
  $("saveEmailBtn").addEventListener("click", saveEmail);
  $("savePasswordBtn").addEventListener("click", savePassword);

  const pwInput = $("profilePassword");
  $("profileTogglePw").addEventListener("click", (e) => {
    const showing = pwInput.type === "text";
    pwInput.type = showing ? "password" : "text";
    e.target.textContent = showing ? "SHOW" : "HIDE";
    e.target.classList.toggle("on", !showing);
  });

  $("logoutBtn").addEventListener("click", async () => {
    await db.auth.signOut();
    window.location.href = "index.html";
  });
}

// ============================================
// V2 · Weather (Open-Meteo, free, no API key)
// ============================================
const WEATHER_ICONS = [
  [0, "☀️", "Clear sky"], [1, "🌤️", "Mostly clear"], [2, "⛅", "Partly cloudy"], [3, "☁️", "Overcast"],
  [45, "🌫️", "Foggy"], [48, "🌫️", "Foggy"], [51, "🌦️", "Light drizzle"], [53, "🌦️", "Drizzle"],
  [55, "🌦️", "Heavy drizzle"], [61, "🌧️", "Light rain"], [63, "🌧️", "Rain"], [65, "🌧️", "Heavy rain"],
  [71, "❄️", "Light snow"], [73, "❄️", "Snow"], [75, "❄️", "Heavy snow"], [80, "🌧️", "Showers"],
  [81, "🌧️", "Showers"], [82, "⛈️", "Heavy showers"], [95, "⛈️", "Thunderstorm"], [96, "⛈️", "Storm + hail"], [99, "⛈️", "Storm + hail"],
];
function weatherLook(code) {
  let best = ["🌡️", "Weather"];
  for (const [c, icon, label] of WEATHER_ICONS) if (code >= c) best = [icon, label];
  return best;
}

function loadWeather() {
  const fallback = { lat: -33.87, lon: 151.21 }; // Sydney
  const go = (lat, lon) => fetchWeather(lat, lon);
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => go(pos.coords.latitude, pos.coords.longitude),
      () => go(fallback.lat, fallback.lon),
      { timeout: 4000 }
    );
  } else go(fallback.lat, fallback.lon);
}

async function fetchWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
    const res = await fetch(url);
    const w = await res.json();
    const [icon, label] = weatherLook(w.current.weather_code);
    $("weatherBox").innerHTML = `
      <span class="w-emoji">${icon}</span>
      <div>
        <div class="w-temp">${Math.round(w.current.temperature_2m)}°</div>
        <div class="w-desc">${label} · H ${Math.round(w.daily.temperature_2m_max[0])}° L ${Math.round(w.daily.temperature_2m_min[0])}°</div>
      </div>`;
  } catch {
    $("weatherBox").innerHTML = `<span class="w-emoji">🌤️</span><div><div class="w-desc">Weather unavailable right now</div></div>`;
  }
}

// ============================================
// V2 · Google Calendar (Google sends the reminders)
// ============================================
function openGoogleCalendar(taskId) {
  const t = tasks.find((x) => x.id === taskId);
  if (!t || !t.due_date) return;
  const start = t.due_date.replaceAll("-", "");
  const endDate = new Date(t.due_date + "T00:00");
  endDate.setDate(endDate.getDate() + 1);
  const end = `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, "0")}${String(endDate.getDate()).padStart(2, "0")}`;
  const p = prioById(t.priority_id);
  const details = [t.notes, p ? `Priority: ${p.name}` : "", "— added from Prio"].filter(Boolean).join("\n");
  const url = "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(t.title)}` +
    `&dates=${start}/${end}` +
    `&details=${encodeURIComponent(details)}`;
  window.open(url, "_blank");
  toast("Opening Google Calendar 📅");
}

// ============================================
// ROOTED · Quote of the day
// ============================================
const QUOTES = [
  ["We suffer more often in imagination than in reality.", "Seneca"],
  ["You have power over your mind, not outside events.", "Marcus Aurelius"],
  ["It is not that we have a short time to live, but that we waste much of it.", "Seneca"],
  ["We are what we repeatedly do. Excellence, then, is a habit.", "Will Durant"],
  ["Knowing yourself is the beginning of all wisdom.", "Aristotle"],
  ["The unexamined life is not worth living.", "Socrates"],
  ["It does not matter how slowly you go as long as you do not stop.", "Confucius"],
  ["A journey of a thousand miles begins with a single step.", "Lao Tzu"],
  ["He who conquers himself is the mightiest warrior.", "Confucius"],
  ["First say to yourself what you would be; then do what you have to do.", "Epictetus"],
  ["No man is free who is not master of himself.", "Epictetus"],
  ["Whether you think you can, or you think you can't — you're right.", "Henry Ford"],
  ["The best way to predict the future is to create it.", "Peter Drucker"],
  ["What gets measured gets managed.", "Peter Drucker"],
  ["Well done is better than well said.", "Benjamin Franklin"],
  ["An investment in knowledge pays the best interest.", "Benjamin Franklin"],
  ["Discipline is choosing between what you want now and what you want most.", "Abraham Lincoln (attributed)"],
  ["Do the hard jobs first. The easy jobs will take care of themselves.", "Dale Carnegie"],
  ["Action is the foundational key to all success.", "Pablo Picasso"],
  ["The mind is everything. What you think you become.", "Buddha (attributed)"],
  ["Between stimulus and response there is a space. In that space is our power to choose.", "Viktor Frankl (attributed)"],
  ["He who has a why to live can bear almost any how.", "Friedrich Nietzsche"],
  ["The greatest weapon against stress is our ability to choose one thought over another.", "William James"],
  ["Act as if what you do makes a difference. It does.", "William James"],
  ["Everything can be taken from a man but the last of the human freedoms.", "Viktor Frankl"],
  ["A leader is one who knows the way, goes the way, and shows the way.", "John C. Maxwell"],
  ["Leadership is the capacity to translate vision into reality.", "Warren Bennis"],
  ["Example is not the main thing in influencing others. It is the only thing.", "Albert Schweitzer"],
  ["Nothing in life is to be feared, it is only to be understood.", "Marie Curie"],
  ["I have not failed. I've just found 10,000 ways that won't work.", "Thomas Edison"],
  ["Somewhere, something incredible is waiting to be known.", "Carl Sagan"],
  ["It is not the strongest that survives, but the most adaptable.", "Charles Darwin (paraphrased)"],
  ["Imagination is more important than knowledge.", "Albert Einstein"],
  ["In the middle of difficulty lies opportunity.", "Albert Einstein"],
  ["The obstacle is the way.", "Marcus Aurelius (paraphrased)"],
  ["Waste no more time arguing what a good person should be. Be one.", "Marcus Aurelius"],
  ["How long are you going to wait before you demand the best for yourself?", "Epictetus"],
  ["Small daily improvements are the key to staggering long-term results.", "Robin Sharma"],
  ["Motivation gets you going, but discipline keeps you growing.", "John C. Maxwell"],
  ["The successful warrior is the average person with laser-like focus.", "Bruce Lee"],
  ["Knowledge speaks, but wisdom listens.", "Jimi Hendrix (attributed)"],
  ["Turn your wounds into wisdom.", "Oprah Winfrey"],
];

function renderQuote() {
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  const [text, author] = QUOTES[daysSinceEpoch % QUOTES.length];
  $("quoteText").textContent = "\u201C" + text + "\u201D";
  $("quoteAuthor").textContent = "— " + author;
}

// ============================================
// ROOTED · Priority tiers (red / yellow / green)
// Highest-position priority = red tier, second = yellow, rest = green.
// With the defaults (Low, Medium, High) that maps exactly to 🔴🟡🟢.
// ============================================
function tierOf(task) {
  if (!priorities.length) return "green";
  const sorted = [...priorities].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  if (task.priority_id === sorted[0]?.id) return "red";
  if (task.priority_id === sorted[1]?.id) return "yellow";
  return "green";
}

function todaysTasks() {
  const today = todayStr();
  return tasks.filter((t) => (t.scope || "daily") === "daily" && t.due_date === today);
}

// ============================================
// ROOTED · Dashboard renders
// ============================================
function renderDashboard() {
  renderPriorityStats();
  renderScore();
  renderWins();
  renderHabits();
}

function renderPriorityStats() {
  const today = todaysTasks();
  const red = today.filter((t) => tierOf(t) === "red" && !t.completed).length;
  const yellow = today.filter((t) => tierOf(t) === "yellow" && !t.completed).length;
  $("priorityStats").innerHTML = `
    <div class="stat red" data-go="planner"><div class="num">${red}</div><div class="lbl">🔴 Red left</div></div>
    <div class="stat yellow" data-go="planner"><div class="num">${yellow}</div><div class="lbl">🟡 Yellow left</div></div>`;
  $("priorityStats").querySelectorAll(".stat").forEach((el) =>
    el.addEventListener("click", () => { activeScope = "daily"; syncPlannerTabs(); switchView("tasks"); }));
}

function renderScore() {
  const today = todaysTasks();
  const ry = today.filter((t) => tierOf(t) !== "green");
  const ryDone = ry.filter((t) => t.completed).length;
  const greensDone = today.filter((t) => tierOf(t) === "green" && t.completed).length;

  let base;
  if (ry.length > 0) base = Math.round((ryDone / ry.length) * 100);
  else base = today.some((t) => t.completed) ? 100 : 0;

  const bonus = base >= 100 ? greensDone * 5 : 0;
  const score = base + bonus;

  $("scoreNum").textContent = score + "%";
  const circumference = 251.3;
  const shown = Math.min(score, 100) / 100;
  requestAnimationFrame(() => {
    $("scoreArc").style.strokeDashoffset = circumference * (1 - shown);
  });

  let sub;
  if (ry.length === 0 && today.length === 0) sub = "No tasks due today yet — plan your day in the Planner.";
  else if (bonus > 0) sub = `Priorities done! <span class="score-bonus">+${bonus}% bonus</span> for ${greensDone} green task${greensDone === 1 ? "" : "s"} 💪`;
  else sub = `<strong>${ryDone} of ${ry.length}</strong> red & yellow tasks completed today.`;
  $("scoreSub").innerHTML = sub;
}

function renderWins() {
  const today = todayStr();
  const wins = tasks.filter((t) => t.completed && (t.completed_at || "").slice(0, 10) === today);
  if (!wins.length) {
    $("winsList").innerHTML = `<div class="empty" style="padding:20px"><span class="emoji">🌅</span>Your first win of the day is waiting.</div>`;
    return;
  }
  $("winsList").innerHTML = wins.map((t, i) =>
    `<div class="win-row" style="animation-delay:${i * 0.05}s"><span class="tick">✓</span>${esc(t.title)}</div>`).join("");
}

// ============================================
// ROOTED · Habits & streaks
// ============================================
const HABIT_EMOJIS = ["⭐", "😴", "🌅", "📖", "🏋️", "💧", "🧘", "🙏", "☀️", "📵", "🥗", "🏃", "✍️", "🎯", "💊", "🦷"];

async function loadHabits() {
  const [{ data: h }, { data: c }] = await Promise.all([
    db.from("habits").select("*").eq("user_id", user.id).order("position"),
    db.from("habit_checks").select("habit_id,date").eq("user_id", user.id),
  ]);
  habits = h || [];
  habitChecks = new Set((c || []).map((x) => x.habit_id + "|" + x.date));
}

function streakOf(habitId) {
  const day = new Date();
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let streak = 0;
  // today counts if checked; otherwise streak continues from yesterday
  if (!habitChecks.has(habitId + "|" + fmt(day))) day.setDate(day.getDate() - 1);
  while (habitChecks.has(habitId + "|" + fmt(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

function renderHabits() {
  const wrap = $("habitList");
  if (!habits.length) {
    wrap.innerHTML = `<div class="empty" style="padding:20px"><span class="emoji">🔥</span>Add a habit to start your first streak.</div>`;
    return;
  }
  const today = todayStr();
  wrap.innerHTML = habits.map((h, i) => {
    const done = habitChecks.has(h.id + "|" + today);
    const streak = streakOf(h.id);
    return `
    <div class="habit-row" data-id="${h.id}" style="animation-delay:${i * 0.05}s">
      <span class="habit-icon">${esc(h.icon || "⭐")}</span>
      <span class="habit-name">${esc(h.name)}</span>
      <span class="habit-streak ${streak >= 3 ? "hot" : ""}">🔥 ${streak}</span>
      <div class="habit-tools">
        <button class="icon-btn move up" title="Move up" ${i === 0 ? "disabled style='opacity:0.3'" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
        <button class="icon-btn move down" title="Move down" ${i === habits.length - 1 ? "disabled style='opacity:0.3'" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg></button>
        <button class="icon-btn edit" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/></svg></button>
        <button class="icon-btn del" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg></button>
      </div>
      <button class="habit-check ${done ? "done" : ""}" aria-label="Mark done today">✓</button>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".habit-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".habit-check").addEventListener("click", () => toggleHabit(id));
    row.querySelector(".edit").addEventListener("click", () => openHabitModal(id));
    row.querySelector(".del").addEventListener("click", () => deleteHabit(id));
    row.querySelector(".up").addEventListener("click", () => moveHabit(id, -1));
    row.querySelector(".down").addEventListener("click", () => moveHabit(id, 1));
  });
}

async function toggleHabit(id) {
  const today = todayStr();
  const key = id + "|" + today;
  if (habitChecks.has(key)) {
    habitChecks.delete(key);
    renderHabits();
    await db.from("habit_checks").delete().eq("habit_id", id).eq("date", today);
  } else {
    habitChecks.add(key);
    renderHabits();
    const { error } = await db.from("habit_checks").insert({ habit_id: id, user_id: user.id, date: today });
    if (error) { habitChecks.delete(key); renderHabits(); return toast("Couldn't save — try again"); }
    const s = streakOf(id);
    if (s > 0 && s % 7 === 0) toast(`${s}-day streak! Unstoppable 🔥`);
  }
}

async function moveHabit(id, dir) {
  const i = habits.findIndex((h) => h.id === id);
  const j = i + dir;
  if (j < 0 || j >= habits.length) return;
  [habits[i], habits[j]] = [habits[j], habits[i]];
  habits.forEach((h, idx) => (h.position = idx));
  renderHabits();
  await Promise.all(habits.map((h) => db.from("habits").update({ position: h.position }).eq("id", h.id)));
}

async function deleteHabit(id) {
  const h = habits.find((x) => x.id === id);
  if (!confirm(`Delete "${h.name}" and its streak history?`)) return;
  await db.from("habits").delete().eq("id", id);
  habits = habits.filter((x) => x.id !== id);
  renderHabits();
  toast("Habit deleted");
}

function openHabitModal(id = null) {
  editingHabitId = id;
  const h = id ? habits.find((x) => x.id === id) : null;
  $("habitModalTitle").textContent = h ? "Edit habit" : "New habit";
  $("habitName").value = h ? h.name : "";
  habitIcon = h ? h.icon || "⭐" : "⭐";
  $("emojiRow").innerHTML = HABIT_EMOJIS.map((e) =>
    `<button type="button" class="${e === habitIcon ? "active" : ""}" data-e="${e}">${e}</button>`).join("");
  $("emojiRow").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      habitIcon = b.dataset.e;
      $("emojiRow").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    }));
  $("habitModal").classList.add("open");
  setTimeout(() => $("habitName").focus(), 250);
}

async function saveHabit() {
  const name = $("habitName").value.trim();
  if (!name) return toast("Give your habit a name");
  if (editingHabitId) {
    await db.from("habits").update({ name, icon: habitIcon }).eq("id", editingHabitId);
    const h = habits.find((x) => x.id === editingHabitId);
    h.name = name; h.icon = habitIcon;
  } else {
    const { data, error } = await db.from("habits")
      .insert({ user_id: user.id, name, icon: habitIcon, position: habits.length }).select().single();
    if (error) return toast("Couldn't save — try again");
    habits.push(data);
  }
  $("habitModal").classList.remove("open");
  renderHabits();
  toast(editingHabitId ? "Habit updated" : "Habit added 🔥");
  editingHabitId = null;
}

// ============================================
// ROOTED · Brain dump (autosave)
// ============================================
let dumpTimer = null;

async function loadDump() {
  const { data } = await db.from("brain_dump").select("content").eq("user_id", user.id).maybeSingle();
  if (data) $("dumpArea").value = data.content || "";
}

function queueDumpSave() {
  $("dumpHint").textContent = "Saving…";
  clearTimeout(dumpTimer);
  dumpTimer = setTimeout(async () => {
    const { error } = await db.from("brain_dump")
      .upsert({ user_id: user.id, content: $("dumpArea").value, updated_at: new Date().toISOString() });
    $("dumpHint").textContent = error ? "Couldn't save — check connection" : "Saved ✓";
  }, 800);
}

// ============================================
// ROOTED · Planner tabs + dashboard events
// ============================================
function syncPlannerTabs() {
  $("plannerTabs").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.scope === activeScope));
  const isDump = activeScope === "dump";
  $("plannerBody").style.display = isDump ? "none" : "block";
  $("dumpBody").style.display = isDump ? "block" : "none";
  $("fabBtn").style.display = isDump ? "none" : "grid";
}

function wireRootedEvents() {
  $("plannerTabs").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      activeScope = b.dataset.scope;
      syncPlannerTabs();
      if (activeScope !== "dump") { renderFilterChips(); renderTasks(); }
    }));

  $("dumpArea").addEventListener("input", queueDumpSave);

  $("addHabitBtn").addEventListener("click", () => openHabitModal());
  $("habitCancel").addEventListener("click", () => $("habitModal").classList.remove("open"));
  $("habitSave").addEventListener("click", saveHabit);
  $("habitModal").addEventListener("click", (e) => { if (e.target.id === "habitModal") $("habitModal").classList.remove("open"); });
  $("habitName").addEventListener("keydown", (e) => { if (e.key === "Enter") saveHabit(); });
}
