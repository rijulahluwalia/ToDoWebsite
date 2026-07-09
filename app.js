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

// Phase 2 · Projects
let projects = [];
let projectSections = [];
let projectItems = [];
let openProjectId = null;      // null = grid, uuid = detail view
let editingProjectId = null;   // project modal
let projectIcon = "📂";
let pitemCtx = null;           // { projectId, sectionId, itemId } for item modal

// Phase 2 · Routines
let routines = [];
let routineSteps = [];         // master steps
let dayRoutineSteps = [];      // today's editable copies
let routineDayState = new Set(); // "routineId|YYYY-MM-DD"
let openRoutineId = null;      // null = list, uuid = step editor
let editingRoutineId = null;   // routine modal
let routineIcon = "🔁";
let routineDaysPick = "0123456";

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
  await loadProjects();
  await loadRoutines();
  await ensureTodayRoutines();

  renderGreeting();
  renderQuote();
  renderAll();
  wireEvents();
  wireRootedEvents();
  wirePhase2Events();
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
  renderProjects();
  renderRoutines();
  renderTodayRoutines();
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
  $("routineToday").style.display = activeScope === "daily" ? "block" : "none";
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

// ============================================
// PHASE 2 · PROJECTS
// ============================================
const PROJECT_EMOJIS = ["📂", "🏠", "💼", "💍", "🕉️", "🏗️", "👶", "✈️", "💰", "🎨", "📚", "🌱", "🚗", "🎓", "🧳", "❤️"];

async function loadProjects() {
  const [{ data: p }, { data: s }, { data: it }] = await Promise.all([
    db.from("projects").select("*").eq("user_id", user.id).order("position"),
    db.from("project_sections").select("*").eq("user_id", user.id).order("position"),
    db.from("project_items").select("*").eq("user_id", user.id).order("position").order("created_at"),
  ]);
  projects = p || [];
  projectSections = s || [];
  projectItems = it || [];
}

function projectProgress(pid) {
  const items = projectItems.filter((i) => i.project_id === pid);
  if (!items.length) return { pct: 0, done: 0, total: 0 };
  const done = items.filter((i) => i.completed).length;
  return { pct: Math.round((done / items.length) * 100), done, total: items.length };
}

function projectNextDeadline(pid) {
  const today = todayStr();
  const dates = projectItems
    .filter((i) => i.project_id === pid && !i.completed && i.due_date && i.due_date >= today)
    .map((i) => i.due_date).sort();
  return dates[0] || null;
}

function renderProjects() {
  const root = $("projectsRoot");
  if (openProjectId && !projects.find((p) => p.id === openProjectId)) openProjectId = null;
  if (openProjectId) return renderProjectDetail(root);

  const cards = projects.map((p, i) => {
    const prog = projectProgress(p.id);
    const dl = projectNextDeadline(p.id);
    return `
    <div class="project-card fade-up" data-id="${p.id}" style="animation-delay:${Math.min(i * 0.06, 0.4)}s">
      <div class="project-card-head">
        <span class="project-icon">${esc(p.icon || "📂")}</span>
        <span class="project-name">${esc(p.name)}</span>
      </div>
      <div class="progress"><div class="progress-fill" style="width:${prog.pct}%"></div></div>
      <div class="project-meta">
        <span><strong>${prog.pct}%</strong> · ${prog.done} of ${prog.total} done</span>
        ${dl ? `<span class="project-deadline">⏰ ${niceDate(dl)}</span>` : ""}
      </div>
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="section-head fade-up">
      <h2>📂 Projects</h2>
      <button class="btn-ghost" id="addProjectBtn">+ New project</button>
    </div>
    ${projects.length
      ? `<div class="project-grid">${cards}</div>`
      : `<div class="empty fade-up"><span class="emoji">📂</span>Big dreams live here. Create your first project.</div>`}`;

  $("addProjectBtn").addEventListener("click", () => openProjectModal());
  root.querySelectorAll(".project-card").forEach((el) =>
    el.addEventListener("click", () => { openProjectId = el.dataset.id; renderProjects(); }));
}

function pitemHTML(it) {
  const safeLink = it.link && /^https?:\/\//i.test(it.link) ? it.link : null;
  return `
    <div class="pitem ${it.completed ? "done" : ""}" data-id="${it.id}">
      <button class="check" aria-label="Toggle done">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
      </button>
      <div class="pitem-body">
        <div class="pitem-title">${esc(it.title)}</div>
        <div class="task-meta">
          ${it.due_date ? `<span>⏰ ${niceDate(it.due_date)}</span>` : ""}
          ${safeLink ? `<a class="pitem-link" href="${esc(safeLink)}" target="_blank" rel="noopener">🔗 link</a>` : ""}
        </div>
        ${it.notes ? `<div class="task-notes">${esc(it.notes)}</div>` : ""}
      </div>
      <button class="icon-btn edit" aria-label="Edit item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/></svg></button>
      <button class="icon-btn del" aria-label="Delete item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg></button>
    </div>`;
}

function sectionHTML(sec, depth) {
  const items = projectItems.filter((i) => i.section_id === sec.id);
  const children = projectSections.filter((s) => s.parent_id === sec.id);
  return `
  <div class="psection" data-id="${sec.id}" style="margin-left:${Math.min(depth, 4) * 18}px">
    <div class="psection-head">
      <span class="psection-name" data-id="${sec.id}" title="Click to rename">${esc(sec.name)}</span>
      <div class="psection-tools">
        <button class="btn-mini add-item" data-sec="${sec.id}">+ Item</button>
        <button class="btn-mini add-sub" data-sec="${sec.id}">+ Section</button>
        <button class="icon-btn del-sec" data-sec="${sec.id}" aria-label="Delete section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg></button>
      </div>
    </div>
    ${items.length ? `<div class="pitem-list">${items.map(pitemHTML).join("")}</div>` : ""}
    ${children.map((c) => sectionHTML(c, depth + 1)).join("")}
  </div>`;
}

function renderProjectDetail(root) {
  const p = projects.find((x) => x.id === openProjectId);
  const prog = projectProgress(p.id);
  const rootItems = projectItems.filter((i) => i.project_id === p.id && !i.section_id);
  const rootSections = projectSections.filter((s) => s.project_id === p.id && !s.parent_id);

  root.innerHTML = `
    <div class="project-detail fade-up">
      <div class="project-detail-top">
        <button class="btn-back" id="projBack">‹ Projects</button>
        <div class="project-detail-tools">
          <button class="btn-mini" id="projRename">✏️ Edit</button>
          <button class="btn-mini danger" id="projDelete">Delete</button>
        </div>
      </div>
      <div class="project-detail-head">
        <span class="project-icon big">${esc(p.icon || "📂")}</span>
        <div style="flex:1;min-width:0">
          <h2 class="project-detail-name">${esc(p.name)}</h2>
          <div class="progress" style="margin-top:8px"><div class="progress-fill" style="width:${prog.pct}%"></div></div>
          <div class="project-meta" style="margin-top:6px"><span><strong>${prog.pct}%</strong> complete · ${prog.done} of ${prog.total} items</span></div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin-bottom:10px">📝 Notes & links</h3>
        <textarea class="project-notes" id="projNotes" placeholder="Ideas, links, measurements, anything…">${esc(p.notes || "")}</textarea>
        <div class="dump-hint" id="projNotesHint">Saves automatically</div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="section-head" style="margin-bottom:12px">
          <h3>✅ Tasks</h3>
          <div style="display:flex;gap:8px">
            <button class="btn-mini" id="projAddItem">+ Item</button>
            <button class="btn-mini" id="projAddSection">+ Section</button>
          </div>
        </div>
        ${rootItems.length ? `<div class="pitem-list">${rootItems.map(pitemHTML).join("")}</div>` : ""}
        ${rootSections.map((s) => sectionHTML(s, 0)).join("")}
        ${!rootItems.length && !rootSections.length
          ? `<div class="empty" style="padding:20px"><span class="emoji">🌱</span>Add a first item or a section to structure this project.</div>` : ""}
      </div>
    </div>`;

  $("projBack").addEventListener("click", () => { openProjectId = null; renderProjects(); });
  $("projRename").addEventListener("click", () => openProjectModal(p.id));
  $("projDelete").addEventListener("click", () => deleteProject(p.id));
  $("projAddItem").addEventListener("click", () => openPitemModal(p.id, null));
  $("projAddSection").addEventListener("click", () => addSection(p.id, null));

  // notes autosave
  let notesTimer = null;
  $("projNotes").addEventListener("input", () => {
    $("projNotesHint").textContent = "Saving…";
    clearTimeout(notesTimer);
    notesTimer = setTimeout(async () => {
      const val = $("projNotes").value;
      const { error } = await db.from("projects").update({ notes: val }).eq("id", p.id);
      if (!error) p.notes = val;
      $("projNotesHint").textContent = error ? "Couldn't save — check connection" : "Saved ✓";
    }, 800);
  });

  // sections
  root.querySelectorAll(".psection-name").forEach((el) =>
    el.addEventListener("click", () => renameSection(el.dataset.id)));
  root.querySelectorAll(".add-item").forEach((b) =>
    b.addEventListener("click", () => openPitemModal(p.id, b.dataset.sec)));
  root.querySelectorAll(".add-sub").forEach((b) =>
    b.addEventListener("click", () => addSection(p.id, b.dataset.sec)));
  root.querySelectorAll(".del-sec").forEach((b) =>
    b.addEventListener("click", () => deleteSection(b.dataset.sec)));

  // items
  root.querySelectorAll(".pitem").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".check").addEventListener("click", () => togglePitem(id));
    el.querySelector(".edit").addEventListener("click", () => {
      const it = projectItems.find((x) => x.id === id);
      openPitemModal(it.project_id, it.section_id, id);
    });
    el.querySelector(".del").addEventListener("click", () => deletePitem(id));
  });
}

// ---------- project CRUD ----------
function openProjectModal(id = null) {
  editingProjectId = id;
  const p = id ? projects.find((x) => x.id === id) : null;
  $("projectModalTitle").textContent = p ? "Edit project" : "New project";
  $("projectName").value = p ? p.name : "";
  projectIcon = p ? p.icon || "📂" : "📂";
  $("projectEmojiRow").innerHTML = PROJECT_EMOJIS.map((e) =>
    `<button type="button" class="${e === projectIcon ? "active" : ""}" data-e="${e}">${e}</button>`).join("");
  $("projectEmojiRow").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      projectIcon = b.dataset.e;
      $("projectEmojiRow").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    }));
  $("projectModal").classList.add("open");
  setTimeout(() => $("projectName").focus(), 250);
}

async function saveProject() {
  const name = $("projectName").value.trim();
  if (!name) return toast("Give your project a name");
  if (editingProjectId) {
    const { error } = await db.from("projects").update({ name, icon: projectIcon }).eq("id", editingProjectId);
    if (error) return toast("Couldn't save — try again");
    const p = projects.find((x) => x.id === editingProjectId);
    p.name = name; p.icon = projectIcon;
  } else {
    const { data, error } = await db.from("projects")
      .insert({ user_id: user.id, name, icon: projectIcon, position: projects.length }).select().single();
    if (error) return toast("Couldn't save — try again");
    projects.push(data);
    openProjectId = data.id; // jump straight in
  }
  $("projectModal").classList.remove("open");
  toast(editingProjectId ? "Project updated" : "Project created 📂");
  editingProjectId = null;
  renderProjects();
}

async function deleteProject(id) {
  const p = projects.find((x) => x.id === id);
  const count = projectItems.filter((i) => i.project_id === id).length;
  if (!confirm(`Delete "${p.name}"${count ? ` and its ${count} item(s)` : ""}? This can't be undone.`)) return;
  const { error } = await db.from("projects").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  projects = projects.filter((x) => x.id !== id);
  projectSections = projectSections.filter((s) => s.project_id !== id);
  projectItems = projectItems.filter((i) => i.project_id !== id);
  openProjectId = null;
  renderProjects();
  toast("Project deleted");
}

// ---------- sections ----------
async function addSection(projectId, parentId) {
  const name = (prompt("Section name:") || "").trim();
  if (!name) return;
  const siblings = projectSections.filter((s) => s.project_id === projectId && s.parent_id === (parentId || null));
  const { data, error } = await db.from("project_sections")
    .insert({ project_id: projectId, parent_id: parentId || null, user_id: user.id, name, position: siblings.length })
    .select().single();
  if (error) return toast("Couldn't create section — try again");
  projectSections.push(data);
  renderProjects();
}

async function renameSection(id) {
  const s = projectSections.find((x) => x.id === id);
  const name = (prompt("Rename section:", s.name) || "").trim();
  if (!name || name === s.name) return;
  const { error } = await db.from("project_sections").update({ name }).eq("id", id);
  if (error) return toast("Couldn't rename — try again");
  s.name = name;
  renderProjects();
}

function descendantSections(id) {
  const kids = projectSections.filter((s) => s.parent_id === id);
  return kids.reduce((acc, k) => acc.concat(k.id, descendantSections(k.id)), []);
}

async function deleteSection(id) {
  const s = projectSections.find((x) => x.id === id);
  const ids = [id, ...descendantSections(id)];
  const count = projectItems.filter((i) => ids.includes(i.section_id)).length;
  if (!confirm(`Delete section "${s.name}"${count ? ` and its ${count} item(s)` : ""}?`)) return;
  const { error } = await db.from("project_sections").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  projectSections = projectSections.filter((x) => !ids.includes(x.id));
  projectItems = projectItems.filter((i) => !ids.includes(i.section_id));
  renderProjects();
}

// ---------- project items ----------
function openPitemModal(projectId, sectionId, itemId = null) {
  pitemCtx = { projectId, sectionId: sectionId || null, itemId };
  const it = itemId ? projectItems.find((x) => x.id === itemId) : null;
  $("pitemModalTitle").textContent = it ? "Edit item" : "New item";
  $("pitemTitle").value = it ? it.title : "";
  $("pitemNotes").value = it ? it.notes || "" : "";
  $("pitemLink").value = it ? it.link || "" : "";
  $("pitemDate").value = it ? it.due_date || "" : "";
  $("pitemModal").classList.add("open");
  setTimeout(() => $("pitemTitle").focus(), 250);
}

async function savePitem() {
  const title = $("pitemTitle").value.trim();
  if (!title) return toast("Give the item a name first");
  let link = $("pitemLink").value.trim();
  if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
  const payload = {
    title,
    notes: $("pitemNotes").value.trim() || null,
    link: link || null,
    due_date: $("pitemDate").value || null,
  };
  const btn = $("pitemSave");
  btn.disabled = true;
  let error, data;
  if (pitemCtx.itemId) {
    ({ error } = await db.from("project_items").update(payload).eq("id", pitemCtx.itemId));
  } else {
    const siblings = projectItems.filter((i) => i.project_id === pitemCtx.projectId && i.section_id === pitemCtx.sectionId);
    ({ data, error } = await db.from("project_items")
      .insert({ ...payload, project_id: pitemCtx.projectId, section_id: pitemCtx.sectionId, user_id: user.id, position: siblings.length })
      .select().single());
  }
  btn.disabled = false;
  if (error) return toast("Couldn't save — try again");
  if (pitemCtx.itemId) {
    const it = projectItems.find((x) => x.id === pitemCtx.itemId);
    Object.assign(it, payload);
  } else {
    projectItems.push(data);
  }
  $("pitemModal").classList.remove("open");
  toast(pitemCtx.itemId ? "Item updated" : "Item added ✨");
  pitemCtx = null;
  renderProjects();
}

async function togglePitem(id) {
  const it = projectItems.find((x) => x.id === id);
  it.completed = !it.completed;
  it.completed_at = it.completed ? new Date().toISOString() : null;
  renderProjects();
  const { error } = await db.from("project_items")
    .update({ completed: it.completed, completed_at: it.completed_at }).eq("id", id);
  if (error) {
    it.completed = !it.completed;
    renderProjects();
    return toast("Couldn't save — try again");
  }
  if (it.completed) toast("Nice one ✓");
}

async function deletePitem(id) {
  const { error } = await db.from("project_items").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  projectItems = projectItems.filter((x) => x.id !== id);
  renderProjects();
  toast("Item removed");
}

// ============================================
// PHASE 2 · ROUTINES (master vs today's copy)
// ============================================
const ROUTINE_EMOJIS = ["🔁", "🌅", "🌙", "🏋️", "🧘", "🧖", "🚿", "🧴", "🧹", "📅", "☕", "📖", "🙏", "💆", "🥗", "🛏️"];
const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

async function loadRoutines() {
  const today = todayStr();
  const [{ data: r }, { data: s }, { data: d }, { data: st }] = await Promise.all([
    db.from("routines").select("*").eq("user_id", user.id).order("position"),
    db.from("routine_steps").select("*").eq("user_id", user.id).order("position"),
    db.from("routine_day_steps").select("*").eq("user_id", user.id).eq("date", today).order("position"),
    db.from("routine_day_state").select("routine_id,date").eq("user_id", user.id).eq("date", today),
  ]);
  routines = r || [];
  routineSteps = s || [];
  dayRoutineSteps = d || [];
  routineDayState = new Set((st || []).map((x) => x.routine_id + "|" + x.date));
}

function routinesDueToday() {
  const dow = String(new Date().getDay());
  return routines.filter((r) => (r.days || "0123456").includes(dow));
}

// Copy master steps into today's editable rows — once per routine per day.
async function ensureTodayRoutines() {
  const today = todayStr();
  for (const r of routinesDueToday()) {
    if (routineDayState.has(r.id + "|" + today)) continue;
    const steps = routineSteps.filter((s) => s.routine_id === r.id);
    // A routine with no master steps yet isn't frozen for today — steps the
    // user is still adding will flow into today's copy on the next visit.
    if (!steps.length) continue;
    const copies = steps.map((s, i) => ({
      routine_id: r.id, user_id: user.id, date: today,
      title: s.title, time_hint: s.time_hint, position: i,
    }));
    const { data } = await db.from("routine_day_steps").insert(copies).select();
    if (data) dayRoutineSteps.push(...data);
    await db.from("routine_day_state").insert({ routine_id: r.id, user_id: user.id, date: today });
    routineDayState.add(r.id + "|" + today);
  }
}

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return esc(hhmm);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 || 12;
  return `${hr}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

// ---------- today's routines in the Daily planner ----------
function renderTodayRoutines() {
  const wrap = $("routineToday");
  const due = routinesDueToday();
  if (!due.length) { wrap.innerHTML = ""; return; }

  wrap.innerHTML = due.map((r) => {
    const steps = dayRoutineSteps.filter((s) => s.routine_id === r.id).sort((a, b) => a.position - b.position);
    const done = steps.filter((s) => s.done).length;
    return `
    <div class="routine-block fade-up" data-id="${r.id}">
      <div class="routine-block-head">
        <span class="routine-block-title">${esc(r.icon || "🔁")} ${esc(r.name)}</span>
        <span class="routine-block-count">${done}/${steps.length}</span>
      </div>
      ${steps.length ? steps.map((s) => `
        <div class="rstep ${s.done ? "done" : ""}" data-id="${s.id}">
          <button class="rstep-check" aria-label="Toggle step">✓</button>
          ${s.time_hint ? `<span class="rstep-time">${fmtTime(s.time_hint)}</span>` : ""}
          <span class="rstep-title" title="Click to rename (today only)">${esc(s.title)}</span>
          <button class="rstep-del" title="Remove for today only" aria-label="Remove step today">×</button>
        </div>`).join("")
      : `<div class="rstep-empty">No steps for today.</div>`}
      <button class="btn-mini rstep-add" data-r="${r.id}">+ Step (today only)</button>
    </div>`;
  }).join("") + `<div class="routine-note">Changes here only affect today — your master routines stay untouched. Edit them in the Routines tab.</div>`;

  wrap.querySelectorAll(".rstep").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".rstep-check").addEventListener("click", () => toggleDayStep(id));
    el.querySelector(".rstep-title").addEventListener("click", () => renameDayStep(id));
    el.querySelector(".rstep-del").addEventListener("click", () => removeDayStep(id));
  });
  wrap.querySelectorAll(".rstep-add").forEach((b) =>
    b.addEventListener("click", () => addDayStep(b.dataset.r)));
}

async function toggleDayStep(id) {
  const s = dayRoutineSteps.find((x) => x.id === id);
  s.done = !s.done;
  renderTodayRoutines();
  const { error } = await db.from("routine_day_steps").update({ done: s.done }).eq("id", id);
  if (error) { s.done = !s.done; renderTodayRoutines(); return toast("Couldn't save — try again"); }
  const r = routines.find((x) => x.id === s.routine_id);
  const steps = dayRoutineSteps.filter((x) => x.routine_id === s.routine_id);
  if (s.done && steps.length && steps.every((x) => x.done)) toast(`${r ? r.name : "Routine"} complete! 🌟`);
}

async function renameDayStep(id) {
  const s = dayRoutineSteps.find((x) => x.id === id);
  const title = (prompt("Rename step (today only):", s.title) || "").trim();
  if (!title || title === s.title) return;
  const { error } = await db.from("routine_day_steps").update({ title }).eq("id", id);
  if (error) return toast("Couldn't save — try again");
  s.title = title;
  renderTodayRoutines();
}

async function removeDayStep(id) {
  const { error } = await db.from("routine_day_steps").delete().eq("id", id);
  if (error) return toast("Couldn't remove — try again");
  dayRoutineSteps = dayRoutineSteps.filter((x) => x.id !== id);
  renderTodayRoutines();
  toast("Removed for today");
}

async function addDayStep(routineId) {
  const title = (prompt("Step to add (today only):") || "").trim();
  if (!title) return;
  const siblings = dayRoutineSteps.filter((x) => x.routine_id === routineId);
  const today = todayStr();
  const { data, error } = await db.from("routine_day_steps")
    .insert({ routine_id: routineId, user_id: user.id, date: today, title, position: siblings.length })
    .select().single();
  if (error) return toast("Couldn't add — try again");
  dayRoutineSteps.push(data);
  // Adding a today-only step freezes today's copy so master steps don't pile on top later
  if (!routineDayState.has(routineId + "|" + today)) {
    await db.from("routine_day_state").insert({ routine_id: routineId, user_id: user.id, date: today });
    routineDayState.add(routineId + "|" + today);
  }
  renderTodayRoutines();
}

// ---------- routines management view ----------
function renderRoutines() {
  const root = $("routinesRoot");
  if (openRoutineId && !routines.find((r) => r.id === openRoutineId)) openRoutineId = null;
  if (openRoutineId) return renderRoutineEditor(root);

  const cards = routines.map((r, i) => {
    const steps = routineSteps.filter((s) => s.routine_id === r.id).length;
    const days = (r.days || "0123456");
    const chips = DOW_LABELS.map((l, d) =>
      `<span class="dow-chip ${days.includes(String(d)) ? "on" : ""}">${l}</span>`).join("");
    return `
    <div class="routine-card fade-up" data-id="${r.id}" style="animation-delay:${Math.min(i * 0.06, 0.4)}s">
      <span class="project-icon">${esc(r.icon || "🔁")}</span>
      <div style="flex:1;min-width:0">
        <div class="project-name">${esc(r.name)}</div>
        <div class="routine-card-sub">${steps} step${steps === 1 ? "" : "s"}</div>
      </div>
      <div class="dow-row">${chips}</div>
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="section-head fade-up">
      <h2>🔁 Routines</h2>
      <button class="btn-ghost" id="addRoutineBtn">+ New routine</button>
    </div>
    <p style="color:var(--ink-soft);margin-bottom:16px;font-size:0.92rem">
      Build your master routines here. On their scheduled days they appear in the Daily planner as a fresh copy — edit that copy freely, the master never changes.
    </p>
    ${routines.length
      ? `<div class="routine-list">${cards}</div>`
      : `<div class="empty fade-up"><span class="emoji">🔁</span>Create a routine — mornings are a good place to start.</div>`}`;

  $("addRoutineBtn").addEventListener("click", () => openRoutineModal());
  root.querySelectorAll(".routine-card").forEach((el) =>
    el.addEventListener("click", () => { openRoutineId = el.dataset.id; renderRoutines(); }));
}

function renderRoutineEditor(root) {
  const r = routines.find((x) => x.id === openRoutineId);
  const steps = routineSteps.filter((s) => s.routine_id === r.id).sort((a, b) => a.position - b.position);
  const days = (r.days || "0123456");
  const chips = DOW_LABELS.map((l, d) =>
    `<span class="dow-chip ${days.includes(String(d)) ? "on" : ""}">${l}</span>`).join("");

  root.innerHTML = `
    <div class="fade-up">
      <div class="project-detail-top">
        <button class="btn-back" id="routBack">‹ Routines</button>
        <div class="project-detail-tools">
          <button class="btn-mini" id="routEdit">✏️ Edit</button>
          <button class="btn-mini danger" id="routDelete">Delete</button>
        </div>
      </div>
      <div class="project-detail-head">
        <span class="project-icon big">${esc(r.icon || "🔁")}</span>
        <div>
          <h2 class="project-detail-name">${esc(r.name)}</h2>
          <div class="dow-row" style="margin-top:6px">${chips}</div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="section-head" style="margin-bottom:12px">
          <h3>Master steps</h3>
          <button class="btn-mini" id="routAddStep">+ Step</button>
        </div>
        <p style="font-size:0.8rem;color:var(--ink-soft);margin-bottom:12px">These are the template. Tomorrow's planner copy comes from here — today's copy (if already created) stays as it is.</p>
        <div id="routStepList">
          ${steps.length ? steps.map((s, i) => `
            <div class="rstep-edit" data-id="${s.id}">
              <input type="time" class="rstep-time-input" value="${esc(s.time_hint || "")}" aria-label="Step time" />
              <input type="text" class="rstep-title-input" value="${esc(s.title)}" maxlength="120" aria-label="Step title" />
              <button class="icon-btn move up" title="Move up" ${i === 0 ? "disabled style='opacity:0.3'" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
              <button class="icon-btn move down" title="Move down" ${i === steps.length - 1 ? "disabled style='opacity:0.3'" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg></button>
              <button class="icon-btn del" title="Delete step"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg></button>
            </div>`).join("")
          : `<div class="empty" style="padding:20px"><span class="emoji">📝</span>Add the first step of this routine.</div>`}
        </div>
      </div>
    </div>`;

  $("routBack").addEventListener("click", () => { openRoutineId = null; renderRoutines(); });
  $("routEdit").addEventListener("click", () => openRoutineModal(r.id));
  $("routDelete").addEventListener("click", () => deleteRoutine(r.id));
  $("routAddStep").addEventListener("click", () => addRoutineStep(r.id));

  root.querySelectorAll(".rstep-edit").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".rstep-title-input").addEventListener("change", async (e) => {
      const title = e.target.value.trim();
      const s = routineSteps.find((x) => x.id === id);
      if (!title) { e.target.value = s.title; return; }
      const { error } = await db.from("routine_steps").update({ title }).eq("id", id);
      if (error) return toast("Couldn't save — try again");
      s.title = title;
    });
    row.querySelector(".rstep-time-input").addEventListener("change", async (e) => {
      const time_hint = e.target.value || null;
      const { error } = await db.from("routine_steps").update({ time_hint }).eq("id", id);
      if (error) return toast("Couldn't save — try again");
      routineSteps.find((x) => x.id === id).time_hint = time_hint;
    });
    row.querySelector(".up").addEventListener("click", () => moveRoutineStep(r.id, id, -1));
    row.querySelector(".down").addEventListener("click", () => moveRoutineStep(r.id, id, 1));
    row.querySelector(".del").addEventListener("click", () => deleteRoutineStep(id));
  });
}

async function addRoutineStep(routineId) {
  const title = (prompt("Step:") || "").trim();
  if (!title) return;
  const siblings = routineSteps.filter((s) => s.routine_id === routineId);
  const { data, error } = await db.from("routine_steps")
    .insert({ routine_id: routineId, user_id: user.id, title, position: siblings.length })
    .select().single();
  if (error) return toast("Couldn't add — try again");
  routineSteps.push(data);
  renderRoutines();
}

async function moveRoutineStep(routineId, id, dir) {
  const list = routineSteps.filter((s) => s.routine_id === routineId).sort((a, b) => a.position - b.position);
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((s, idx) => (s.position = idx));
  renderRoutines();
  await Promise.all(list.map((s) => db.from("routine_steps").update({ position: s.position }).eq("id", s.id)));
}

async function deleteRoutineStep(id) {
  const { error } = await db.from("routine_steps").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  routineSteps = routineSteps.filter((x) => x.id !== id);
  renderRoutines();
}

// ---------- routine CRUD ----------
function openRoutineModal(id = null) {
  editingRoutineId = id;
  const r = id ? routines.find((x) => x.id === id) : null;
  $("routineModalTitle").textContent = r ? "Edit routine" : "New routine";
  $("routineName").value = r ? r.name : "";
  routineIcon = r ? r.icon || "🔁" : "🔁";
  routineDaysPick = r ? (r.days || "0123456") : "0123456";
  $("routineEmojiRow").innerHTML = ROUTINE_EMOJIS.map((e) =>
    `<button type="button" class="${e === routineIcon ? "active" : ""}" data-e="${e}">${e}</button>`).join("");
  $("routineEmojiRow").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      routineIcon = b.dataset.e;
      $("routineEmojiRow").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    }));
  renderRoutineDayPick();
  $("routineModal").classList.add("open");
  setTimeout(() => $("routineName").focus(), 250);
}

function renderRoutineDayPick() {
  $("routineDays").innerHTML = DOW_LABELS.map((l, d) =>
    `<button type="button" class="dow-btn ${routineDaysPick.includes(String(d)) ? "on" : ""}" data-d="${d}">${l}</button>`).join("");
  $("routineDays").querySelectorAll(".dow-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const d = b.dataset.d;
      routineDaysPick = routineDaysPick.includes(d)
        ? routineDaysPick.replace(d, "")
        : (routineDaysPick + d).split("").sort().join("");
      renderRoutineDayPick();
    }));
}

async function saveRoutine() {
  const name = $("routineName").value.trim();
  if (!name) return toast("Give your routine a name");
  if (!routineDaysPick) return toast("Pick at least one day");
  if (editingRoutineId) {
    const { error } = await db.from("routines")
      .update({ name, icon: routineIcon, days: routineDaysPick }).eq("id", editingRoutineId);
    if (error) return toast("Couldn't save — try again");
    const r = routines.find((x) => x.id === editingRoutineId);
    r.name = name; r.icon = routineIcon; r.days = routineDaysPick;
  } else {
    const { data, error } = await db.from("routines")
      .insert({ user_id: user.id, name, icon: routineIcon, days: routineDaysPick, position: routines.length })
      .select().single();
    if (error) return toast("Couldn't save — try again");
    routines.push(data);
    openRoutineId = data.id; // jump straight into the step editor
  }
  $("routineModal").classList.remove("open");
  toast(editingRoutineId ? "Routine updated" : "Routine created 🔁");
  editingRoutineId = null;
  await ensureTodayRoutines(); // if it runs today, it shows up today
  renderRoutines();
  renderTodayRoutines();
}

async function deleteRoutine(id) {
  const r = routines.find((x) => x.id === id);
  if (!confirm(`Delete "${r.name}" and all its history?`)) return;
  const { error } = await db.from("routines").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  routines = routines.filter((x) => x.id !== id);
  routineSteps = routineSteps.filter((s) => s.routine_id !== id);
  dayRoutineSteps = dayRoutineSteps.filter((s) => s.routine_id !== id);
  openRoutineId = null;
  renderRoutines();
  renderTodayRoutines();
  toast("Routine deleted");
}

// ---------- phase 2 wiring ----------
function wirePhase2Events() {
  // opening the Daily tab picks up any routines created/edited this session
  $("plannerTabs").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.dataset.scope === "daily") { await ensureTodayRoutines(); renderTodayRoutines(); }
    }));

  $("projectCancel").addEventListener("click", () => $("projectModal").classList.remove("open"));
  $("projectSave").addEventListener("click", saveProject);
  $("projectModal").addEventListener("click", (e) => { if (e.target.id === "projectModal") $("projectModal").classList.remove("open"); });
  $("projectName").addEventListener("keydown", (e) => { if (e.key === "Enter") saveProject(); });

  $("pitemCancel").addEventListener("click", () => $("pitemModal").classList.remove("open"));
  $("pitemSave").addEventListener("click", savePitem);
  $("pitemModal").addEventListener("click", (e) => { if (e.target.id === "pitemModal") $("pitemModal").classList.remove("open"); });
  $("pitemTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") savePitem(); });

  $("routineCancel").addEventListener("click", () => $("routineModal").classList.remove("open"));
  $("routineSave").addEventListener("click", saveRoutine);
  $("routineModal").addEventListener("click", (e) => { if (e.target.id === "routineModal") $("routineModal").classList.remove("open"); });
  $("routineName").addEventListener("keydown", (e) => { if (e.key === "Enter") saveRoutine(); });
}
