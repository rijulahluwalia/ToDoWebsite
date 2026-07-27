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

// Phase 3 · University starter
let uniSubjects = [];
let uniClasses = [];
let uniAssessments = [];
let assessmentSteps = [];
let openUniSubjectId = null;
let openAssessmentId = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DEFAULT_PRIORITIES = [
  { name: "Low", color: "#2fbf71", position: 0 },
  { name: "Medium", color: "#f5a623", position: 1 },
  { name: "High", color: "#f0455a", position: 2 },
];
const PRESET_COLORS = ["#2fbf71", "#f5a623", "#f0455a", "#4353ff", "#8a63ff", "#ff6fae", "#18c2c2", "#171b36"];

// Phase 4 · Theme studio + review
const THEME_ACCENTS = [
  { name: "Prio Blue", color: "#4353ff" },
  { name: "Lavender", color: "#8a63ff" },
  { name: "Rose", color: "#ff6fae" },
  { name: "Mint", color: "#18c2c2" },
  { name: "Sunset", color: "#ff8a3d" },
];
const defaultTheme = { mode: "light", accent: "#4353ff" };
function getTheme() {
  try { return { ...defaultTheme, ...(JSON.parse(localStorage.getItem("prioTheme") || "{}")) }; }
  catch { return defaultTheme; }
}
function setTheme(next) {
  const theme = { ...getTheme(), ...next };
  localStorage.setItem("prioTheme", JSON.stringify(theme));
  applyTheme();
  renderThemeStudio?.();
}
function applyTheme() {
  const theme = getTheme();
  document.documentElement.dataset.theme = theme.mode;
  document.documentElement.style.setProperty("--primary", theme.accent);
  document.documentElement.style.setProperty("--primary-deep", shadeHex(theme.accent, -18));
  document.documentElement.style.setProperty("--primary-soft", softHex(theme.accent));
}
function shadeHex(hex, pct) {
  const n = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * pct);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}
function softHex(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, 0.14)`;
}
applyTheme();

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
  // Supabase exposes Google's token here right after the OAuth redirect.
  // It's not stored anywhere, so grab it now or it's gone.
  gcalCaptureToken(data.session);

  await loadProfile();
  await loadPriorities();
  await loadTasks();
  await loadHabits();
  await loadProjects();
  await loadRoutines();
  try { await loadShifts(); } catch (e) { console.warn("Work shifts unavailable — run schema-update-8.sql", e); }
  await loadUni();
  await ensureTodayRoutines();
  try { await loadEvents(); await cacheInviteNames(); }
  catch (e) { console.warn("Events unavailable — run schema-update-4.sql", e); }
  try { await loadGcalLinks(); }
  catch (e) { console.warn("Google Calendar links unavailable — run schema-update-5.sql", e); }

  renderGreeting();
  renderQuote();
  renderAll();
  wireEvents();
  wirePrioEvents();
  wirePhase2Events();
  wireDatePickerEvents();
  wireUniEvents();
  wireEventEvents();
  wireTimePickerEvents();
  wireGcalEvents();
  wireShiftEvents();
  wireDeleteAccount();
  renderGcalStatus();
  wireInviteAlert();
  initPullToRefresh();
  loadWeather();
  loadDump();
  initOnboardingGuide();
  checkNewInvites();
}

async function loadProfile() {
  const { data } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  // Google puts the person's name in metadata as full_name / name
  const meta = user.user_metadata || {};
  const fallbackName = meta.display_name || meta.full_name || meta.name || user.email.split("@")[0];
  profile = data || { id: user.id, display_name: fallbackName };
  if (!data) await db.from("profiles").upsert(profile);
}

// Did this account sign up with Google rather than a password?
function isGoogleAccount() {
  const ids = user?.identities || [];
  return ids.some((i) => i.provider === "google") && !ids.some((i) => i.provider === "email");
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

function closePlannerFilter() {
  document.querySelectorAll(".prio-filter.open").forEach((m) => {
    m.classList.remove("open");
    const btn = m.querySelector(".prio-filter-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function setMenu(open) {
  const backdrop = $("menuBackdrop");
  const trigger = $("menuBtn");
  if (!backdrop || !trigger) return;
  // The planner filter is part of the page, not the menu. Close it before
  // opening the mobile nav so it can never float over the menu overlay.
  closePlannerFilter();
  backdrop.classList.toggle("open", open);
  trigger.classList.toggle("open", open);
  document.documentElement.classList.toggle("menu-open", open);
  trigger.setAttribute("aria-expanded", String(open));
  backdrop.setAttribute("aria-hidden", String(!open));
}


function initPullToRefresh() {
  const indicator = $("pullRefresh");
  const text = $("pullRefreshText");
  if (!indicator || !text || indicator.dataset.ready === "1") return;
  indicator.dataset.ready = "1";

  let startY = 0;
  let pulling = false;
  let distance = 0;
  const threshold = 92;

  const setPull = (y) => {
    const eased = Math.min(118, Math.pow(y, 0.86) * 1.55);
    indicator.classList.add("visible");
    indicator.style.transform = `translate(-50%, ${eased - 86}px) scale(${Math.min(1, 0.9 + eased / 520)})`;
    const ready = y > threshold;
    indicator.classList.toggle("ready", ready);
    text.textContent = ready ? "Release to refresh" : "Pull to refresh";
  };

  window.addEventListener("touchstart", (e) => {
    if (window.scrollY > 0 || document.body.classList.contains("modal-open")) return;
    startY = e.touches[0].clientY;
    pulling = true;
    distance = 0;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!pulling || window.scrollY > 0) return;
    const currentY = e.touches[0].clientY;
    distance = Math.max(0, currentY - startY);
    if (distance < 8) return;
    setPull(distance);
  }, { passive: true });

  window.addEventListener("touchend", () => {
    if (!pulling) return;
    pulling = false;
    if (distance > threshold) {
      indicator.classList.add("visible", "refreshing");
      indicator.classList.remove("ready");
      indicator.style.transform = "translate(-50%, 18px) scale(1)";
      text.textContent = "Refreshing Prio…";
      setTimeout(() => window.location.reload(), 520);
      return;
    }
    indicator.classList.remove("visible", "ready", "refreshing");
    indicator.style.transform = "translate(-50%, -90px) scale(0.92)";
    text.textContent = "Pull to refresh";
    distance = 0;
  }, { passive: true });
}

function promptDialog({ title = "Add details", message = "", value = "", placeholder = "Type here…", saveText = "Save" } = {}) {
  const modal = $("textPromptModal");
  const input = $("textPromptInput");
  const sub = $("textPromptSub");
  $("textPromptTitle").textContent = title;
  sub.textContent = message;
  sub.style.display = message ? "block" : "none";
  input.value = value || "";
  input.placeholder = placeholder;
  $("textPromptSave").textContent = saveText;
  modal.classList.add("open");
  setTimeout(() => { input.focus(); input.select(); }, 200);

  return new Promise((resolve) => {
    const cleanup = (answer) => {
      modal.classList.remove("open");
      $("textPromptCancel").removeEventListener("click", onCancel);
      $("textPromptSave").removeEventListener("click", onSave);
      input.removeEventListener("keydown", onKey);
      modal.removeEventListener("click", onBackdrop);
      resolve(answer);
    };
    const onCancel = () => cleanup(null);
    const onSave = () => cleanup(input.value.trim());
    const onKey = (e) => {
      if (e.key === "Enter") onSave();
      if (e.key === "Escape") onCancel();
    };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    $("textPromptCancel").addEventListener("click", onCancel);
    $("textPromptSave").addEventListener("click", onSave);
    input.addEventListener("keydown", onKey);
    modal.addEventListener("click", onBackdrop);
  });
}

function confirmDialog({ title = "Are you sure?", message = "", okText = "Delete" } = {}) {
  const modal = $("confirmModal");
  $("confirmTitle").textContent = title;
  $("confirmMessage").textContent = message;
  $("confirmOk").textContent = okText;
  modal.classList.add("open");

  return new Promise((resolve) => {
    const cleanup = (answer) => {
      modal.classList.remove("open");
      $("confirmCancel").removeEventListener("click", onCancel);
      $("confirmOk").removeEventListener("click", onOk);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(answer);
    };
    const onCancel = () => cleanup(false);
    const onOk = () => cleanup(true);
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    $("confirmCancel").addEventListener("click", onCancel);
    $("confirmOk").addEventListener("click", onOk);
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() {
  return localDateStr(new Date());
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
  renderWork();
  renderUni();
  renderTodayRoutines();
  renderCalendar();
  renderPhase4();
  renderThemeStudio();
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
  const current = chips.find((c) => c.id === activeFilter) || chips[0];
  const label = current.id === "all" ? "Filter" : `Filter: ${current.label.replace(" ✓", "")}`;

  wrap.innerHTML = `
    <div class="prio-filter" id="plannerFilterMenu">
      <button type="button" class="prio-filter-btn" id="filterTrigger" aria-expanded="false">
        <span class="prio-filter-icon">☰</span>
        <span class="prio-filter-label">${esc(label)}</span>
        ${current.color ? `<span class="prio-filter-dot" style="background:${current.color}"></span>` : ""}
        <span class="prio-filter-chevron">⌄</span>
      </button>
      <div class="prio-filter-panel" id="filterPopover">
        ${chips.map((c, i) => `
          <button type="button" class="prio-filter-item ${activeFilter === c.id ? "active" : ""}" data-filter="${c.id}" style="--i:${i}">
            ${c.color ? `<span class="prio-filter-dot" style="background:${c.color}"></span>` : `<span class="prio-filter-spacer"></span>`}
            <span class="prio-filter-text">${esc(c.label)}</span>
            ${activeFilter === c.id ? `<span class="prio-filter-tick">✓</span>` : ""}
          </button>`).join("")}
      </div>
    </div>`;

  const menu = $("plannerFilterMenu");
  const trigger = $("filterTrigger");
  const popover = $("filterPopover");

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    // Don't allow the page-level filter to open while the mobile menu is active.
    if (document.documentElement.classList.contains("menu-open")) {
      closePlannerFilter();
      return;
    }
    const open = menu.classList.toggle("open");
    trigger.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".prio-filter.open").forEach((m) => {
      m.classList.remove("open");
      const btn = m.querySelector(".prio-filter-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }, { once: true });
  menu.addEventListener("click", (e) => e.stopPropagation());

  popover.querySelectorAll(".prio-filter-item").forEach((b) => {
    b.addEventListener("click", () => {
      activeFilter = b.dataset.filter;
      menu.classList.remove("open");
      renderFilterChips();
      renderTasks();
    });
  });
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

function dateObj(iso) {
  return iso ? new Date(iso + "T00:00") : null;
}
function weekRange(base = new Date()) {
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const day = (start.getDay() + 6) % 7; // Monday first
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}
function inRange(iso, start, end) {
  const d = dateObj(iso);
  return !!d && d >= start && d <= end;
}
function scopeTasks() {
  const today = todayStr();
  const now = new Date();

  // Daily = today, overdue, and undated daily tasks.
  if (activeScope === "daily") {
    return tasks.filter((t) => (t.scope || "daily") === "daily")
      .filter((t) => t.due_date === today || (!t.completed && t.due_date && t.due_date < today) || !t.due_date);
  }

  // Dated tasks should appear in the right planning view even if they were
  // created from another tab. This keeps future Daily tasks visible in Weekly/Monthly.
  if (activeScope === "weekly") {
    const { start, end } = weekRange(now);
    return tasks.filter((t) => t.scope === "weekly" || inRange(t.due_date, start, end));
  }

  if (activeScope === "monthly") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return tasks.filter((t) => t.scope === "monthly" || inRange(t.due_date, start, end));
  }

  if (activeScope === "half-yearly") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setMonth(end.getMonth() + 6);
    return tasks.filter((t) => t.scope === "half-yearly" || inRange(t.due_date, start, end));
  }

  if (activeScope === "yearly") {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31);
    return tasks.filter((t) => t.scope === "yearly" || inRange(t.due_date, start, end));
  }

  return tasks.filter((t) => t.scope === activeScope);
}

function renderTasks() {
  const list = $("taskList");
  const pool = scopeTasks();
  let shown = pool;
  if (activeFilter === "done") shown = pool.filter((t) => t.completed);
  else if (activeFilter !== "all") shown = pool.filter((t) => t.priority_id === activeFilter && !t.completed);
  else shown = pool.filter((t) => !t.completed).sort(byPriorityDesc);

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
    if (gcal) gcal.addEventListener("click", () => {
      const t = tasks.find((x) => x.id === id);
      if (gcalConnected() && t) gcalSyncOne("task", t);
      else openGoogleCalendar(id);
    });
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
  gcalAutoSync("task", t);   // completed -> removed from Google, reopened -> re-added
  setTimeout(() => { renderTasks(); renderCalendar(); renderDashboard(); }, 500);
}

async function removeTask(id, el) {
  el.classList.add("leaving");
  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) { el.classList.remove("leaving"); return toast("Couldn't delete — try again"); }
  tasks = tasks.filter((t) => t.id !== id);
  gcalAutoRemove("task", id);
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
  setDateInput("taskDate", t ? t.due_date || "" : (presetDate || ""));
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
    due_date: $("taskDate").dataset.iso || $("taskDate").value || null,
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
  const savedId = editingTaskId;
  await loadTasks();
  renderTasks();
  renderCalendar();
  renderDashboard();
  closeModal();
  toast(wasEditing ? "Task updated" : "Task added ✨");

  // push to Google in the background — never blocks the save
  const saved = wasEditing
    ? tasks.find((t) => t.id === savedId)
    : tasks.find((t) => t.title === payload.title && t.due_date === payload.due_date);
  if (saved) gcalAutoSync("task", saved);
}

// ---------- calendar ----------
// ---------- uni calendar helpers ----------
let semesterDraftBreaks = [];
function uniSemesterKey() { return `prio_uni_semester_${user?.id || "guest"}`; }
function getUniSemesterSettings() {
  try {
    const raw = localStorage.getItem(uniSemesterKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      name: parsed.name || "",
      notes: parsed.notes || "",
      startDate: parsed.startDate || "",
      endDate: parsed.endDate || "",
      breaks: Array.isArray(parsed.breaks) ? parsed.breaks.filter((b) => b && b.start && b.end) : [],
    };
  } catch {
    return { name: "", notes: "", startDate: "", endDate: "", breaks: [] };
  }
}
function saveUniSemesterSettings(settings) {
  localStorage.setItem(uniSemesterKey(), JSON.stringify({
    name: settings.name || "",
    notes: settings.notes || "",
    startDate: settings.startDate || "",
    endDate: settings.endDate || "",
    breaks: Array.isArray(settings.breaks) ? settings.breaks : [],
  }));
}
function isDateBetween(iso, start, end) {
  if (!iso || !start || !end) return false;
  return iso >= start && iso <= end;
}
function uniBreakForDate(iso) {
  return getUniSemesterSettings().breaks.find((b) => isDateBetween(iso, b.start, b.end)) || null;
}
function uniClassesForDate(iso) {
  const settings = getUniSemesterSettings();
  if (!settings.startDate || !settings.endDate) return [];
  if (!isDateBetween(iso, settings.startDate, settings.endDate)) return [];
  if (uniBreakForDate(iso)) return [];
  const day = parseISODate(iso)?.getDay();
  return uniClasses.filter((c) => Number(c.day_of_week) === day);
}
function uniAssessmentsForDate(iso) {
  return uniAssessments.filter((a) => a.due_date === iso);
}
function uniCalendarItemsForDate(iso) {
  const classes = uniClassesForDate(iso).map((c) => {
    const s = uniSubjects.find((x) => x.id === c.subject_id);
    return { type: "class", subject: s, item: c, color: s?.color || "#4353ff" };
  });
  const assessments = uniAssessmentsForDate(iso).map((a) => {
    const s = uniSubjects.find((x) => x.id === a.subject_id);
    return { type: "assessment", subject: s, item: a, color: s?.color || "#f5a623" };
  });
  return [...classes, ...assessments];
}
// Every dated/scheduled Prio item is surfaced by the calendar automatically.
function projectCalendarItemsForDate(iso) {
  return projectItems
    .filter((item) => item.due_date === iso)
    .map((item) => ({
      item,
      project: projects.find((project) => project.id === item.project_id) || null,
    }));
}

function routineCalendarItemsForDate(iso) {
  const date = parseISODate(iso);
  if (!date) return [];
  const dow = String(date.getDay());
  return routines.filter((routine) => (routine.days || "0123456").includes(dow));
}
function hasSemesterOverview() {
  const s = getUniSemesterSettings();
  return Boolean(s.name || s.notes || s.startDate || s.endDate || (s.breaks && s.breaks.length));
}
function semesterSummary() {
  const s = getUniSemesterSettings();
  if (!s.startDate || !s.endDate) return "Dates not set";
  return `${niceDate(s.startDate)} – ${niceDate(s.endDate)}`;
}
function semesterBreakSummary() {
  const s = getUniSemesterSettings();
  const count = s.breaks?.length || 0;
  return `${count} break${count === 1 ? "" : "s"}`;
}
function semesterWeekText() {
  const s = getUniSemesterSettings();
  if (!s.startDate || !s.endDate) return "";
  const today = todayStr();
  if (today < s.startDate) return "Semester starts soon";
  if (today > s.endDate) return "Semester finished";
  const start = parseISODate(s.startDate);
  const now = parseISODate(today);
  const week = Math.max(1, Math.floor((now - start) / (7 * 86400000)) + 1);
  return `Week ${week}`;
}
function renderBreakDraftList() {
  const wrap = $("semesterBreakList");
  if (!wrap) return;
  wrap.innerHTML = semesterDraftBreaks.length ? semesterDraftBreaks.map((b, i) => `
    <div class="semester-break-row">
      <div><strong>${esc(b.label || `Break ${i + 1}`)}</strong><p>${niceDate(b.start)} – ${niceDate(b.end)}</p></div>
      <button class="icon-btn" data-remove-break="${i}" type="button">×</button>
    </div>`).join("") : `<p class="uni-muted">No breaks added yet.</p>`;
  wrap.querySelectorAll("[data-remove-break]").forEach((btn) => btn.addEventListener("click", () => {
    semesterDraftBreaks.splice(Number(btn.dataset.removeBreak), 1);
    renderBreakDraftList();
  }));
}
function openSemesterModal() {
  const settings = getUniSemesterSettings();
  if ($("semesterName")) $("semesterName").value = settings.name || "";
  if ($("semesterNotes")) $("semesterNotes").value = settings.notes || "";
  setDateInput("semesterStartDate", settings.startDate || "");
  setDateInput("semesterEndDate", settings.endDate || "");
  setDateInput("semesterBreakStart", "");
  setDateInput("semesterBreakEnd", "");
  $("semesterBreakLabel").value = "";
  semesterDraftBreaks = [...settings.breaks];
  renderBreakDraftList();
  $("semesterModal")?.classList.add("open");
}
function addSemesterBreak() {
  const start = $("semesterBreakStart")?.dataset.iso || "";
  const end = $("semesterBreakEnd")?.dataset.iso || "";
  const label = $("semesterBreakLabel")?.value.trim() || `Break ${semesterDraftBreaks.length + 1}`;
  if (!start || !end) return toast("Choose break start and end dates");
  if (end < start) return toast("Break end must be after start");
  semesterDraftBreaks.push({ label, start, end });
  setDateInput("semesterBreakStart", "");
  setDateInput("semesterBreakEnd", "");
  $("semesterBreakLabel").value = "";
  renderBreakDraftList();
}
function saveSemesterSettingsFromModal() {
  const startDate = $("semesterStartDate")?.dataset.iso || "";
  const endDate = $("semesterEndDate")?.dataset.iso || "";
  if ((startDate && !endDate) || (!startDate && endDate)) return toast("Add both semester start and end dates");
  if (startDate && endDate && endDate < startDate) return toast("Semester end must be after start");
  const name = $("semesterName")?.value.trim() || "";
  const notes = $("semesterNotes")?.value.trim() || "";
  saveUniSemesterSettings({ name, notes, startDate, endDate, breaks: semesterDraftBreaks });
  $("semesterModal")?.classList.remove("open");
  renderUni();
  renderCalendar();
  renderDayPanel();
  toast("Semester calendar updated 🗓️");
  if (gcalConnected() && gcalAutoOn()) {
    uniClasses.forEach((c) => gcalAutoSync("class", c));
    semesterBreakItems().forEach((b) => gcalAutoSync("break", b));
  }
}

async function clearSemesterOverview() {
  const ok = await confirmDialog({
    title: "Clear semester overview?",
    message: "This will remove the semester name, dates, note and breaks. Subjects, classes and assessments stay saved.",
    okText: "Clear"
  });
  if (!ok) return;
  saveUniSemesterSettings({ name: "", notes: "", startDate: "", endDate: "", breaks: [] });
  renderUni();
  renderCalendar();
  renderDayPanel();
  toast("Semester overview cleared");
}

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
    const dayProjects = projectCalendarItemsForDate(iso);
    const dayRoutines = routineCalendarItemsForDate(iso);
    const breakInfo = uniBreakForDate(iso);
    const uniItems = breakInfo ? [] : uniCalendarItemsForDate(iso);
    const dayEvents = eventsForDate(iso);
    const dayShifts = shiftsForDate(iso);
    const dots = [
      ...dayTasks.map((t) => ({ color: prioById(t.priority_id)?.color || "#c3c8dd" })),
      ...dayProjects.map(() => ({ color: "#8a63ff" })),
      ...dayRoutines.map(() => ({ color: "#18c2c2" })),
      ...(breakInfo ? [{ color: "#2fbf71" }] : uniItems.map((u) => ({ color: u.type === "assessment" ? "#ffb938" : u.color }))),
      ...dayEvents.map((e) => ({ color: e.color || "#4353ff" })),
      ...dayShifts.map((s) => ({ color: s.color || "#18c2c2" })),
    ].slice(0, 5).map((dot, i) => `<i style="background:${dot.color};animation-delay:${i * 0.06}s"></i>`).join("");
    const cls = ["cal-day", iso === today ? "today" : "", iso === selectedDate ? "selected" : "", breakInfo ? "semester-break" : ""].join(" ");
    html += `<button class="${cls}" data-date="${iso}" title="${breakInfo ? esc(breakInfo.label || 'Semester break') : ''}"><span>${d}</span><span class="cal-dots">${dots}</span></button>`;
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
  const dayProjects = projectCalendarItemsForDate(selectedDate);
  const dayRoutines = routineCalendarItemsForDate(selectedDate);
  const breakInfo = uniBreakForDate(selectedDate);
  // Semester breaks always win: assessments still appear on their due date,
  // but recurring timetable classes are intentionally hidden during breaks.
  const uniItems = breakInfo ? uniAssessmentsForDate(selectedDate).map((a) => {
    const s = uniSubjects.find((x) => x.id === a.subject_id);
    return { type: "assessment", subject: s, item: a, color: s?.color || "#f5a623" };
  }) : uniCalendarItemsForDate(selectedDate);
  const pretty = new Date(selectedDate + "T00:00").toLocaleDateString("en-AU",
    { weekday: "long", day: "numeric", month: "long" });
  const uniHtml = (breakInfo || uniItems.length) ? `
    <div class="calendar-uni-list">
      <h4>Uni</h4>
      ${breakInfo ? `<div class="calendar-break-note">🌿 ${esc(breakInfo.label || "Semester break")} · timetable classes paused for this day</div>` : ""}
      ${uniItems.map((ev) => {
        if (ev.type === "assessment") {
          const a = ev.item;
          return `<div class="calendar-uni-event assessment" style="--subject-color:${esc(ev.color)}"><span>📝</span><div><strong>${esc(a.title)}</strong><p>${esc(ev.subject?.code || ev.subject?.name || "Subject")} · Assessment due</p></div></div>`;
        }
        const c = ev.item;
        const time = `${esc((c.start_time || "").slice(0,5) || "TBA")}${c.end_time ? ` – ${esc(c.end_time.slice(0,5))}` : ""}`;
        return `<div class="calendar-uni-event class" style="--subject-color:${esc(ev.color)}"><span>🎓</span><div><strong>${esc(ev.subject?.code || ev.subject?.name || "Subject")} · ${esc(c.class_type || "Class")}</strong><p>${time} · ${esc(c.room || "Room TBA")}</p></div></div>`;
      }).join("")}
    </div>` : "";
  const projectsHtml = dayProjects.length ? `
    <div class="calendar-uni-list">
      <h4>Projects</h4>
      ${dayProjects.map(({ item, project }) => `
        <div class="calendar-uni-event" style="--subject-color:#8a63ff">
          <span>${esc(project?.icon || "📂")}</span>
          <div><strong>${esc(item.title)}</strong><p>${esc(project?.name || "Project")} · Project item due</p></div>
        </div>`).join("")}
    </div>` : "";
  const routinesHtml = dayRoutines.length ? `
    <div class="calendar-uni-list">
      <h4>Routines</h4>
      ${dayRoutines.map((routine) => {
        const stepCount = routineSteps.filter((step) => step.routine_id === routine.id).length;
        return `<div class="calendar-uni-event" style="--subject-color:#18c2c2"><span>${esc(routine.icon || "🔁")}</span><div><strong>${esc(routine.name)}</strong><p>${stepCount} step${stepCount === 1 ? "" : "s"} · Scheduled routine</p></div></div>`;
      }).join("")}
    </div>` : "";
  const eventsHtml = eventsPanelHTML(selectedDate);
  const shiftsHtml = shiftsPanelHTML(selectedDate);
  panel.innerHTML = `
    <div class="section-head">
      <h3>${pretty}</h3>
      <div class="day-actions">
        <button class="btn-ghost" id="addShiftOnDay">+ Shift</button>
        <button class="btn-ghost" id="addEventOnDay">+ Event</button>
        <button class="btn-ghost" id="addOnDay">+ Task</button>
      </div>
    </div>
    ${shiftsHtml}
    ${eventsHtml}
    ${uniHtml}
    ${projectsHtml}
    ${routinesHtml}
    <div class="task-list">${dayTasks.length
      ? dayTasks.map(taskHTML).join("")
      : (!uniItems.length && !breakInfo && !eventsHtml && !shiftsHtml && !dayProjects.length && !dayRoutines.length ? `<div class="empty"><span class="emoji">🗓️</span>Nothing planned — a rare free day!</div>` : "")}</div>`;
  $("addOnDay").addEventListener("click", () => openModal(null, selectedDate));
  $("addEventOnDay").addEventListener("click", () => openEventModal(null, selectedDate));
  $("addShiftOnDay").addEventListener("click", () => openShiftModal(null, selectedDate));
  wireTaskEvents(panel);
  wireEventPanel(panel);
  wireShiftPanel(panel);
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
      if (inUse) {
        const ok = await confirmDialog({
          title: "Delete priority?",
          message: `${inUse} task(s) use this label. They'll become uncoloured.`,
          okText: "Delete priority"
        });
        if (!ok) return;
      }
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

  // A Google-only account has no Prio password, and its email is managed
  // by Google — so hide those cards rather than showing dead controls.
  if (isGoogleAccount()) {
    const pwCard = $("profilePassword")?.closest(".card");
    if (pwCard) pwCard.style.display = "none";
    const emailCard = $("profileEmail")?.closest(".card");
    if (emailCard && !emailCard.querySelector(".google-managed")) {
      $("profileEmail").disabled = true;
      $("saveEmailBtn").style.display = "none";
      const note = document.createElement("p");
      note.className = "google-managed";
      note.innerHTML = '<span class="g-chip">Google account</span> Your email is managed by Google.';
      emailCard.appendChild(note);
    }
  }
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
    b.addEventListener("click", () => { switchView(b.dataset.view); setMenu(false); }));
  $("avatarBtn").addEventListener("click", () => { switchView("profile"); setMenu(false); });
  if ($("homeLogoBtn")) $("homeLogoBtn").addEventListener("click", () => switchView("home"));
  if ($("menuBtn")) $("menuBtn").addEventListener("click", () => setMenu(!$('menuBackdrop').classList.contains("open")));
  if ($("menuClose")) $("menuClose").addEventListener("click", () => setMenu(false));
  if ($("menuBackdrop")) $("menuBackdrop").addEventListener("click", (e) => { if (e.target.id === "menuBackdrop") setMenu(false); });

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

  $("openGuideBtn")?.addEventListener("click", () => openOnboardingGuide(true));

  $("logoutBtn").addEventListener("click", async () => {
    await db.auth.signOut();
    window.location.href = "index.html";
  });

  $("sundayReviewBtn")?.addEventListener("click", openSundayReview);
  $("reviewClose")?.addEventListener("click", closeSundayReview);
  $("reviewCancel")?.addEventListener("click", closeSundayReview);
  $("reviewSave")?.addEventListener("click", saveSundayReview);
  $("reviewModal")?.addEventListener("click", (e) => { if (e.target.id === "reviewModal") closeSundayReview(); });
  $("themeResetBtn")?.addEventListener("click", () => setTheme(defaultTheme));
}


// ============================================
// V1.2 · Prio tour — SVG-mask onboarding
// The dark layer is ONE SVG with a rounded hole cut through it via a
// mask. The highlighted element is simply revealed through the hole,
// so it never needs z-index changes — which is what broke the old
// approach inside animated cards (transforms create stacking contexts
// that trap z-index). The hole glides between targets with a tween.
// ============================================
const TOUR_STEPS = [
  { icon: "👋", title: "Welcome to Prio", text: "Your day, in colour. Here's a 45-second tour of the essentials — tap anywhere to move on, or skip anytime.", view: "home", target: null },
  { icon: "＋", title: "Add anything, anywhere", text: "This button follows you around Home, Planner and Calendar. Tap it the moment something pops into your head.", view: "tasks", target: "#fabBtn" },
  { icon: "🔎", title: "Focus your list", text: "When the planner gets busy, filter by priority colour or peek at what you've already finished.", view: "tasks", target: "#filterTrigger" },
  { icon: "📅", title: "One calendar for everything", text: "Tasks, uni assessments and timetable classes all land here. This button snaps you back to today.", view: "calendar", target: "#calToday" },
  { icon: "🎓", title: "Set your semester", text: "Add your semester dates and breaks so uni classes show up on exactly the right weeks.", view: "uni", target: "#editSemesterBtn" },
  { icon: "👤", title: "Make it yours", text: "Profile holds your account settings — and you can replay this tour from there whenever you like.", view: "home", target: "#avatarBtn" },
];

let tourIndex = 0;
let tourAnim = null;
let tourHoleBox = null; // current hole geometry {x,y,w,h,r}
let tourSettleTimer = null;
let tourSettling = false;

function onboardingKey() {
  return user?.id ? `prio_onboarding_seen_${user.id}` : "prio_onboarding_seen";
}
function tourPrefersStill() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function initOnboardingGuide() {
  if (!localStorage.getItem(onboardingKey())) setTimeout(() => openOnboardingGuide(false), 900);
}

function buildTour() {
  if ($("tourVeil")) return;
  const wrap = document.createElement("div");
  wrap.id = "tourVeil";
  wrap.innerHTML = `
    <svg class="tour-svg" width="100%" height="100%" aria-hidden="true">
      <defs>
        <mask id="tourMask">
          <rect x="0" y="0" width="100%" height="100%" fill="#fff"/>
          <rect id="tourHole" x="-10" y="-10" width="0" height="0" rx="16" fill="#000"/>
        </mask>
      </defs>
      <rect class="tour-shade" x="0" y="0" width="100%" height="100%" mask="url(#tourMask)"/>
      <rect id="tourRing" class="tour-ring" x="-10" y="-10" width="0" height="0" rx="16" fill="none"/>
    </svg>
    <div class="tour-card" id="tourCard" role="dialog" aria-modal="true" aria-live="polite">
      <div class="tour-top">
        <span class="tour-icon" id="tourIcon">✨</span>
        <div class="tour-heading">
          <span class="tour-kicker">Prio tour</span>
          <h2 id="tourTitle"></h2>
        </div>
        <button class="tour-x" id="tourX" aria-label="Close tour">✕</button>
      </div>
      <p class="tour-text" id="tourText"></p>
      <div class="tour-bottom">
        <div class="tour-dots" id="tourDots"></div>
        <div class="tour-btns">
          <button class="tour-btn ghost" id="tourBack">Back</button>
          <button class="tour-btn primary" id="tourNext">Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  $("tourX").addEventListener("click", () => closeTour(true));
  $("tourBack").addEventListener("click", (e) => { e.stopPropagation(); tourGo(tourIndex - 1); });
  $("tourNext").addEventListener("click", (e) => { e.stopPropagation(); tourGo(tourIndex + 1); });
  // tap the dark veil (or the highlighted spot) to advance
  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".tour-card")) return;
    tourGo(tourIndex + 1);
  });
  document.addEventListener("keydown", tourKeys);
  window.addEventListener("resize", tourReflow, { passive: true });
  window.addEventListener("scroll", tourReflow, { passive: true, capture: true });
}

function tourKeys(e) {
  if (!$("tourVeil")?.classList.contains("open")) return;
  if (e.key === "Escape") closeTour(true);
  else if (e.key === "ArrowRight" || e.key === "Enter") tourGo(tourIndex + 1);
  else if (e.key === "ArrowLeft") tourGo(tourIndex - 1);
}

function openOnboardingGuide(manual = false) {
  buildTour();
  tourIndex = 0;
  tourHoleBox = null;
  $("tourVeil").classList.add("open");
  showTourStep(0, true);
}

function tourGo(next) {
  if (next < 0) return;
  if (next >= TOUR_STEPS.length) return closeTour(true, true);
  showTourStep(next);
}

function closeTour(markSeen = false, finished = false) {
  if (tourAnim) cancelAnimationFrame(tourAnim);
  clearTimeout(tourSettleTimer);
  $("tourVeil")?.classList.remove("open");
  if (markSeen) localStorage.setItem(onboardingKey(), "1");
  if (finished) toast("Tour done! Replay it anytime from Profile ✨");
  else if (markSeen) toast("Tour saved — reopen it from Profile ✨");
}

function tourFindTarget(step) {
  if (!step.target) return null;
  const el = document.querySelector(step.target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none") return null;
  return el;
}

function showTourStep(i, instant = false) {
  tourIndex = Math.max(0, Math.min(i, TOUR_STEPS.length - 1));
  const step = TOUR_STEPS[tourIndex];

  if (typeof setMenu === "function") setMenu(false);
  if (step.view) switchView(step.view);
  if (typeof closePlannerFilter === "function") closePlannerFilter();

  // Critical: every Next/Back step starts from the real DOM target again.
  // Never reuse an already-expanded tour rectangle, otherwise the mobile
  // spotlight grows each time you go Back -> Next -> Back.
  if (tourAnim) cancelAnimationFrame(tourAnim);
  tourAnim = null;
  tourHoleBox = null;

  // let the view render, scroll the target into place, then measure
  clearTimeout(tourSettleTimer);
  tourSettling = true;
  tourSettleTimer = setTimeout(() => {
    const el = tourFindTarget(step);
    if (el) {
      const pos = window.getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "sticky") el.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    }
    tourSettleTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        tourSettling = false;
        // New steps should snap to the freshly measured target first; this
        // prevents a visible slide from an old mobile rectangle when going Back.
        placeTourStep(step, tourFindTarget(step), true, true);
      });
    }, el ? 80 : 20);
  }, 120);
}

function placeTourStep(step, el, instant, fresh = false) {
  // ---- card content (skip on scroll/resize reflows so the card doesn't flicker) ----
  if (fresh) {
  $("tourIcon").textContent = step.icon;
  $("tourTitle").textContent = step.title;
  $("tourText").textContent = step.text;
  $("tourDots").innerHTML = TOUR_STEPS.map((_, d) =>
    `<i class="${d === tourIndex ? "on" : ""}${d < tourIndex ? " past" : ""}"></i>`).join("");
  $("tourBack").style.visibility = tourIndex === 0 ? "hidden" : "visible";
  $("tourNext").textContent =
    tourIndex === 0 ? "Let's go" : tourIndex === TOUR_STEPS.length - 1 ? "Finish" : "Next";
  }

  // ---- hole geometry ----
  let box = null;
  if (el) {
    // Always measure the live element on the current frame. This avoids the
    // mobile Back/Next drift where the old rectangle was reused after the
    // planner view had re-rendered.
    const r = el.getBoundingClientRect();
    const isFilter = step.target === "#filterTrigger";
    const isFab = step.target === "#fabBtn";

    // The filter is a pill with its own shadow. On mobile, adding extra
    // padding makes the tour ring look like it is drifting downward. Keep
    // this one exact. Other targets can still breathe.
    const pad = isFilter ? 0 : isFab ? 6 : 8;
    const br = parseFloat(window.getComputedStyle(el).borderTopLeftRadius) || 16;
    const x = r.left - pad;
    const y = r.top - pad;
    const w = r.width + pad * 2;
    const h = r.height + pad * 2;
    const round = br >= Math.min(r.width, r.height) / 2 - 1; // pills & circles
    box = {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      r: round ? Math.min(w, h) / 2 : Math.min(Math.max(br + pad, 14), 24),
    };
  }
  moveTourHole(box, instant || tourPrefersStill());

  // ---- card placement ----
  const card = $("tourCard");
  card.classList.remove("centered");
  if (fresh) {
    card.classList.remove("pop");
    void card.offsetWidth; // restart entrance animation
    card.classList.add("pop");
  }

  const mobile = window.innerWidth <= 640;
  if (mobile) {
    // Mobile is normally a bottom sheet, but the FAB lives bottom-right, so the
    // sheet must move above it instead of covering the target.
    card.style.left = "";
    card.style.right = "";
    card.style.top = "";
    card.style.bottom = "";
    card.dataset.mobileDock = box ? (step.target === "#fabBtn" ? "above-target" : "bottom") : "center";
    if (!box) {
      card.classList.add("centered");
      return;
    }
    if (step.target === "#fabBtn") {
      card.style.left = "12px";
      card.style.right = "12px";
      const lift = Math.max(12, window.innerHeight - box.y + 18);
      card.style.setProperty("--tour-mobile-bottom", `${lift}px`);
      card.style.bottom = `${lift}px`;
      return;
    }
    return;
  }

  if (!box) {
    card.classList.add("centered");
    card.style.left = "";
    card.style.top = "";
    return;
  }

  // desktop: measure, then prefer below → above → right → left
  card.style.left = "-9999px";
  card.style.top = "0px";
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  const gap = 14, m = 12;
  let left, top;
  if (box.y + box.h + gap + ch <= vh - m) {          // below
    top = box.y + box.h + gap;
    left = box.x + box.w / 2 - cw / 2;
  } else if (box.y - gap - ch >= m) {                 // above
    top = box.y - gap - ch;
    left = box.x + box.w / 2 - cw / 2;
  } else if (box.x + box.w + gap + cw <= vw - m) {    // right
    left = box.x + box.w + gap;
    top = box.y + box.h / 2 - ch / 2;
  } else {                                            // left
    left = box.x - gap - cw;
    top = box.y + box.h / 2 - ch / 2;
  }
  card.style.left = Math.max(m, Math.min(left, vw - cw - m)) + "px";
  card.style.top = Math.max(m, Math.min(top, vh - ch - m)) + "px";
}

function moveTourHole(box, instant) {
  const hole = $("tourHole"), ring = $("tourRing");
  if (!hole) return;
  // no target → shrink the hole away and hide the ring
  const to = box || {
    x: window.innerWidth / 2, y: window.innerHeight / 2, w: 0, h: 0, r: 16,
  };
  ring.style.opacity = box ? "" : "0";

  const from = tourHoleBox || { x: to.x + to.w / 2, y: to.y + to.h / 2, w: 0, h: 0, r: to.r };
  tourHoleBox = to;
  if (tourAnim) cancelAnimationFrame(tourAnim);

  const apply = (b) => {
    for (const [attr, val] of [["x", b.x], ["y", b.y], ["width", b.w], ["height", b.h], ["rx", b.r]]) {
      hole.setAttribute(attr, val);
      ring.setAttribute(attr, val);
    }
  };
  if (instant) return apply(to);

  const t0 = performance.now(), dur = 380;
  const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic
  const tick = (now) => {
    const p = ease(Math.min((now - t0) / dur, 1));
    apply({
      x: from.x + (to.x - from.x) * p,
      y: from.y + (to.y - from.y) * p,
      w: from.w + (to.w - from.w) * p,
      h: from.h + (to.h - from.h) * p,
      r: from.r + (to.r - from.r) * p,
    });
    if (p < 1) tourAnim = requestAnimationFrame(tick);
  };
  tourAnim = requestAnimationFrame(tick);
}

function tourReflow() {
  if (!$("tourVeil")?.classList.contains("open") || tourSettling) return;
  const step = TOUR_STEPS[tourIndex];
  const el = tourFindTarget(step);
  placeTourStep(step, el, true, false);
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
// PRIO · Quote of the day
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
// PRIO · Priority tiers (red / yellow / green)
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

// Highest priority first. Ranking follows the priority's `position`
// (High=2 > Medium=1 > Low=0), the same rule tierOf() uses. Tasks with no
// priority sink to the bottom; ties fall back to due date, then newest.
function byPriorityDesc(a, b) {
  const rank = (t) => {
    const p = prioById(t.priority_id);
    return p ? (p.position ?? 0) : -1;
  };
  const diff = rank(b) - rank(a);
  if (diff !== 0) return diff;

  // same priority: soonest due date first, undated last
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

function todaysTasks() {
  const today = todayStr();
  return tasks.filter((t) => (t.scope || "daily") === "daily" && t.due_date === today);
}

// ============================================
// PRIO · Dashboard renders
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
// PRIO · Habits & streaks
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
  const ok = await confirmDialog({ title: "Delete habit?", message: `Delete "${h.name}" and its streak history?`, okText: "Delete habit" });
  if (!ok) return;
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
// PRIO · Brain dump (autosave)
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
// PRIO · Planner tabs + dashboard events
// ============================================
function syncPlannerTabs() {
  $("plannerTabs").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.scope === activeScope));
  const isDump = activeScope === "dump";
  $("plannerBody").style.display = isDump ? "none" : "block";
  $("dumpBody").style.display = isDump ? "block" : "none";
  $("fabBtn").style.display = isDump ? "none" : "grid";
  $("routineToday").style.display = "none";
}

function wirePrioEvents() {
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
  const ok = await confirmDialog({ title: "Delete project?", message: `Delete "${p.name}"${count ? ` and its ${count} item(s)` : ""}? This can't be undone.`, okText: "Delete project" });
  if (!ok) return;
  const { error } = await db.from("projects").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  projects = projects.filter((x) => x.id !== id);
  projectSections = projectSections.filter((s) => s.project_id !== id);
  projectItems = projectItems.filter((i) => i.project_id !== id);
  openProjectId = null;
  renderProjects();
  renderCalendar();
  toast("Project deleted");
}

// ---------- sections ----------
async function addSection(projectId, parentId) {
  const name = await promptDialog({ title: "New section", placeholder: "e.g. Assessments" });
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
  const name = await promptDialog({ title: "Rename section", value: s.name, placeholder: "Section name" });
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
  const ok = await confirmDialog({ title: "Delete section?", message: `Delete section "${s.name}"${count ? ` and its ${count} item(s)` : ""}?`, okText: "Delete section" });
  if (!ok) return;
  const { error } = await db.from("project_sections").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  projectSections = projectSections.filter((x) => !ids.includes(x.id));
  projectItems = projectItems.filter((i) => !ids.includes(i.section_id));
  renderProjects();
  renderCalendar();
}

// ---------- project items ----------
function openPitemModal(projectId, sectionId, itemId = null) {
  pitemCtx = { projectId, sectionId: sectionId || null, itemId };
  const it = itemId ? projectItems.find((x) => x.id === itemId) : null;
  $("pitemModalTitle").textContent = it ? "Edit item" : "New item";
  $("pitemTitle").value = it ? it.title : "";
  $("pitemNotes").value = it ? it.notes || "" : "";
  $("pitemLink").value = it ? it.link || "" : "";
  setDateInput("pitemDate", it ? it.due_date || "" : "");
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
    due_date: $("pitemDate").dataset.iso || $("pitemDate").value || null,
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
  const savedProjectItem = pitemCtx.itemId ? projectItems.find((x) => x.id === pitemCtx.itemId) : data;
  toast(pitemCtx.itemId ? "Item updated" : "Item added ✨");
  pitemCtx = null;
  renderProjects();
  renderCalendar();
  if (savedProjectItem) gcalAutoSync("project", savedProjectItem);
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
  renderCalendar();
  gcalAutoSync("project", it);
}

async function deletePitem(id) {
  gcalAutoRemove("project", id);
  const { error } = await db.from("project_items").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  projectItems = projectItems.filter((x) => x.id !== id);
  renderProjects();
  renderCalendar();
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
  if (!wrap) return;
  // Keep the Planner clean: routines live in the Routines tab, not above Daily tasks.
  wrap.innerHTML = "";
  wrap.style.display = "none";
  return;

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
  const title = await promptDialog({ title: "Rename today's step", message: "This only changes today's copy.", value: s.title, placeholder: "Step name" });
  if (!title || title === s.title) return;
  const { error } = await db.from("routine_day_steps").update({ title }).eq("id", id);
  if (error) return toast("Couldn't save — try again");
  s.title = title;
  renderTodayRoutines();
  renderPhase4();
  renderThemeStudio();
}

async function removeDayStep(id) {
  const { error } = await db.from("routine_day_steps").delete().eq("id", id);
  if (error) return toast("Couldn't remove — try again");
  dayRoutineSteps = dayRoutineSteps.filter((x) => x.id !== id);
  renderTodayRoutines();
  toast("Removed for today");
}

async function addDayStep(routineId) {
  const title = await promptDialog({ title: "Add today's step", message: "This only adds it for today.", placeholder: "e.g. Pack bag" });
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
  renderPhase4();
  renderThemeStudio();
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
  const title = await promptDialog({ title: "Add routine step", placeholder: "e.g. Drink water" });
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
  const savedRoutineId = editingRoutineId || openRoutineId;
  $("routineModal").classList.remove("open");
  toast(editingRoutineId ? "Routine updated" : "Routine created 🔁");
  editingRoutineId = null;
  await ensureTodayRoutines(); // if it runs today, it shows up today
  renderRoutines();
  renderUni();
  renderTodayRoutines();
  const savedRoutine = routines.find((x) => x.id === savedRoutineId);
  if (savedRoutine) gcalAutoSync("routine", savedRoutine);
  renderCalendar();
  renderPhase4();
  renderThemeStudio();
}

async function deleteRoutine(id) {
  const r = routines.find((x) => x.id === id);
  const ok = await confirmDialog({ title: "Delete routine?", message: `Delete "${r.name}" and all its history?`, okText: "Delete routine" });
  if (!ok) return;
  gcalAutoRemove("routine", id);
  const { error } = await db.from("routines").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  routines = routines.filter((x) => x.id !== id);
  routineSteps = routineSteps.filter((s) => s.routine_id !== id);
  dayRoutineSteps = dayRoutineSteps.filter((s) => s.routine_id !== id);
  openRoutineId = null;
  renderRoutines();
  renderUni();
  renderTodayRoutines();
  renderCalendar();
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

// ============================================
// Modern date picker
// ============================================
let datePickerTargetId = null;
let datePickerCursor = new Date();

function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prettyDateValue(iso) {
  const d = parseISODate(iso);
  if (!d) return "";
  // Drop the year when it's the current year — keeps the field uncluttered
  // and stops long dates from clipping in narrow columns.
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
function setDateInput(id, iso) {
  const el = $(id);
  if (!el) return;
  el.dataset.iso = iso || "";
  el.value = prettyDateValue(iso);
}
const DATE_PICKER_KICKERS = {
  eventDate: "Event date",
  taskDate: "Due date",
  pitemDate: "Deadline",
  uniAssessmentDate: "Due date",
  semesterStartDate: "Semester starts",
  semesterEndDate: "Semester ends",
  semesterBreakStart: "Break starts",
  semesterBreakEnd: "Break ends",
};
function openDatePicker(targetId) {
  datePickerTargetId = targetId;
  const current = parseISODate($(targetId)?.dataset.iso || $(targetId)?.value);
  datePickerCursor = current || new Date();
  const kicker = document.querySelector("#datePickerModal .modal-kicker");
  if (kicker) kicker.textContent = DATE_PICKER_KICKERS[targetId] || "Date";
  renderDatePicker();
  $("datePickerModal").classList.add("open");
}
function closeDatePicker() { $("datePickerModal")?.classList.remove("open"); datePickerTargetId = null; }
function chooseDate(iso) {
  if (datePickerTargetId === "shiftDate") {
    setDateInput("shiftDate", iso);
    closeDatePicker();
    renderShiftSummary();
    return;
  }
  if (datePickerTargetId) setDateInput(datePickerTargetId, iso);
  closeDatePicker();
}
function renderDatePicker() {
  const y = datePickerCursor.getFullYear();
  const m = datePickerCursor.getMonth();
  $("dateMonthLabel").textContent = datePickerCursor.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const selected = datePickerTargetId ? ($(datePickerTargetId).dataset.iso || "") : "";
  const today = todayStr();
  const first = new Date(y, m, 1);
  const firstDowMon = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  let html = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="date-dow">${d}</div>`).join("");
  for (let i = 0; i < firstDowMon; i++) html += `<div class="date-cell blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    html += `<button type="button" class="date-cell ${iso === today ? "today" : ""} ${iso === selected ? "selected" : ""}" data-date="${iso}">${d}</button>`;
  }
  $("datePickerGrid").innerHTML = html;
  $("datePickerGrid").querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", () => chooseDate(b.dataset.date)));
}


// ============================================
// Friendly custom selects (keeps the real select for saving)
// ============================================
function closePrettySelects(except = null) {
  document.querySelectorAll(".pretty-select.open").forEach((box) => {
    if (box !== except) box.classList.remove("open");
  });
}
function renderPrettySelect(id) {
  const select = $(id);
  if (!select) return;
  const box = document.querySelector(`[data-pretty-for="${id}"]`);
  if (!box) return initPrettySelect(id);
  const trigger = box.querySelector(".pretty-select-trigger");
  const menu = box.querySelector(".pretty-select-menu");
  const selectedOption = select.options[select.selectedIndex];
  trigger.textContent = selectedOption ? selectedOption.textContent : "Choose";
  menu.innerHTML = Array.from(select.options).map((opt) => `
    <button type="button" class="pretty-option ${opt.selected ? "selected" : ""}" data-value="${esc(opt.value)}">
      ${esc(opt.textContent)}
    </button>`).join("");
  menu.querySelectorAll(".pretty-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      select.value = btn.dataset.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      renderPrettySelect(id);
      box.classList.remove("open");
    });
  });
}
function initPrettySelect(id) {
  const select = $(id);
  if (!select || select.dataset.prettyReady) return renderPrettySelect(id);
  select.dataset.prettyReady = "1";
  select.classList.add("native-select-hidden");
  const box = document.createElement("div");
  box.className = "pretty-select";
  box.dataset.prettyFor = id;
  box.innerHTML = `<button type="button" class="pretty-select-trigger">Choose</button><div class="pretty-select-menu"></div>`;
  select.insertAdjacentElement("afterend", box);
  box.querySelector(".pretty-select-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !box.classList.contains("open");
    closePrettySelects(box);
    box.classList.toggle("open", opening);
  });
  renderPrettySelect(id);
}
function initPrettySelects() {
  ["uniClassSubject", "uniClassDay", "uniAssessmentSubject", "uniAssessmentType"].forEach(initPrettySelect);
}
document.addEventListener("click", () => closePrettySelects());

function wireDatePickerEvents() {
  ["taskDate", "pitemDate", "uniAssessmentDate", "semesterStartDate", "semesterEndDate", "semesterBreakStart", "semesterBreakEnd"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("click", () => openDatePicker(id));
  });
  $("datePickerClose")?.addEventListener("click", closeDatePicker);
  $("datePickerModal")?.addEventListener("click", (e) => { if (e.target.id === "datePickerModal") closeDatePicker(); });
  $("datePrev")?.addEventListener("click", () => { datePickerCursor.setMonth(datePickerCursor.getMonth() - 1); renderDatePicker(); });
  $("dateNext")?.addEventListener("click", () => { datePickerCursor.setMonth(datePickerCursor.getMonth() + 1); renderDatePicker(); });
  document.querySelectorAll(".quick-date-row [data-quick]").forEach((b) => b.addEventListener("click", () => {
    const now = new Date();
    if (b.dataset.quick === "clear") return chooseDate("");
    if (b.dataset.quick === "tomorrow") now.setDate(now.getDate() + 1);
    if (b.dataset.quick === "weekend") {
      const day = now.getDay();
      const add = day === 6 ? 0 : (6 - day + 7) % 7;
      now.setDate(now.getDate() + add);
    }
    chooseDate(toISODate(now));
  }));
}

// ============================================
// Phase 3 · University dashboard
// ============================================
let editingUniSubjectId = null;
let editingUniClassId = null;
let editingUniAssessmentId = null;
let uniStepAssessmentId = null;
let editingUniStepId = null;

async function loadUni() {
  try {
    const [subjectsRes, classesRes, assessmentsRes, stepsRes] = await Promise.all([
      db.from("uni_subjects").select("*").eq("user_id", user.id).order("position"),
      db.from("uni_classes").select("*").eq("user_id", user.id),
      db.from("uni_assessments").select("*").eq("user_id", user.id).order("position"),
      db.from("uni_assessment_steps").select("*").eq("user_id", user.id).order("position"),
    ]);
    uniSubjects = subjectsRes.data || [];
    uniClasses = classesRes.data || [];
    uniAssessments = assessmentsRes.data || [];
    assessmentSteps = stepsRes.data || [];
  } catch (err) {
    console.warn("Uni tables not ready yet:", err);
    uniSubjects = []; uniClasses = []; uniAssessments = []; assessmentSteps = [];
  }
}
function assessmentProgress(aid) {
  const steps = assessmentSteps.filter((s) => s.assessment_id === aid);
  if (!steps.length) return 0;
  return Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
}
function daysUntil(iso) {
  if (!iso) return "No date";
  const today = parseISODate(todayStr());
  const d = parseISODate(iso);
  const diff = Math.ceil((d - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${Math.abs(diff)} day(s) late`;
  return `${diff} day(s)`;
}
function renderUni() {
  const root = $("uniRoot");
  if (!root) return;
  const totalAssessments = uniAssessments.length;
  const avgProgress = totalAssessments ? Math.round(uniAssessments.reduce((sum, a) => sum + assessmentProgress(a.id), 0) / totalAssessments) : 0;
  const upcoming = [...uniAssessments].filter((a) => a.due_date).sort((a,b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  const semesterSettings = getUniSemesterSettings();
  const semesterReady = hasSemesterOverview();
  const semesterTitle = semesterReady ? (semesterSettings.name || "Semester") : "Add Semester";
  const semesterNote = semesterReady ? (semesterSettings.notes || "Dates • Breaks • Calendar") : "Dates • Breaks • Calendar";
  const semesterActionIcon = semesterReady
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/></svg>`
    : `<span class="semester-plus-icon">+</span>`;
  root.innerHTML = `
    <div class="section-head"><h2>🎓 Uni Dashboard</h2><div class="uni-head-actions"><button class="btn-ghost" id="addUniSubjectBtn">+ Subject</button></div></div>
    <div class="uni-hero card span2 semester-overview-card ${semesterReady ? "has-semester" : "is-empty"}">
      <div class="semester-overview-actions" aria-label="Semester actions">
        <button class="icon-btn edit semester-icon-action" id="editSemesterBtn" title="${semesterReady ? "Edit semester" : "Add semester"}" aria-label="${semesterReady ? "Edit semester" : "Add semester"}" type="button">
          ${semesterActionIcon}
        </button>
        ${semesterReady ? `<button class="icon-btn del semester-icon-action semester-clear-x" id="resetSemesterBtn" title="Clear semester" aria-label="Clear semester" type="button">×</button>` : ""}
      </div>
      <div>
        <p class="modal-kicker">Semester overview ${semesterReady && semesterWeekText() ? `· ${esc(semesterWeekText())}` : ""}</p>
        <h2>${esc(semesterTitle)}</h2>
        <p class="uni-muted semester-brief">${esc(semesterNote)}</p>
        ${semesterReady ? `<div class="semester-chip-row"><span>🗓️ ${esc(semesterSummary())}</span><span>🌿 ${esc(semesterBreakSummary())}</span></div>` : ""}
      </div>
      <div class="uni-big-progress"><div style="width:${avgProgress}%"></div></div>
    </div>
    <div class="dash-grid uni-grid">
      <div class="card span2"><div class="section-head"><h3>Subjects</h3><button class="btn-ghost" id="addUniClassBtn">+ Class</button></div>
        ${uniSubjects.length ? uniSubjects.map((s) => {
          const classes = uniClasses.filter((c) => c.subject_id === s.id).length;
          const assessments = uniAssessments.filter((a) => a.subject_id === s.id).length;
          return `<div class="uni-subject-row" style="--subject-color:${esc(s.color || '#4353ff')}"><div><strong>${esc(s.code ? `${s.code} · ${s.name}` : s.name)}</strong><p>${classes} class(es) · ${assessments} assessment(s)</p></div><div class="row-actions"><button class="icon-btn" data-edit-subject="${s.id}">✎</button><button class="icon-btn" data-delete-subject="${s.id}">×</button></div></div>`;
        }).join("") : `<div class="empty"><span class="emoji">📚</span>Add your first subject to unlock the dashboard.</div>`}
      </div>
      <div class="card"><div class="section-head"><h3>Timetable</h3></div>${renderUniTimetable()}</div>
      <div class="card"><div class="section-head"><h3>Upcoming</h3><button class="btn-ghost" id="addUniAssessmentBtn">+ Assessment</button></div>
        ${upcoming.length ? upcoming.map((a) => renderAssessmentMini(a)).join("") : `<div class="empty"><span class="emoji">📝</span>Add assessments with due dates and weighting.</div>`}
      </div>
      <div class="card span2"><div class="section-head"><h3>Assessment breakdown</h3></div>${renderAssessmentBreakdowns()}</div>
    </div>`;
  wireUniDynamicEvents();
}
function renderUniTimetable() {
  if (!uniClasses.length) return `<div class="empty"><span class="emoji">🗓️</span>Your weekly class times and rooms will show here.</div>`;
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return [...uniClasses].sort((a,b) => (a.day_of_week-b.day_of_week) || String(a.start_time||"").localeCompare(String(b.start_time||""))).map((c) => {
    const s = uniSubjects.find((x) => x.id === c.subject_id);
    const start = esc((c.start_time || '').slice(0,5) || 'TBA');
    const end = c.end_time ? esc(c.end_time.slice(0,5)) : '';
    const cls = String(c.class_type || 'Class').toLowerCase().includes('lab') ? 'lab' : String(c.class_type || '').toLowerCase().includes('tutorial') ? 'tutorial' : String(c.class_type || '').toLowerCase().includes('workshop') ? 'workshop' : 'lecture';
    return `<div class="uni-mini-card timetable-card ${cls}" style="--subject-color:${esc(s?.color || '#4353ff')}">
      <div class="time-pill"><small>${days[c.day_of_week] || ''}</small><strong>${start}</strong>${end ? `<span>to ${end}</span>` : `<span>Time TBA</span>`}</div>
      <div class="timetable-main"><strong>${esc(s ? (s.code ? `${s.code} · ${s.name}` : s.name) : 'Subject')}</strong><p><span class="class-type-badge">${esc(c.class_type || 'Class')}</span><span class="room-badge">📍 ${esc(c.room || 'Room TBA')}</span></p></div>
      <div class="row-actions"><button class="icon-btn" data-edit-class="${c.id}" title="Edit class">✎</button><button class="icon-btn" data-delete-class="${c.id}" title="Delete class">×</button></div>
    </div>`;
  }).join("");
}
function dueTone(iso) {
  if (!iso) return "none";
  const today = parseISODate(todayStr());
  const d = parseISODate(iso);
  const diff = Math.ceil((d - today) / 86400000);
  if (diff < 0) return "late";
  if (diff <= 2) return "urgent";
  if (diff <= 7) return "soon";
  return "later";
}
function uniDueLabel(iso) {
  if (!iso) return "No date";
  const today = parseISODate(todayStr());
  const d = parseISODate(iso);
  const diff = Math.ceil((d - today) / 86400000);
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} late`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff <= 7) return `${diff} days`;
  return niceDate(iso);
}
function renderDueBadge(iso) {
  const tone = dueTone(iso);
  return `<div class="uni-due-badge ${tone}">${esc(uniDueLabel(iso))}</div>`;
}
function renderAssessmentMini(a) {
  const s = uniSubjects.find((x) => x.id === a.subject_id);
  const progress = assessmentProgress(a.id);
  return `<div class="uni-mini-card assessment-card ${dueTone(a.due_date)}" style="--subject-color:${esc(s?.color || '#4353ff')}">
    <div class="assessment-top"><div><strong>${esc(a.title)}</strong><p>${esc(s?.name || 'Subject')} · ${Number(a.weight || 0)}% · ${esc(a.task_type || 'Individual')}</p></div>${renderDueBadge(a.due_date)}</div>
    <div class="mini-progress"><div style="width:${progress}%"></div></div>
    <div class="row-actions"><button class="btn-ghost" data-add-step="${a.id}">+ Step</button><button class="icon-btn" data-edit-assessment="${a.id}">✎</button><button class="icon-btn" data-delete-assessment="${a.id}">×</button></div>
  </div>`;
}
function renderAssessmentBreakdowns() {
  if (!uniAssessments.length) return `<div class="empty"><span class="emoji">🧩</span>Break assessments into smaller tasks and watch progress climb.</div>`;
  return uniAssessments.map((a) => {
    const s = uniSubjects.find((x) => x.id === a.subject_id);
    const steps = assessmentSteps.filter((st) => st.assessment_id === a.id);
    const progress = assessmentProgress(a.id);
    return `<div class="assessment-block ${dueTone(a.due_date)}" style="--subject-color:${esc(s?.color || '#4353ff')}"><div class="section-head assessment-head"><div><h3>${esc(a.title)}</h3><p class="uni-muted">${esc(s?.name || '')} · ${Number(a.weight || 0)}% · ${esc(a.task_type || 'Individual')} · ${progress}% complete</p></div>${renderDueBadge(a.due_date)}<button class="btn-ghost" data-add-step="${a.id}">+ Step</button></div><div class="mini-progress big"><div style="width:${progress}%"></div></div>${steps.length ? `<div class="uni-step-list">${steps.map((st) => `<label class="uni-step ${st.done ? 'is-done' : ''}"><input type="checkbox" data-toggle-step="${st.id}" ${st.done ? 'checked' : ''}/><span>${esc(st.title)}</span><div class="step-actions"><button type="button" class="icon-btn edit" data-edit-step="${st.id}" title="Edit step">✎</button><button type="button" class="icon-btn del" data-delete-step="${st.id}" title="Delete step">×</button></div></label>`).join("")}</div>` : `<p class="uni-muted no-step-copy">No steps yet. Add a few smaller tasks.</p>`}</div>`;
  }).join("");
}
function fillSubjectSelect(id, selected) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = uniSubjects.map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.code ? `${s.code} · ${s.name}` : s.name)}</option>`).join("");
  renderPrettySelect(id);
}
function openUniSubject(id = null) {
  editingUniSubjectId = id;
  const s = id ? uniSubjects.find((x) => x.id === id) : null;
  $("uniSubjectModalTitle").textContent = s ? "Edit subject" : "New subject";
  $("uniSubjectCode").value = s?.code || "";
  $("uniSubjectName").value = s?.name || "";
  $("uniSubjectColor").value = s?.color || "#4353ff";
  $("uniSubjectModal").classList.add("open");
}
async function saveUniSubject() {
  const name = $("uniSubjectName").value.trim();
  if (!name) return toast("Subject needs a name");
  const payload = { user_id: user.id, code: $("uniSubjectCode").value.trim() || null, name, color: $("uniSubjectColor").value || "#4353ff" };
  let error;
  if (editingUniSubjectId) ({ error } = await db.from("uni_subjects").update(payload).eq("id", editingUniSubjectId));
  else ({ error } = await db.from("uni_subjects").insert({ ...payload, position: uniSubjects.length }));
  if (error) return toast("Couldn't save subject");
  $("uniSubjectModal").classList.remove("open");
  await loadUni(); renderUni(); toast("Subject saved 🎓");
}
function openUniClass(id = null) {
  if (!uniSubjects.length) return toast("Add a subject first");
  editingUniClassId = id;
  const c = id ? uniClasses.find((x) => x.id === id) : null;
  fillSubjectSelect("uniClassSubject", c?.subject_id || uniSubjects[0]?.id);
  $("uniClassType").value = c?.class_type || "";
  $("uniClassDay").value = String(c?.day_of_week ?? 1);
  renderPrettySelect("uniClassDay");
  $("uniClassStart").value = (c?.start_time || "").slice(0,5);
  $("uniClassEnd").value = (c?.end_time || "").slice(0,5);
  $("uniClassRoom").value = c?.room || "";
  $("uniClassModalTitle").textContent = c ? "Edit class" : "New class";
  $("uniClassModal").classList.add("open");
}
async function saveUniClass() {
  const payload = { user_id: user.id, subject_id: $("uniClassSubject").value, class_type: $("uniClassType").value.trim() || "Class", day_of_week: Number($("uniClassDay").value), start_time: $("uniClassStart").value || null, end_time: $("uniClassEnd").value || null, room: $("uniClassRoom").value.trim() || null };
  let error;
  if (editingUniClassId) ({ error } = await db.from("uni_classes").update(payload).eq("id", editingUniClassId));
  else ({ error } = await db.from("uni_classes").insert(payload));
  if (error) return toast("Couldn't save class");
  const savedId = editingUniClassId;
  $("uniClassModal").classList.remove("open"); await loadUni(); renderUni(); renderCalendar(); renderDayPanel(); toast("Class saved 🗓️");
  const savedClass = savedId ? uniClasses.find((x) => x.id === savedId) : uniClasses.at(-1);
  if (savedClass) gcalAutoSync("class", savedClass);
}
function openUniAssessment(id = null) {
  if (!uniSubjects.length) return toast("Add a subject first");
  editingUniAssessmentId = id;
  const a = id ? uniAssessments.find((x) => x.id === id) : null;
  fillSubjectSelect("uniAssessmentSubject", a?.subject_id || uniSubjects[0]?.id);
  $("uniAssessmentTitle").value = a?.title || "";
  setDateInput("uniAssessmentDate", a?.due_date || "");
  $("uniAssessmentWeight").value = a?.weight ?? "";
  $("uniAssessmentType").value = a?.task_type || "Individual";
  renderPrettySelect("uniAssessmentType");
  $("uniAssessmentNotes").value = a?.notes || "";
  $("uniAssessmentModalTitle").textContent = a ? "Edit assessment" : "New assessment";
  $("uniAssessmentModal").classList.add("open");
}
async function saveUniAssessment() {
  const title = $("uniAssessmentTitle").value.trim();
  if (!title) return toast("Assessment needs a title");
  const payload = { user_id: user.id, subject_id: $("uniAssessmentSubject").value, title, due_date: $("uniAssessmentDate").dataset.iso || null, weight: Number($("uniAssessmentWeight").value || 0), task_type: $("uniAssessmentType").value, notes: $("uniAssessmentNotes").value.trim() || null };
  let error;
  if (editingUniAssessmentId) ({ error } = await db.from("uni_assessments").update(payload).eq("id", editingUniAssessmentId));
  else ({ error } = await db.from("uni_assessments").insert({ ...payload, position: uniAssessments.length }));
  if (error) return toast("Couldn't save assessment");
  const savedId = editingUniAssessmentId;
  $("uniAssessmentModal").classList.remove("open"); await loadUni(); renderUni(); renderCalendar(); renderDayPanel(); toast("Assessment saved 📝");
  const savedAssessment = savedId ? uniAssessments.find((x) => x.id === savedId) : uniAssessments.at(-1);
  if (savedAssessment) gcalAutoSync("assessment", savedAssessment);
}
function openUniStep(aid, stepId = null) {
  uniStepAssessmentId = aid;
  editingUniStepId = stepId;
  const st = stepId ? assessmentSteps.find((x) => x.id === stepId) : null;
  const titleEl = $("uniStepModalTitle");
  if (titleEl) titleEl.textContent = st ? "Edit breakdown task" : "Add breakdown task";
  $("uniStepTitle").value = st?.title || "";
  $("uniStepModal").classList.add("open");
  setTimeout(() => $("uniStepTitle").focus(), 150);
}
async function saveUniStep() {
  const title = $("uniStepTitle").value.trim();
  if (!title) return toast("Step needs a title");
  let error;
  if (editingUniStepId) {
    ({ error } = await db.from("uni_assessment_steps").update({ title }).eq("id", editingUniStepId));
  } else {
    const count = assessmentSteps.filter((s) => s.assessment_id === uniStepAssessmentId).length;
    ({ error } = await db.from("uni_assessment_steps").insert({ user_id: user.id, assessment_id: uniStepAssessmentId, title, position: count }));
  }
  if (error) return toast("Couldn't save step");
  $("uniStepModal").classList.remove("open");
  await loadUni(); renderUni(); toast(editingUniStepId ? "Step updated ✓" : "Step added ✓");
  editingUniStepId = null;
}
async function deleteRow(table, id, msg) {
  const ok = await confirmDialog({ title: msg, message: "This can't be undone.", okText: "Delete" });
  if (!ok) return;
  if (table === "uni_classes") gcalAutoRemove("class", id);
  if (table === "uni_assessments") gcalAutoRemove("assessment", id);
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) return toast("Couldn't delete");
  await loadUni(); renderUni(); renderCalendar(); renderDayPanel(); toast("Deleted");
}
function wireUniDynamicEvents() {
  $("addUniSubjectBtn")?.addEventListener("click", () => openUniSubject());
  $("editSemesterBtn")?.addEventListener("click", openSemesterModal);
  $("resetSemesterBtn")?.addEventListener("click", clearSemesterOverview);
  $("addUniClassBtn")?.addEventListener("click", () => openUniClass());
  $("addUniAssessmentBtn")?.addEventListener("click", () => openUniAssessment());
  document.querySelectorAll("[data-edit-subject]").forEach((b) => b.addEventListener("click", () => openUniSubject(b.dataset.editSubject)));
  document.querySelectorAll("[data-delete-subject]").forEach((b) => b.addEventListener("click", () => deleteRow("uni_subjects", b.dataset.deleteSubject, "Delete subject?")));
  document.querySelectorAll("[data-edit-class]").forEach((b) => b.addEventListener("click", () => openUniClass(b.dataset.editClass)));
  document.querySelectorAll("[data-delete-class]").forEach((b) => b.addEventListener("click", () => deleteRow("uni_classes", b.dataset.deleteClass, "Delete class?")));
  document.querySelectorAll("[data-edit-assessment]").forEach((b) => b.addEventListener("click", () => openUniAssessment(b.dataset.editAssessment)));
  document.querySelectorAll("[data-delete-assessment]").forEach((b) => b.addEventListener("click", () => deleteRow("uni_assessments", b.dataset.deleteAssessment, "Delete assessment?")));
  document.querySelectorAll("[data-add-step]").forEach((b) => b.addEventListener("click", () => openUniStep(b.dataset.addStep)));
  document.querySelectorAll("[data-edit-step]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const st = assessmentSteps.find((x) => x.id === b.dataset.editStep); if (st) openUniStep(st.assessment_id, st.id); }));
  document.querySelectorAll("[data-delete-step]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); deleteRow("uni_assessment_steps", b.dataset.deleteStep, "Delete step?"); }));
  document.querySelectorAll("[data-toggle-step]").forEach((b) => b.addEventListener("change", async () => { await db.from("uni_assessment_steps").update({ done: b.checked }).eq("id", b.dataset.toggleStep); await loadUni(); renderUni(); }));
}
function wireUniEvents() {
  initPrettySelects();
  [["uniSubjectModal", "uniSubjectCancel"], ["uniClassModal", "uniClassCancel"], ["uniAssessmentModal", "uniAssessmentCancel"], ["uniStepModal", "uniStepCancel"], ["semesterModal", "semesterCancel"]].forEach(([modal, cancel]) => {
    $(cancel)?.addEventListener("click", () => { $(modal).classList.remove("open"); if (modal === "uniStepModal") editingUniStepId = null; });
    $(modal)?.addEventListener("click", (e) => { if (e.target.id === modal) $(modal).classList.remove("open"); });
  });
  $("uniSubjectSave")?.addEventListener("click", saveUniSubject);
  $("uniClassSave")?.addEventListener("click", saveUniClass);
  $("uniAssessmentSave")?.addEventListener("click", saveUniAssessment);
  $("uniStepSave")?.addEventListener("click", saveUniStep);
  $("semesterAddBreak")?.addEventListener("click", addSemesterBreak);
  $("semesterSave")?.addEventListener("click", saveSemesterSettingsFromModal);
  $("uniStepTitle")?.addEventListener("keydown", (e) => { if (e.key === "Enter") saveUniStep(); });
}


// ============================================
// Phase 4 · Achievements, reminder hub, theme studio, Sunday review
// ============================================
function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date(todayStr() + "T00:00");
  const due = new Date(iso + "T00:00");
  return Math.round((due - today) / 86400000);
}
function dueBadge(iso) {
  const d = daysUntil(iso);
  if (d === null) return { cls: "none", text: "⚪ No due date" };
  if (d < 0) return { cls: "urgent", text: `🔴 ${Math.abs(d)}d overdue` };
  if (d === 0) return { cls: "urgent", text: "🔴 Today" };
  if (d === 1) return { cls: "urgent", text: "🔴 Tomorrow" };
  if (d <= 4) return { cls: "soon", text: `🟠 ${d} days` };
  return { cls: "later", text: `🟢 ${niceDate(iso)}` };
}
function getAchievements() {
  const doneTasks = tasks.filter((t) => t.completed).length;
  const doneSteps = assessmentSteps.filter((s) => s.done).length;
  const hasUni = uniSubjects.length > 0;
  const hasProject = projects.length > 0;
  const checkedHabitsToday = habits.filter((h) => habitChecks.has(`${h.id}|${todayStr()}`)).length;
  return [
    { icon: "🌱", name: "First step", desc: "Complete 1 task", earned: doneTasks >= 1 },
    { icon: "🔥", name: "Ten wins", desc: "Complete 10 tasks", earned: doneTasks >= 10 },
    { icon: "🎓", name: "Uni ready", desc: "Add your first subject", earned: hasUni },
    { icon: "📂", name: "Project mode", desc: "Create a project", earned: hasProject },
    { icon: "✅", name: "Breakdown boss", desc: "Tick 5 assessment steps", earned: doneSteps >= 5 },
    { icon: "☀️", name: "Routine energy", desc: "Tick a habit today", earned: checkedHabitsToday >= 1 },
  ];
}
function getUpcomingReminders() {
  const taskReminders = tasks
    .filter((t) => !t.completed && t.due_date)
    .map((t) => ({ type: "Task", title: t.title, date: t.due_date, meta: prioById(t.priority_id)?.name || "Planner" }));
  const uniReminders = uniAssessments
    .filter((a) => a.due_date)
    .map((a) => ({ type: "Uni", title: a.title, date: a.due_date, meta: uniSubjects.find((s) => s.id === a.subject_id)?.code || "Assessment" }));
  return [...taskReminders, ...uniReminders]
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
    .slice(0, 5);
}
// Trim long titles so they stay on one line and never squeeze the
// due badge. Cuts on a word boundary when there's a sensible one.
function shortTitle(text, max = 40) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  // prefer breaking at a word, but only if that keeps most of the allowance
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const useWord = lastSpace >= max - 12;
  return (useWord ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

function renderPhase4() {
  const root = $("phase4Root");
  if (!root) return;
  const earned = getAchievements();
  const reminders = getUpcomingReminders();
  const earnedCount = earned.filter((a) => a.earned).length;
  root.innerHTML = `
    <div class="phase4-grid">
      <div class="phase4-panel">
        <div class="phase4-mini-head"><span>🏆 Achievements</span><strong>${earnedCount}/${earned.length}</strong></div>
        <div class="achievement-row">
          ${earned.map((a) => `<div class="achievement ${a.earned ? "earned" : "locked"}" title="${esc(a.desc)}"><b>${a.icon}</b><span>${esc(a.name)}</span></div>`).join("")}
        </div>
      </div>
      <div class="phase4-panel">
        <div class="phase4-mini-head"><span>🔔 Reminder hub</span><strong>${reminders.length}</strong></div>
        <div class="reminder-list">
          ${reminders.length ? reminders.map((r) => { const badge = dueBadge(r.date); return `<div class="reminder-row"><div class="reminder-main"><b title="${esc(r.title)}">${esc(shortTitle(r.title))}</b><span>${esc(r.type)} · ${esc(r.meta)}</span></div><em class="due-badge ${badge.cls}">${badge.text}</em></div>`; }).join("") : `<div class="empty slim"><span class="emoji">✨</span>No upcoming due dates.</div>`}
        </div>
      </div>
    </div>`;
}
function renderThemeStudio() {
  const grid = $("themeGrid");
  if (!grid) return;
  const theme = getTheme();
  grid.innerHTML = `
    <div class="theme-modes">
      <button class="theme-pill ${theme.mode === "light" ? "active" : ""}" data-theme-mode="light">☀️ Light</button>
      <button class="theme-pill ${theme.mode === "dark" ? "active" : ""}" data-theme-mode="dark">🌙 Dark</button>
    </div>
    <div class="accent-row">
      ${THEME_ACCENTS.map((a) => `<button class="accent-dot ${theme.accent.toLowerCase() === a.color.toLowerCase() ? "active" : ""}" data-accent="${a.color}" style="--accent-choice:${a.color}" aria-label="${esc(a.name)}"></button>`).join("")}
    </div>`;
  grid.querySelectorAll("[data-theme-mode]").forEach((b) => b.addEventListener("click", () => setTheme({ mode: b.dataset.themeMode })));
  grid.querySelectorAll("[data-accent]").forEach((b) => b.addEventListener("click", () => setTheme({ accent: b.dataset.accent })));
}
function weeklyCompletedCount() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return tasks.filter((t) => t.completed_at && new Date(t.completed_at) >= start).length;
}
function openSundayReview() {
  const modal = $("reviewModal");
  if (!modal) return;
  const upcoming = getUpcomingReminders().slice(0, 3);
  const achievements = getAchievements().filter((a) => a.earned).length;
  $("reviewSummary").innerHTML = `
    <div class="review-summary-grid">
      <div><strong>${weeklyCompletedCount()}</strong><span>tasks completed this week</span></div>
      <div><strong>${achievements}</strong><span>achievements unlocked</span></div>
      <div><strong>${upcoming.length}</strong><span>priority due dates ahead</span></div>
    </div>
    <div class="review-next">
      <h3>Next things to watch</h3>
      ${upcoming.length ? upcoming.map((r) => { const b = dueBadge(r.date); return `<p><span>${esc(r.title)}</span><em class="due-badge ${b.cls}">${b.text}</em></p>`; }).join("") : `<p><span>Your week is clear.</span><em class="due-badge later">Plan gently</em></p>`}
    </div>`;
  $("reviewNotes").value = localStorage.getItem("prioSundayReview") || "";
  modal.classList.add("open");
}
function closeSundayReview() { $("reviewModal")?.classList.remove("open"); }
function saveSundayReview() {
  localStorage.setItem("prioSundayReview", $("reviewNotes").value.trim());
  closeSundayReview();
  toast("Sunday review saved ✨");
}

// ============================================
// Modal stacking guard
// Any .modal-backdrop gaining/losing .open toggles body.modal-open, so
// planner chrome (Filter button, dropdown panels) can never float above
// a modal. One observer covers every modal — current and future — so no
// individual open/close call site can forget to do this.
// ============================================
(function watchModals() {
  const sync = () => {
    const anyOpen = !!document.querySelector(".modal-backdrop.open");
    document.body.classList.toggle("modal-open", anyOpen);
    // a dropdown left hanging open would still sit over the form
    if (anyOpen && typeof closePlannerFilter === "function") closePlannerFilter();
  };

  const observe = () => {
    document.querySelectorAll(".modal-backdrop").forEach((m) => {
      if (m._stackWatched) return;
      m._stackWatched = true;
      new MutationObserver(sync).observe(m, { attributes: true, attributeFilter: ["class"] });
    });
    sync();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe);
  else observe();

  // catch modals added to the DOM later
  new MutationObserver(observe).observe(document.body, { childList: true, subtree: true });
})();

// ============================================
// Phase 4 · Calendar events + invites
// Events the user owns AND events they've been invited to both appear
// on the calendar. Times are stored as timestamptz so an invite sent
// from Sydney reads correctly wherever the invitee is.
// ============================================
let events = [];          // events I own or am invited to
let myInvites = [];       // invites addressed to me
let responsesToMe = [];   // accept/decline replies on events I own
let eventInvitees = [];   // people staged in the open modal [{id, display_name}]
let editingEventId = null;
let inviteSearchTimer = null;

async function loadEvents() {
  const [{ data: ev }, { data: inv }] = await Promise.all([
    db.from("events").select("*").order("starts_at"),
    db.from("event_invites").select("*, events(*)").eq("invitee_id", user.id),
  ]);
  const owned = ev || [];
  myInvites = inv || [];
  // merge invited events that RLS returned via the join
  const extra = myInvites.map((i) => i.events).filter(Boolean);
  const seen = new Set(owned.map((e) => e.id));
  events = [...owned, ...extra.filter((e) => e && !seen.has(e.id))];

  // resolve who sent each invite, so the notification can name them
  const inviterIds = [...new Set(myInvites.map((i) => i.inviter_id).filter(Boolean))];
  if (inviterIds.length) {
    const { data: profs } = await db.from("profiles").select("id, display_name").in("id", inviterIds);
    const nameOf = Object.fromEntries((profs || []).map((p) => [p.id, p.display_name || "A Prio user"]));
    myInvites.forEach((i) => { i.inviter_name = nameOf[i.inviter_id] || "A Prio user"; });
  }

  // Responses to invites *I* sent, so the organiser hears back.
  const myEventIds = owned.map((e) => e.id);
  responsesToMe = [];
  if (myEventIds.length) {
    const { data: resp } = await db.from("event_invites")
      .select("*").in("event_id", myEventIds).neq("status", "pending");
    const rows = (resp || []).filter((r) => r.invitee_id !== user.id);
    if (rows.length) {
      const ids = [...new Set(rows.map((r) => r.invitee_id))];
      const { data: pf } = await db.from("profiles").select("id, display_name").in("id", ids);
      const who = Object.fromEntries((pf || []).map((p) => [p.id, p.display_name || "A Prio user"]));
      responsesToMe = rows.map((r) => ({
        ...r,
        person_name: who[r.invitee_id] || "A Prio user",
        event: owned.find((e) => e.id === r.event_id) || null,
      })).filter((r) => r.event);
    }
  }
}

function eventDateStr(ev) {
  const d = new Date(ev.starts_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eventsForDate(iso) {
  return events.filter((e) => eventDateStr(e) === iso)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

function eventTimeLabel(ev) {
  if (ev.all_day) return "All day";
  const f = (t) => new Date(t).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return ev.ends_at ? `${f(ev.starts_at)} – ${f(ev.ends_at)}` : f(ev.starts_at);
}

function myInviteFor(eventId) {
  return myInvites.find((i) => i.event_id === eventId) || null;
}

// ---------- modal ----------
function openEventModal(eventId = null, presetDate = null) {
  editingEventId = eventId;
  const ev = eventId ? events.find((x) => x.id === eventId) : null;
  const owned = !ev || ev.owner_id === user.id;
  if (ev && !owned) return toast("Only the organiser can edit this event");

  $("eventModalTitle").textContent = ev ? "Edit event" : "New event";
  $("eventTitle").value = ev ? ev.title : "";
  $("eventLocation").value = ev ? ev.location || "" : "";
  $("eventNotes").value = ev ? ev.notes || "" : "";

  if (ev) {
    const s = new Date(ev.starts_at);
    setDateInput("eventDate", eventDateStr(ev));
    setTimeInput("eventStart", `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`);
    if (ev.ends_at) {
      const e = new Date(ev.ends_at);
      setTimeInput("eventEnd", `${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`);
    } else {
      setTimeInput("eventEnd", "");
    }
    setAllDay(!!ev.all_day);
  } else {
    setDateInput("eventDate", presetDate || selectedDate || todayStr());
    setTimeInput("eventStart", "09:00");
    setTimeInput("eventEnd", "10:00");
    setAllDay(false);
  }

  // staged invitees
  eventInvitees = [];
  $("inviteSearch").value = "";
  clearInviteSearch();
  renderInviteChips();
  if (ev) loadExistingInvitees(ev.id);

  $("eventModal").classList.add("open");
  setTimeout(() => $("eventTitle").focus(), 250);
}

function closeEventModal() {
  $("eventModal").classList.remove("open");
  editingEventId = null;
  eventInvitees = [];
}

function setAllDay(on) {
  const btn = $("eventAllDay");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-checked", on ? "true" : "false");
  $("eventTimeRow").style.display = on ? "none" : "";
}

async function loadExistingInvitees(eventId) {
  const { data } = await db.from("event_invites").select("invitee_id, status").eq("event_id", eventId);
  if (!data?.length) return;
  const ids = data.map((d) => d.invitee_id);
  const { data: profs } = await db.from("profiles").select("id, display_name").in("id", ids);
  eventInvitees = (profs || []).map((p) => ({
    ...p,
    status: data.find((d) => d.invitee_id === p.id)?.status || "pending",
    existing: true,
  }));
  renderInviteChips();
}

// ---------- people search ----------
function runInviteSearch() {
  const q = $("inviteSearch").value.trim();
  const box = $("inviteResults");
  if (q.length < 2) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="invite-hint">Searching…</div>`;

  clearTimeout(inviteSearchTimer);
  inviteSearchTimer = setTimeout(async () => {
    const { data, error } = await db.rpc("search_people", { q });
    if (error) { box.innerHTML = `<div class="invite-hint">Search unavailable — run schema-update-4.sql</div>`; return; }
    const results = (data || []).filter((p) => !eventInvitees.some((i) => i.id === p.id));
    if (!results.length) { box.innerHTML = `<div class="invite-hint">No one found on Prio matching that.</div>`; return; }
    box.innerHTML = results.map((p) => `
      <button type="button" class="invite-result" data-id="${p.id}" data-name="${esc(p.display_name || "Prio user")}">
        <span class="invite-av">${esc((p.display_name || "?").charAt(0).toUpperCase())}</span>
        <span>${esc(p.display_name || "Prio user")}</span>
        <span class="invite-add">+ Invite</span>
      </button>`).join("");
    box.querySelectorAll(".invite-result").forEach((b) =>
      b.addEventListener("click", () => {
        eventInvitees.push({ id: b.dataset.id, display_name: b.dataset.name });
        $("inviteSearch").value = "";
        clearInviteSearch();
        renderInviteChips();
      }));
  }, 280);
}

function clearInviteSearch() {
  $("inviteResults").innerHTML = "";
  $("inviteSearchShell")?.classList.remove("has-value");
}

function renderInviteChips() {
  const wrap = $("inviteChips");
  if (!eventInvitees.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = eventInvitees.map((p) => {
    const badge = p.status === "accepted" ? "✓" : p.status === "declined" ? "✕" : "•";
    return `<span class="invite-chip ${p.status || ""}" data-id="${p.id}">
      <span class="invite-av sm">${esc((p.display_name || "?").charAt(0).toUpperCase())}</span>
      ${esc(p.display_name || "Prio user")}
      <em title="${p.status || "not yet invited"}">${badge}</em>
      <button type="button" aria-label="Remove">✕</button>
    </span>`;
  }).join("");
  wrap.querySelectorAll(".invite-chip button").forEach((b) =>
    b.addEventListener("click", (e) => {
      const id = e.target.closest(".invite-chip").dataset.id;
      eventInvitees = eventInvitees.filter((p) => p.id !== id);
      renderInviteChips();
    }));
}

// ---------- save ----------
async function saveEvent() {
  const title = $("eventTitle").value.trim();
  if (!title) return toast("Give your event a name");
  const date = $("eventDate").dataset.iso || "";
  if (!date) return toast("Pick a date for the event");

  const allDay = $("eventAllDay").classList.contains("on");
  const startTime = allDay ? "00:00" : (getTimeInput("eventStart") || "09:00");
  const starts = new Date(`${date}T${startTime}`);
  let ends = null;
  const endTime = getTimeInput("eventEnd");
  if (!allDay && endTime) {
    ends = new Date(`${date}T${endTime}`);
    if (ends <= starts) return toast("End time must be after the start time");
  }

  const payload = {
    owner_id: user.id,
    title,
    notes: $("eventNotes").value.trim() || null,
    location: $("eventLocation").value.trim() || null,
    starts_at: starts.toISOString(),
    ends_at: ends ? ends.toISOString() : null,
    all_day: allDay,
  };

  const btn = $("eventSave");
  btn.disabled = true;
  try {
    let eventId = editingEventId;
    if (eventId) {
      const { error } = await db.from("events").update(payload).eq("id", eventId);
      if (error) throw error;
    } else {
      const { data, error } = await db.from("events").insert(payload).select().single();
      if (error) throw error;
      eventId = data.id;
    }

    // sync invites: add new ones, remove any that were taken off
    const { data: current } = await db.from("event_invites").select("invitee_id").eq("event_id", eventId);
    const currentIds = (current || []).map((c) => c.invitee_id);
    const wantIds = eventInvitees.map((p) => p.id);

    const toAdd = wantIds.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !wantIds.includes(id));

    if (toAdd.length) {
      await db.from("event_invites").insert(toAdd.map((id) => ({
        event_id: eventId, invitee_id: id, inviter_id: user.id, status: "pending",
      })));
    }
    if (toRemove.length) {
      await db.from("event_invites").delete().eq("event_id", eventId).in("invitee_id", toRemove);
    }

    await loadEvents();
    await cacheInviteNames();   // so guest names make it into the Google entry
    renderCalendar();
    closeEventModal();
    toast(editingEventId ? "Event updated 🗓️" : (toAdd.length ? `Event created · ${toAdd.length} invited 🗓️` : "Event created 🗓️"));

    // background push to Google
    const savedEvent = events.find((e) => e.id === eventId);
    if (savedEvent) gcalAutoSync("event", savedEvent);
  } catch (err) {
    toast(err.message?.includes("events") ? "Couldn't save — run schema-update-4.sql" : "Couldn't save — try again");
  } finally {
    btn.disabled = false;
  }
}

async function deleteEvent(id) {
  const ev = events.find((e) => e.id === id);
  if (!ev) return;
  if (ev.owner_id !== user.id) return toast("Only the organiser can delete this");
  if (!confirm(`Delete "${ev.title}"? Guests will lose the invite too.`)) return;
  // clean up the Google copy too, so no orphan is left behind
  gcalAutoRemove("event", id);
  await db.from("events").delete().eq("id", id);
  events = events.filter((e) => e.id !== id);
  renderCalendar();
  toast("Event deleted");
}

async function respondInvite(eventId, status) {
  const inv = myInviteFor(eventId);
  if (!inv) return;
  const { error } = await db.from("event_invites").update({ status }).eq("id", inv.id);
  if (error) return toast("Couldn't update — try again");
  inv.status = status;
  renderCalendar();
  toast(status === "accepted" ? "You're going ✓" : "Invite declined");
}

// Remove an invite you received. This deletes only YOUR invite row —
// the organiser's event is untouched, and other guests are unaffected.
async function leaveEvent(eventId, { skipConfirm = false } = {}) {
  const inv = myInviteFor(eventId);
  if (!inv) return;
  const ev = events.find((e) => e.id === eventId);
  if (!skipConfirm &&
      !confirm(`Remove "${ev?.title || "this event"}" from your calendar? The organiser keeps the event.`)) return;

  const { error } = await db.from("event_invites").delete().eq("id", inv.id);
  if (error) return toast("Couldn't remove — try again");

  // drop it locally, plus any Google copy this user synced
  myInvites = myInvites.filter((i) => i.id !== inv.id);
  events = events.filter((e) => e.id !== eventId);
  gcalAutoRemove("event", eventId);

  renderCalendar();
  toast("Removed from your calendar");
}

// ---------- Google Calendar ----------
function eventToGoogle(id) {
  const ev = events.find((e) => e.id === id);
  if (!ev) return;
  // All-day uses LOCAL calendar digits (no timezone); timed uses true UTC.
  // Getting this wrong shifts events by the whole UTC offset in Google.
  const stamp = (d, allDay) => {
    const dt = new Date(d);
    if (allDay) {
      return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
    }
    const iso = dt.toISOString();            // always UTC, e.g. 2026-08-14T23:30:00.000Z
    return iso.slice(0, 19).replace(/[-:]/g, "") + "Z";
  };
  let dates;
  if (ev.all_day) {
    const end = new Date(ev.starts_at);
    end.setDate(end.getDate() + 1);
    dates = `${stamp(ev.starts_at, true)}/${stamp(end, true)}`;
  } else {
    const end = ev.ends_at || new Date(new Date(ev.starts_at).getTime() + 3600000);
    dates = `${stamp(ev.starts_at)}/${stamp(end)}`;
  }
  const guestNames = eventInviteNames(ev.id);
  const details = [ev.notes, guestNames ? `With: ${guestNames}` : "", "— added from Prio"].filter(Boolean).join("\n");
  const url = "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(ev.title)}` +
    `&dates=${dates}` +
    `&details=${encodeURIComponent(details)}` +
    (ev.location ? `&location=${encodeURIComponent(ev.location)}` : "");
  window.open(url, "_blank");
  toast("Opening Google Calendar 📅");
}

let inviteNameCache = {};
function eventInviteNames(eventId) {
  return (inviteNameCache[eventId] || []).join(", ");
}

async function cacheInviteNames() {
  const ids = events.map((e) => e.id);
  if (!ids.length) return;
  const { data } = await db.from("event_invites").select("event_id, invitee_id, status").in("event_id", ids);
  if (!data?.length) return;
  const people = [...new Set(data.map((d) => d.invitee_id))];
  const { data: profs } = await db.from("profiles").select("id, display_name").in("id", people);
  const nameOf = Object.fromEntries((profs || []).map((p) => [p.id, p.display_name || "Prio user"]));
  inviteNameCache = {};
  data.forEach((d) => {
    (inviteNameCache[d.event_id] ||= []).push(nameOf[d.invitee_id] || "Prio user");
  });
}

// ---------- render into the day panel ----------
function eventsPanelHTML(iso) {
  const list = eventsForDate(iso);
  if (!list.length) return "";
  return `
    <div class="calendar-event-list">
      <h4>Events</h4>
      ${list.map((ev) => {
        const mine = ev.owner_id === user.id;
        const inv = myInviteFor(ev.id);
        const guests = eventInviteNames(ev.id);
        const statusChip = !mine && inv
          ? `<span class="ev-status ${inv.status}">${inv.status === "accepted" ? "Going" : inv.status === "declined" ? "Declined" : "Invited"}</span>` : "";
        return `
        <div class="calendar-event" data-id="${ev.id}" style="--event-color:${esc(ev.color || "#4353ff")}">
          <span class="ev-emoji">${ev.all_day ? "📌" : "🗓️"}</span>
          <div class="ev-body">
            <strong>${esc(ev.title)} ${statusChip}</strong>
            <p>${esc(eventTimeLabel(ev))}${ev.location ? " · " + esc(ev.location) : ""}</p>
            ${guests ? `<p class="ev-guests">👥 ${esc(guests)}</p>` : ""}
            ${ev.notes ? `<p class="ev-notes">${esc(ev.notes)}</p>` : ""}
          </div>
          <div class="ev-actions">
            ${!mine && inv && inv.status !== "accepted" ? `<button class="icon-btn ok" title="Accept">✓</button>` : ""}
            ${!mine && inv && inv.status !== "declined" ? `<button class="icon-btn no" title="Decline">✕</button>` : ""}
            ${!mine && inv ? `<button class="icon-btn leave" title="Remove from my calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg></button>` : ""}
            <button class="icon-btn gcal" title="Add to Google Calendar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M12 14v4M10 16h4"/></svg>
            </button>
            ${mine ? `<button class="icon-btn edit" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/></svg></button>
            <button class="icon-btn del" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg></button>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

function wireEventPanel(scope) {
  scope.querySelectorAll(".calendar-event").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".gcal")?.addEventListener("click", () => {
      const ev = events.find((x) => x.id === id);
      if (gcalConnected() && ev) gcalSyncOne("event", ev);
      else eventToGoogle(id);   // fall back to the manual "add to calendar" link
    });
    el.querySelector(".edit")?.addEventListener("click", () => openEventModal(id));
    el.querySelector(".del")?.addEventListener("click", () => deleteEvent(id));
    el.querySelector(".ok")?.addEventListener("click", () => respondInvite(id, "accepted"));
    el.querySelector(".no")?.addEventListener("click", () => respondInvite(id, "declined"));
    el.querySelector(".leave")?.addEventListener("click", () => leaveEvent(id));
  });
}

// ---------- wiring ----------
function wireEventEvents() {
  $("eventCancel")?.addEventListener("click", closeEventModal);
  $("eventSave")?.addEventListener("click", saveEvent);
  $("eventModal")?.addEventListener("click", (e) => { if (e.target.id === "eventModal") closeEventModal(); });
  $("eventTitle")?.addEventListener("keydown", (e) => { if (e.key === "Enter") saveEvent(); });
  $("eventAllDay")?.addEventListener("click", () => setAllDay(!$("eventAllDay").classList.contains("on")));
  $("inviteSearch")?.addEventListener("input", () => {
    $("inviteSearchShell")?.classList.toggle("has-value", !!$("inviteSearch").value);
    runInviteSearch();
  });
  $("inviteSearch")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
    if (e.key === "Escape") { $("inviteSearch").value = ""; clearInviteSearch(); }
  });
  $("inviteClear")?.addEventListener("click", () => {
    $("inviteSearch").value = "";
    clearInviteSearch();
    $("inviteSearch").focus();
  });
}

// ============================================
// Phase 4b · Custom time picker (typed entry)
// Two number fields + AM/PM, matching the in-app date picker's styling.
// A readonly text field holds a friendly label while dataset.time keeps
// the real 24h "HH:MM" value.
// ============================================
let timePickerTargetId = null;
let tpHour = 9;      // 24h internally
let tpMinute = 0;

function prettyTimeValue(hhmm) {
  if (!hhmm) return "";
  const [h, m] = String(hhmm).split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

function setTimeInput(id, hhmm) {
  const el = $(id);
  if (!el) return;
  el.dataset.time = hhmm || "";
  el.value = prettyTimeValue(hhmm);
}

function getTimeInput(id) {
  return $(id)?.dataset.time || "";
}

function openTimePicker(targetId, kicker = "Time") {
  timePickerTargetId = targetId;
  const [h, m] = (getTimeInput(targetId) || "09:00").split(":").map(Number);
  tpHour = isNaN(h) ? 9 : h;
  tpMinute = isNaN(m) ? 0 : m;
  $("timePickerKicker").textContent = kicker;
  syncTimeFields();
  $("timePickerModal").classList.add("open");
  // don't autofocus on phones — it pops the keyboard over the dialog
  if (window.innerWidth > 640) {
    setTimeout(() => { $("timeHourInput").focus(); $("timeHourInput").select(); }, 260);
  }
}

function closeTimePicker() {
  $("timePickerModal")?.classList.remove("open");
  timePickerTargetId = null;
}

// state -> inputs
function syncTimeFields() {
  const h12 = tpHour % 12 === 0 ? 12 : tpHour % 12;
  $("timeHourInput").value = String(h12);
  $("timeMinuteInput").value = String(tpMinute).padStart(2, "0");
  $("ampmCol").querySelectorAll("[data-ap]").forEach((b) =>
    b.classList.toggle("on", b.dataset.ap === (tpHour < 12 ? "am" : "pm")));
}

// inputs -> state (tolerant: accepts partial typing, clamps on commit)
function readTimeFields(commit = false) {
  let h = parseInt($("timeHourInput").value, 10);
  let m = parseInt($("timeMinuteInput").value, 10);
  const isPm = $("ampmCol").querySelector('[data-ap="pm"]')?.classList.contains("on");

  if (isNaN(h)) h = 12;
  if (isNaN(m)) m = 0;
  h = Math.min(12, Math.max(1, h));
  m = Math.min(59, Math.max(0, m));

  tpHour = isPm ? (h % 12) + 12 : h % 12;
  tpMinute = m;
  if (commit) syncTimeFields();
}

function stepTime(unit, dir) {
  if (unit === "h") {
    tpHour = (tpHour + dir + 24) % 24;
  } else {
    // snap to the next/previous clean 5-minute mark so stepping from a
    // typed value like :07 lands on :10, not :12
    const cur = tpHour * 60 + tpMinute;
    let target;
    if (dir > 0) target = (Math.floor(cur / 5) + 1) * 5;
    else target = tpMinute % 5 === 0 ? cur - 5 : Math.floor(cur / 5) * 5;
    target = (target + 1440) % 1440;
    tpHour = Math.floor(target / 60);
    tpMinute = target % 60;
  }
  syncTimeFields();
}

function confirmTimePicker() {
  readTimeFields(true);
  const hhmm = `${String(tpHour).padStart(2, "0")}:${String(tpMinute).padStart(2, "0")}`;

  // writing into a shift break rather than a normal field?
  if (timePickerTargetId === "__break" && timePickerBreakTarget) {
    const { i, field } = timePickerBreakTarget;
    if (shiftBreaksDraft[i]) shiftBreaksDraft[i][field] = hhmm;
    timePickerBreakTarget = null;
    closeTimePicker();
    renderShiftBreaks();
    renderShiftSummary();
    return;
  }

  if (timePickerTargetId) {
    setTimeInput(timePickerTargetId, hhmm);
    // keep the end time after the start automatically
    if (timePickerTargetId === "eventStart") {
      const end = getTimeInput("eventEnd");
      if (end && end <= hhmm) {
        const nh = Math.min(23, tpHour + 1);
        setTimeInput("eventEnd", `${String(nh).padStart(2, "0")}:${String(tpMinute).padStart(2, "0")}`);
      }
    }
    // shift start bumps shift end, and refresh the worked-hours summary
    if (timePickerTargetId === "shiftStart") {
      const end = getTimeInput("shiftEnd");
      if (end && end <= hhmm) {
        const nh = Math.min(23, tpHour + 1);
        setTimeInput("shiftEnd", `${String(nh).padStart(2, "0")}:${String(tpMinute).padStart(2, "0")}`);
      }
    }
    if (timePickerTargetId === "shiftStart" || timePickerTargetId === "shiftEnd") {
      renderShiftSummary();
    }
  }
  closeTimePicker();
}

function wireTimePickerEvents() {
  $("eventStart")?.addEventListener("click", () => openTimePicker("eventStart", "Start time"));
  $("eventEnd")?.addEventListener("click", () => openTimePicker("eventEnd", "End time"));
  $("eventDate")?.addEventListener("click", () => openDatePicker("eventDate"));

  $("timePickerClose")?.addEventListener("click", closeTimePicker);
  $("timePickerCancel")?.addEventListener("click", closeTimePicker);
  $("timePickerSet")?.addEventListener("click", confirmTimePicker);
  $("timePickerModal")?.addEventListener("click", (e) => { if (e.target.id === "timePickerModal") closeTimePicker(); });

  const hIn = $("timeHourInput"), mIn = $("timeMinuteInput");

  [hIn, mIn].forEach((el, i) => {
    if (!el) return;
    el.addEventListener("focus", () => el.select());
    el.addEventListener("input", () => {
      // digits only
      el.value = el.value.replace(/\D/g, "").slice(0, 2);
      readTimeFields(false);
      // typing "9" or "10" in hours jumps to minutes automatically
      if (i === 0 && (el.value.length === 2 || Number(el.value) > 1)) {
        if (el.value.length >= 1 && Number(el.value) >= 2) mIn.focus();
        else if (el.value.length === 2) mIn.focus();
      }
    });
    el.addEventListener("blur", () => readTimeFields(true));
    el.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); stepTime(i === 0 ? "h" : "m", 1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); stepTime(i === 0 ? "h" : "m", -1); }
      else if (e.key === "Enter") { e.preventDefault(); confirmTimePicker(); }
      else if (e.key === "Escape") closeTimePicker();
      // typing ":" in the hour box moves to minutes, like a real clock field
      else if (i === 0 && (e.key === ":" || e.key === ".")) { e.preventDefault(); mIn.focus(); }
    });
  });

  $("ampmCol")?.querySelectorAll("[data-ap]").forEach((b) =>
    b.addEventListener("click", () => {
      const wantPm = b.dataset.ap === "pm";
      if (wantPm && tpHour < 12) tpHour += 12;
      if (!wantPm && tpHour >= 12) tpHour -= 12;
      syncTimeFields();
    }));

  document.querySelectorAll(".time-stepper [data-step]").forEach((b) =>
    b.addEventListener("click", () => stepTime(b.dataset.step, Number(b.dataset.dir))));
}

// ============================================
// Invite notification
// Shows pending invites once each, on app open. Seen invite ids are kept
// in localStorage per user, so an invite never nags twice — but a brand
// new one always surfaces.
// ============================================
let iaQueue = [];
let iaIndex = 0;

function iaSeenKey() {
  return `prio_seen_invites_${user?.id || "anon"}`;
}
function iaGetSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(iaSeenKey()) || "[]")); }
  catch { return new Set(); }
}
function iaMarkSeen(ids) {
  const seen = iaGetSeen();
  ids.forEach((id) => seen.add(id));
  // keep the list from growing forever
  const trimmed = [...seen].slice(-200);
  localStorage.setItem(iaSeenKey(), JSON.stringify(trimmed));
}

function checkNewInvites() {
  const seen = iaGetSeen();
  const now = new Date();

  const stillUpcoming = (ev) => {
    if (!ev) return false;
    if (ev.all_day) return true;
    return new Date(ev.ends_at || ev.starts_at) >= now;
  };

  // invites addressed to me, awaiting an answer
  const incoming = myInvites.filter((i) => {
    if (i.status !== "pending") return false;      // already answered
    if (seen.has(i.id)) return false;              // already shown
    const ev = i.events || events.find((e) => e.id === i.event_id);
    return stillUpcoming(ev);
  }).map((i) => ({ kind: "invite", data: i }));

  // replies to invites I sent — keyed by status so a change re-notifies
  const replies = responsesToMe.filter((r) => {
    const key = `resp:${r.id}:${r.status}`;
    if (seen.has(key)) return false;
    return stillUpcoming(r.event);
  }).map((r) => ({ kind: "response", data: r }));

  iaQueue = [...incoming, ...replies];
  if (!iaQueue.length) return;
  iaIndex = 0;
  // Don't collide with the onboarding tour or the splash. If the tour is
  // running, wait for it to finish before surfacing invites.
  const tourRunning = () => !!document.getElementById("tourVeil")?.classList.contains("open");
  const start = () => {
    if (tourRunning()) return setTimeout(start, 1200);
    showInviteAlert();
  };
  setTimeout(start, 1000);
}

function showInviteAlert() {
  const entry = iaQueue[iaIndex];
  if (!entry) return closeInviteAlert();

  const isResponse = entry.kind === "response";
  const rec = entry.data;
  const ev = isResponse
    ? rec.event
    : (rec.events || events.find((e) => e.id === rec.event_id));
  if (!ev) return iaNext();

  // who + what the card is about
  const from = isResponse ? rec.person_name : (rec.inviter_name || "A Prio user");
  const accepted = isResponse && rec.status === "accepted";
  $("iaFrom").textContent = from;
  $("iaAvatar").textContent = from.charAt(0).toUpperCase();
  $("iaAvatar").className = "ia-av" + (isResponse ? (accepted ? " ok" : " no") : "");
  $("iaTitle").textContent = ev.title;
  $("iaVerb").textContent = isResponse
    ? (accepted ? "is going to" : "can't make")
    : "invited you to";

  // swap the footer controls
  $("iaInviteActions").style.display = isResponse ? "none" : "";
  $("iaResponseActions").style.display = isResponse ? "" : "none";
  $("iaLater").style.display = isResponse ? "none" : "";
  $("iaRemove").style.display = isResponse ? "none" : "";
  document.querySelector("#inviteAlertModal .modal-kicker").textContent =
    isResponse ? (accepted ? "Good news" : "Heads up") : "You're invited";

  // heading shows position when there are several waiting
  const label = isResponse ? "Invite update" : "New invitation";
  $("iaHeading").textContent = iaQueue.length > 1
    ? `${label} (${iaIndex + 1} of ${iaQueue.length})`
    : label;
  $("iaBadge").textContent = iaQueue.length - iaIndex;
  $("iaBadge").style.display = iaQueue.length > 1 ? "grid" : "none";

  const start = new Date(ev.starts_at);
  const dayLabel = start.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  const today = todayStr();
  const evDay = eventDateStr(ev);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const prefix = evDay === today ? "Today · " : evDay === tomorrowStr ? "Tomorrow · " : "";
  $("iaWhen").textContent = prefix + dayLabel;

  $("iaTime").textContent = eventTimeLabel(ev);
  $("iaTimeRow").style.display = "";

  if (ev.location) { $("iaPlace").textContent = ev.location; $("iaPlaceRow").style.display = ""; }
  else $("iaPlaceRow").style.display = "none";

  if (ev.notes) { $("iaNotes").textContent = ev.notes; $("iaNotesRow").style.display = ""; }
  else $("iaNotesRow").style.display = "none";

  $("inviteAlertModal").classList.add("open");
}

function iaNext() {
  iaIndex++;
  if (iaIndex >= iaQueue.length) return closeInviteAlert();
  showInviteAlert();
}

function iaKeyOf(entry) {
  return entry.kind === "response"
    ? `resp:${entry.data.id}:${entry.data.status}`
    : entry.data.id;
}

function closeInviteAlert() {
  // everything we showed counts as seen, answered or not
  iaMarkSeen(iaQueue.map(iaKeyOf));
  $("inviteAlertModal")?.classList.remove("open");
  iaQueue = [];
  iaIndex = 0;
}

async function iaRespond(status) {
  const entry = iaQueue[iaIndex];
  if (entry && entry.kind === "invite") {
    iaMarkSeen([entry.data.id]);
    await respondInvite(entry.data.event_id, status);
  }
  iaNext();
}

function wireInviteAlert() {
  $("iaAccept")?.addEventListener("click", () => iaRespond("accepted"));
  $("iaDecline")?.addEventListener("click", () => iaRespond("declined"));
  $("iaLater")?.addEventListener("click", iaNext);
  $("iaRemove")?.addEventListener("click", async () => {
    const entry = iaQueue[iaIndex];
    if (entry?.kind === "invite") {
      iaMarkSeen([entry.data.id]);
      await leaveEvent(entry.data.event_id, { skipConfirm: true });
    }
    iaNext();
  });
  $("iaGotIt")?.addEventListener("click", () => {
    const entry = iaQueue[iaIndex];
    if (entry) iaMarkSeen([iaKeyOf(entry)]);
    iaNext();
  });
  $("iaClose")?.addEventListener("click", closeInviteAlert);
  $("inviteAlertModal")?.addEventListener("click", (e) => {
    if (e.target.id === "inviteAlertModal") closeInviteAlert();
  });
}

// ============================================
// Phase 5 · Google Calendar sync
//
// How the token works (important):
// Supabase returns Google's access token as session.provider_token, but
// deliberately does NOT store it — provider tokens grant access to
// sensitive third-party data. Google also expires it after ~1 hour.
// So we keep it in sessionStorage for this browser session and, when it
// expires, ask the user to reconnect rather than failing silently.
// ============================================
const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GCAL_TOKEN_KEY = "prio_gcal_token";
const GCAL_API = "https://www.googleapis.com/calendar/v3";

let gcalLinks = [];        // rows from gcal_links for this user
let gcalHasRefresh = false; // do we have a stored refresh token?
let gcalRefreshing = null;  // in-flight refresh promise, prevents stampedes

// ---------- token handling ----------
function gcalSaveToken(token, expiresInSec = 3600) {
  if (!token) return;
  const payload = { token, expires: Date.now() + (expiresInSec * 1000) - 60000 }; // 1 min safety margin
  try { sessionStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify(payload)); } catch {}
}

function gcalGetToken() {
  try {
    const raw = sessionStorage.getItem(GCAL_TOKEN_KEY);
    if (!raw) return null;
    const { token, expires } = JSON.parse(raw);
    if (!token || Date.now() > expires) {
      sessionStorage.removeItem(GCAL_TOKEN_KEY);
      return null;
    }
    return token;
  } catch { return null; }
}

function gcalClearToken() {
  try { sessionStorage.removeItem(GCAL_TOKEN_KEY); } catch {}
}

function gcalConnected() {
  // a stored refresh token counts as connected — we can always mint a
  // fresh access token on demand
  return !!gcalGetToken() || gcalHasRefresh;
}

// Called on every app load: Supabase puts provider_token on the session
// right after the OAuth redirect. Grab it before it's lost.
function gcalCaptureToken(session) {
  let got = false;
  if (session?.provider_token) {
    gcalSaveToken(session.provider_token);
    setTimeout(gcalResumeAfterReconnect, 500);
    got = true;
  }
  // Google sends provider_refresh_token ONLY on the initial consent, and
  // it never reappears on later session refreshes — so store it now or
  // lose the ability to stay connected.
  if (session?.provider_refresh_token) {
    gcalStoreRefreshToken(session.provider_refresh_token);
  }
  return got;
}

// Save the long-lived token so the server can mint fresh ones later.
async function gcalStoreRefreshToken(refreshToken) {
  try {
    await db.from("google_tokens").upsert({
      user_id: user.id,
      refresh_token: refreshToken,
      scope: GCAL_SCOPE,
      connected_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    gcalHasRefresh = true;
    renderGcalStatus();
  } catch (e) {
    console.warn("Couldn't store Google refresh token — run schema-update-6.sql", e);
  }
}

// Ask the server for a fresh access token. Returns true on success.
async function gcalRefreshAccessToken() {
  if (gcalRefreshing) return gcalRefreshing;      // don't stampede
  gcalRefreshing = (async () => {
    try {
      const { data: sess } = await db.auth.getSession();
      const jwt = sess?.session?.access_token;
      if (!jwt) return false;

      const res = await fetch("/api/google-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + jwt },
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "REVOKED" || data.error === "NO_REFRESH_TOKEN") {
          gcalHasRefresh = false;
        }
        return false;
      }
      gcalSaveToken(data.access_token, data.expires_in);
      renderGcalStatus();
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { gcalRefreshing = null; }, 0);
    }
  })();
  return gcalRefreshing;
}

async function gcalConnect() {
  const { error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: GCAL_SCOPE,
      redirectTo: window.location.origin + "/app.html",
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  if (error) toast("Couldn't open Google sign-in — " + error.message);
}

async function gcalDisconnect() {
  gcalClearToken();
  try { await db.from("google_tokens").delete().eq("user_id", user.id); } catch {}
  gcalHasRefresh = false;
  renderGcalStatus();
  toast("Google Calendar disconnected");
}

// ---------- API helper ----------
async function gcalFetch(path, options = {}, isRetry = false) {
  let token = gcalGetToken();

  // No usable token? Try to mint one silently before giving up.
  if (!token) {
    if (!isRetry && gcalHasRefresh && await gcalRefreshAccessToken()) {
      token = gcalGetToken();
    }
    if (!token) throw new Error("NOT_CONNECTED");
  }

  const res = await fetch(GCAL_API + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    gcalClearToken();
    // one silent retry with a fresh token — this is what removes the
    // hourly reconnect for the user
    if (!isRetry && gcalHasRefresh && await gcalRefreshAccessToken()) {
      return gcalFetch(path, options, true);
    }
    renderGcalStatus();
    throw new Error("TOKEN_EXPIRED");
  }
  if (!res.ok) {
    let msg = "Google Calendar error " + res.status;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- links ----------
async function loadGcalLinks() {
  const { data } = await db.from("gcal_links").select("*").eq("user_id", user.id);
  gcalLinks = data || [];
  // does this user have a stored refresh token? (the token itself is
  // never sent to the browser — this only returns true/false)
  try {
    const { data: has } = await db.rpc("has_google_token");
    gcalHasRefresh = !!has;
  } catch {
    gcalHasRefresh = false;   // schema-update-6.sql not run yet
  }
}

function gcalLinkFor(type, id) {
  return gcalLinks.find((l) => l.source_type === type && l.source_id === id) || null;
}

// ---------- payload builders ----------
// Google wants either {date} for all-day or {dateTime,timeZone} for timed.
function gcalTimeFields(startISO, endISO, allDay) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (allDay) {
    const d = new Date(startISO);
    const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const endDay = new Date(startISO);
    endDay.setDate(endDay.getDate() + 1);       // Google's all-day end is exclusive
    return { start: { date: ymd(d) }, end: { date: ymd(endDay) } };
  }
  const end = endISO || new Date(new Date(startISO).getTime() + 3600000).toISOString();
  return {
    start: { dateTime: new Date(startISO).toISOString(), timeZone: tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: tz },
  };
}

function gcalEventPayload(ev) {
  const guests = eventInviteNames(ev.id);
  const description = [ev.notes, guests ? `With: ${guests}` : "", "— synced from Prio"]
    .filter(Boolean).join("\n");
  return {
    summary: ev.title,
    description,
    ...(ev.location ? { location: ev.location } : {}),
    ...gcalTimeFields(ev.starts_at, ev.ends_at, ev.all_day),
  };
}

function gcalTaskPayload(t) {
  const p = prioById(t.priority_id);
  const description = [t.notes, p ? `Priority: ${p.name}` : "", "— synced from Prio"]
    .filter(Boolean).join("\n");
  // tasks have a due date but no time → all-day entry
  return {
    summary: t.title,
    description,
    ...gcalTimeFields(t.due_date + "T00:00:00", null, true),
  };
}

function gcalShiftPayload(sh) {
  const brk = (sh.breaks || []).length
    ? "Breaks: " + sh.breaks.map((b) => `${b.label || "Break"} ${prettyTimeValue(b.start)}–${prettyTimeValue(b.end)}`).join(", ")
    : "";
  const worked = `Worked: ${fmtDuration(shiftPaidMinutes(sh))}`;
  const description = [sh.notes, brk, worked, "— synced from Prio"].filter(Boolean).join("\n");
  return {
    summary: (sh.title || "Work") + " shift",
    description,
    ...(sh.location ? { location: sh.location } : {}),
    ...gcalTimeFields(sh.starts_at, sh.ends_at, false),
  };
}


function gcalProjectPayload(it) {
  const project = projects.find((p) => p.id === it.project_id);
  return {
    summary: `${project?.icon || "📂"} ${it.title}`,
    description: [project?.name ? `Project: ${project.name}` : "", it.notes, "— synced from Prio"].filter(Boolean).join("\n"),
    ...gcalTimeFields(it.due_date + "T00:00:00", null, true),
  };
}

function gcalAssessmentPayload(a) {
  const subject = uniSubjects.find((s) => s.id === a.subject_id);
  return {
    summary: `📝 ${a.title}`,
    description: [subject ? `Subject: ${subject.code || subject.name}` : "", a.weight ? `Weight: ${a.weight}%` : "", a.notes, "— synced from Prio"].filter(Boolean).join("\n"),
    ...gcalTimeFields(a.due_date + "T00:00:00", null, true),
  };
}

function gcalRoutinePayload(r) {
  const dayMap = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const days = [...(r.days || "")].map((d) => dayMap[Number(d)]).filter(Boolean);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const selectedDays = [...(r.days || "")].map(Number).sort((a, b) => a - b);
  for (let i = 0; i < 7 && !selectedDays.includes(start.getDay()); i++) start.setDate(start.getDate() + 1);
  return {
    summary: `${r.icon || "🔁"} ${r.name}`,
    description: `Scheduled routine in Prio\n— synced from Prio`,
    ...gcalTimeFields(localDateStr(start) + "T00:00:00", null, true),
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${days.join(",")}`],
  };
}

function gcalClassPayload(c) {
  const subject = uniSubjects.find((s) => s.id === c.subject_id);
  const sem = getUniSemesterSettings();
  const first = sem.startDate ? parseISODate(sem.startDate) : new Date();
  const targetDay = Number(c.day_of_week);
  while (first.getDay() !== targetDay) first.setDate(first.getDate() + 1);
  const startTime = (c.start_time || "09:00").slice(0, 5);
  const endTime = (c.end_time || "10:00").slice(0, 5);
  const startIso = `${localDateStr(first)}T${startTime}:00`;
  const endIso = `${localDateStr(first)}T${endTime}:00`;
  const dayMap = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const until = (sem.endDate || localDateStr(new Date(first.getFullYear(), first.getMonth() + 6, first.getDate()))).replaceAll("-", "") + "T235959Z";
  return {
    summary: `🎓 ${subject?.code || subject?.name || "Uni"} · ${c.class_type || "Class"}`,
    description: [`Room: ${c.room || "TBA"}`, "— synced from Prio"].join("\n"),
    ...(c.room ? { location: c.room } : {}),
    ...gcalTimeFields(startIso, endIso, false),
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${dayMap[targetDay]};UNTIL=${until}`],
  };
}

function stableUuid(text) {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) { h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619); h2 = Math.imul(h2 ^ text.charCodeAt(i), 2246822519); }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  const raw = (hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, h2))).slice(0, 32);
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-4${raw.slice(13,16)}-a${raw.slice(17,20)}-${raw.slice(20,32)}`;
}

function semesterBreakItems() {
  return (getUniSemesterSettings().breaks || []).map((b, i) => ({ ...b, id: stableUuid(`semester-break:${i}:${b.label}:${b.start}:${b.end}`) }));
}

function gcalBreakPayload(b) {
  const end = parseISODate(b.end);
  end.setDate(end.getDate() + 1);
  return {
    summary: `🌿 ${b.label || "Semester break"}`,
    description: "Semester break from Prio\n— synced from Prio",
    start: { date: b.start },
    end: { date: localDateStr(end) },
  };
}

// ---------- push one item ----------
async function gcalPush(type, item, { silent = false } = {}) {
  const payload = type === "event" ? gcalEventPayload(item)
    : type === "shift" ? gcalShiftPayload(item)
    : type === "project" ? gcalProjectPayload(item)
    : type === "assessment" ? gcalAssessmentPayload(item)
    : type === "routine" ? gcalRoutinePayload(item)
    : type === "class" ? gcalClassPayload(item)
    : type === "break" ? gcalBreakPayload(item)
    : gcalTaskPayload(item);
  const link = gcalLinkFor(type, item.id);

  let googleId;
  if (link) {
    // update in place — no duplicates on re-sync
    try {
      const res = await gcalFetch(`/calendars/primary/events/${encodeURIComponent(link.google_event_id)}`, {
        method: "PATCH", body: JSON.stringify(payload),
      });
      googleId = res.id;
    } catch (err) {
      if (String(err.message).includes("404") || String(err.message).includes("Not Found")) {
        // deleted on Google's side — recreate and relink
        const res = await gcalFetch("/calendars/primary/events", { method: "POST", body: JSON.stringify(payload) });
        googleId = res.id;
      } else throw err;
    }
  } else {
    const res = await gcalFetch("/calendars/primary/events", { method: "POST", body: JSON.stringify(payload) });
    googleId = res.id;
  }

  const row = {
    user_id: user.id, source_type: type, source_id: item.id,
    google_event_id: googleId, google_calendar_id: "primary",
    synced_at: new Date().toISOString(),
  };
  await db.from("gcal_links").upsert(row, { onConflict: "user_id,source_type,source_id" });

  const existing = gcalLinkFor(type, item.id);
  if (existing) Object.assign(existing, row);
  else gcalLinks.push(row);

  if (!silent) toast("Synced to Google Calendar ✓");
  return googleId;
}

async function gcalRemove(type, id) {
  const link = gcalLinkFor(type, id);
  if (!link) return;
  try {
    await gcalFetch(`/calendars/primary/events/${encodeURIComponent(link.google_event_id)}`, { method: "DELETE" });
  } catch (err) {
    // already gone on Google's side is fine
    if (!String(err.message).includes("410") && !String(err.message).includes("404")) throw err;
  }
  await db.from("gcal_links").delete().eq("user_id", user.id)
    .eq("source_type", type).eq("source_id", id);
  gcalLinks = gcalLinks.filter((l) => !(l.source_type === type && l.source_id === id));
}

// ---------- user-facing actions ----------
async function gcalSyncOne(type, item) {
  if (!gcalConnected()) return gcalPromptConnect();
  try {
    await gcalPush(type, item);
    renderCalendar();
    renderGcalStatus();
  } catch (err) {
    gcalHandleError(err);
  }
}

async function gcalSyncAll() {
  if (!gcalConnected()) return gcalPromptConnect();
  const btn = $("gcalSyncAllBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing everything…"; }

  const today = todayStr();
  const items = [
    ...events.filter((e) => e.owner_id === user.id && eventDateStr(e) >= today).map((item) => ({ type: "event", item })),
    ...tasks.filter((t) => !t.completed && t.due_date && t.due_date >= today).map((item) => ({ type: "task", item })),
    ...shifts.filter((s) => shiftDateStr(s) >= today).map((item) => ({ type: "shift", item })),
    ...projectItems.filter((i) => !i.completed && i.due_date && i.due_date >= today).map((item) => ({ type: "project", item })),
    ...uniAssessments.filter((a) => a.due_date && a.due_date >= today).map((item) => ({ type: "assessment", item })),
    ...routines.map((item) => ({ type: "routine", item })),
    ...uniClasses.map((item) => ({ type: "class", item })),
    ...semesterBreakItems().filter((b) => b.end >= today).map((item) => ({ type: "break", item })),
  ];

  let ok = 0, failed = 0;
  for (const { type, item } of items) {
    try { await gcalPush(type, item, { silent: true }); ok++; }
    catch (err) { failed++; if (err.message === "TOKEN_EXPIRED" || err.message === "NOT_CONNECTED") break; }
  }

  if (btn) { btn.disabled = false; btn.textContent = "Sync everything"; }
  renderGcalStatus();
  renderCalendar();
  if (!gcalConnected()) return gcalPromptConnect();
  toast(failed ? `Synced ${ok}, ${failed} failed` : `Synced all ${ok} calendar item${ok === 1 ? "" : "s"} ✓`);
}

function gcalHandleError(err) {
  if (err.message === "NOT_CONNECTED" || err.message === "TOKEN_EXPIRED") return gcalPromptConnect();
  toast(err.message || "Google Calendar sync failed");
}

function gcalPromptConnect() {
  $("gcalModal")?.classList.add("open");
  renderGcalStatus();
}

// ---------- UI ----------
function renderGcalStatus() {
  const connected = gcalConnected();
  const connectBtn = $("gcalConnectBtn"), disconnectBtn = $("gcalDisconnectBtn"),
        syncBtn = $("gcalSyncAllBtn"), count = $("gcalCount");

  // status appears in two places (profile card + modal)
  [$("gcalDot"), $("gcalDot2")].forEach((d) => {
    if (d) d.className = "gcal-dot " + (connected ? "on" : "off");
  });
  const staysConnected = gcalHasRefresh;
  [$("gcalLabel"), $("gcalLabel2")].forEach((l) => {
    if (l) l.textContent = !connected ? "Not connected"
      : staysConnected ? "Connected — stays signed in" : "Connected";
  });
  const warn = $("gcalWarn");
  if (warn) {
    warn.textContent = staysConnected
      ? "Prio keeps your Google session alive automatically, so you shouldn't need to reconnect."
      : "Google sign-ins last about an hour. If syncing stops working, tap Reconnect.";
    warn.classList.toggle("good", staysConnected);
  }
  if (connectBtn) connectBtn.textContent = connected
    ? (gcalHasRefresh ? "Re-authorise Google" : "Reconnect")
    : "Connect Google Calendar";
  if (disconnectBtn) disconnectBtn.style.display = connected ? "" : "none";
  if (syncBtn) syncBtn.disabled = !connected;
  if (count) {
    const n = gcalLinks.length;
    count.textContent = n ? `${n} item${n === 1 ? "" : "s"} linked to your Google Calendar` : "Nothing synced yet";
  }
  const auto = $("gcalAutoToggle");
  if (auto) {
    const on = gcalAutoOn();
    auto.classList.toggle("on", on);
    auto.setAttribute("aria-checked", on ? "true" : "false");
    auto.disabled = !connected;
    auto.style.opacity = connected ? "" : "0.4";
  }
}

function wireGcalEvents() {
  $("gcalConnectBtn")?.addEventListener("click", gcalConnect);
  $("gcalAutoToggle")?.addEventListener("click", () => {
    if (!gcalConnected()) return;
    gcalSetAuto(!gcalAutoOn());
  });
  $("gcalDisconnectBtn")?.addEventListener("click", gcalDisconnect);
  $("gcalSyncAllBtn")?.addEventListener("click", gcalSyncAll);
  $("gcalOpenBtn")?.addEventListener("click", () => { $("gcalModal")?.classList.add("open"); renderGcalStatus(); });
  $("gcalClose")?.addEventListener("click", () => $("gcalModal")?.classList.remove("open"));
  $("gcalModal")?.addEventListener("click", (e) => { if (e.target.id === "gcalModal") $("gcalModal").classList.remove("open"); });
}

// ============================================
// Phase 5b · Auto-sync to Google Calendar
//
// Once connected, Prio pushes changes automatically instead of making
// the user tap sync every time. Design rules:
//  - never block saving: sync runs AFTER the item is safely in Supabase
//  - never lose data to a Google outage: failures are silent + queued
//  - never spam the API: changes are debounced and de-duplicated
// ============================================
const GCAL_AUTO_KEY = "prio_gcal_auto";
let gcalQueue = new Map();     // "type:id" -> item, pending push
let gcalQueueTimer = null;
let gcalSyncing = false;

function gcalAutoOn() {
  // default ON once connected — that's the point of connecting
  const raw = localStorage.getItem(GCAL_AUTO_KEY);
  return raw === null ? true : raw === "1";
}
function gcalSetAuto(on) {
  localStorage.setItem(GCAL_AUTO_KEY, on ? "1" : "0");
  renderGcalStatus();
  toast(on ? "Auto-sync on — changes go to Google automatically" : "Auto-sync off");
  if (on) gcalFlushQueue();
}

// Should this item go to Google at all?
function gcalShouldSync(type, item) {
  if (!item) return false;
  if (type === "event") return item.owner_id === user.id;
  if (type === "shift") return !!item.starts_at && !!item.ends_at;
  if (type === "project") return !!item.due_date && !item.completed;
  if (type === "assessment") return !!item.due_date;
  if (type === "routine") return !!item.days;
  if (type === "class") return Number.isInteger(Number(item.day_of_week));
  if (type === "break") return !!item.start && !!item.end;
  // tasks: only dated, incomplete ones are useful in a calendar
  return !!item.due_date && !item.completed;
}

// Queue a change. Safe to call on every save — it de-dupes by id.
function gcalAutoSync(type, item) {
  if (!gcalAutoOn() || !gcalConnected()) return;
  if (!gcalShouldSync(type, item)) {
    // no longer syncable (completed, date removed) → clean up any Google copy
    if (gcalLinkFor(type, item?.id)) gcalAutoRemove(type, item.id);
    return;
  }
  gcalQueue.set(`${type}:${item.id}`, { type, item });
  clearTimeout(gcalQueueTimer);
  // small delay so rapid edits collapse into one API call
  gcalQueueTimer = setTimeout(gcalFlushQueue, 700);
}

function gcalAutoRemove(type, id) {
  if (!gcalConnected() || !gcalLinkFor(type, id)) return;
  gcalQueue.delete(`${type}:${id}`);
  gcalRemove(type, id).catch(() => { /* silent — deleting locally already worked */ });
}

async function gcalFlushQueue() {
  if (gcalSyncing || !gcalQueue.size) return;
  if (!gcalAutoOn() || !gcalConnected()) return;

  gcalSyncing = true;
  gcalShowSyncing(true);

  const batch = [...gcalQueue.values()];
  gcalQueue.clear();
  let expired = false;

  for (const { type, item } of batch) {
    try {
      await gcalPush(type, item, { silent: true });
    } catch (err) {
      if (err.message === "TOKEN_EXPIRED" || err.message === "NOT_CONNECTED") {
        // put the rest back and stop — we'll retry after reconnecting
        gcalQueue.set(`${type}:${item.id}`, { type, item });
        expired = true;
        break;
      }
      // any other failure: drop it rather than blocking the user
      console.warn("Google sync failed for", type, item.id, err.message);
    }
  }

  gcalSyncing = false;
  gcalShowSyncing(false);
  renderGcalStatus();

  if (expired) {
    toast("Google sign-in expired — reconnect to resume syncing");
    gcalPromptConnect();
  }
}

// subtle activity indicator, no interruption
function gcalShowSyncing(on) {
  const pill = $("gcalSyncingPill");
  if (pill) pill.classList.toggle("show", on);
  [$("gcalDot"), $("gcalDot2")].forEach((d) => d && d.classList.toggle("syncing", on));
}

// After reconnecting, push anything that was waiting.
function gcalResumeAfterReconnect() {
  if (gcalConnected() && gcalQueue.size) setTimeout(gcalFlushQueue, 400);
}

// ============================================
// Delete account
// Irreversible, so: explicit modal, typed email confirmation, and the
// button stays disabled until the email matches exactly.
// ============================================
function openDeleteAccount() {
  $("deleteConfirmEmail").value = "";
  $("deleteAccountConfirm").disabled = true;
  $("deleteAccountModal").classList.add("open");
  setTimeout(() => $("deleteConfirmEmail").focus(), 250);
}

function closeDeleteAccount() {
  $("deleteAccountModal")?.classList.remove("open");
}

function checkDeleteConfirm() {
  const typed = ($("deleteConfirmEmail").value || "").trim().toLowerCase();
  const mine = (user?.email || "").toLowerCase();
  const match = !!typed && typed === mine;
  $("deleteAccountConfirm").disabled = !match;
  $("deleteConfirmEmail").closest(".input-shell")?.classList.toggle("matched", match);
}

async function confirmDeleteAccount() {
  const btn = $("deleteAccountConfirm");
  const typed = ($("deleteConfirmEmail").value || "").trim();
  if (typed.toLowerCase() !== (user?.email || "").toLowerCase()) return;

  btn.disabled = true;
  btn.textContent = "Deleting…";

  try {
    const { data: sess } = await db.auth.getSession();
    const jwt = sess?.session?.access_token;
    if (!jwt) throw new Error("Session expired — log in again.");

    const res = await fetch("/api/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + jwt },
      body: JSON.stringify({ confirm_email: typed }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.error === "EMAIL_MISMATCH") throw new Error("That email doesn't match this account.");
      throw new Error(data.error || "Couldn't delete the account.");
    }

    // gone — clear everything local and send them out
    try {
      sessionStorage.clear();
      localStorage.removeItem(GCAL_TOKEN_KEY);
      localStorage.removeItem(GCAL_AUTO_KEY);
      localStorage.removeItem(onboardingKey());
    } catch {}
    await db.auth.signOut();
    window.location.href = "index.html";
  } catch (err) {
    toast(err.message || "Couldn't delete the account");
    btn.disabled = false;
    btn.textContent = "Delete forever";
  }
}

function wireDeleteAccount() {
  $("deleteAccountBtn")?.addEventListener("click", openDeleteAccount);
  $("deleteAccountCancel")?.addEventListener("click", closeDeleteAccount);
  $("deleteAccountClose")?.addEventListener("click", closeDeleteAccount);
  $("deleteAccountModal")?.addEventListener("click", (e) => {
    if (e.target.id === "deleteAccountModal") closeDeleteAccount();
  });
  $("deleteConfirmEmail")?.addEventListener("input", checkDeleteConfirm);
  $("deleteConfirmEmail")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !$("deleteAccountConfirm").disabled) confirmDeleteAccount();
    if (e.key === "Escape") closeDeleteAccount();
  });
  $("deleteAccountConfirm")?.addEventListener("click", confirmDeleteAccount);
}

// ============================================
// Phase 7 · Work shifts
// A shift is a timed entry with optional unpaid breaks. Shifts flow into
// the calendar and Google sync exactly like events do.
// ============================================
let shifts = [];
let editingShiftId = null;
let shiftBreaksDraft = [];   // [{start:"12:00", end:"12:30", label:"Lunch"}]

async function loadShifts() {
  const { data } = await db.from("work_shifts").select("*").eq("user_id", user.id).order("starts_at");
  shifts = data || [];
}

function shiftDateStr(sh) {
  const d = new Date(sh.starts_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftsForDate(iso) {
  return shifts.filter((s) => shiftDateStr(s) === iso)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

// worked minutes = span minus the breaks
function shiftPaidMinutes(sh) {
  const total = (new Date(sh.ends_at) - new Date(sh.starts_at)) / 60000;
  const brk = (sh.breaks || []).reduce((sum, b) => {
    if (!b.start || !b.end) return sum;
    const [sh1, sm1] = b.start.split(":").map(Number);
    const [sh2, sm2] = b.end.split(":").map(Number);
    return sum + Math.max(0, (sh2 * 60 + sm2) - (sh1 * 60 + sm1));
  }, 0);
  return Math.max(0, total - brk);
}

function fmtDuration(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function shiftTimeLabel(sh) {
  const f = (t) => new Date(t).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return `${f(sh.starts_at)} – ${f(sh.ends_at)}`;
}

// ---------- calendar day panel ----------
function shiftsPanelHTML(iso) {
  const list = shiftsForDate(iso);
  if (!list.length) return "";
  return `
    <div class="calendar-shift-list">
      <h4>Work</h4>
      ${list.map((sh) => {
        const brk = (sh.breaks || []).length;
        return `
        <div class="calendar-shift" data-id="${sh.id}" style="--shift-color:${esc(sh.color || "#18c2c2")}">
          <span class="cs-emoji">💼</span>
          <div class="cs-body">
            <strong>${esc(sh.title || "Work")}</strong>
            <p>${esc(shiftTimeLabel(sh))} · ${fmtDuration(shiftPaidMinutes(sh))}${sh.location ? " · " + esc(sh.location) : ""}</p>
            ${brk ? `<p class="cs-breaks">☕ ${brk} break${brk === 1 ? "" : "s"}</p>` : ""}
          </div>
          <div class="cs-actions">
            <button class="icon-btn edit" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/></svg></button>
            <button class="icon-btn del" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg></button>
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

function wireShiftPanel(scope) {
  scope.querySelectorAll(".calendar-shift").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".edit")?.addEventListener("click", () => openShiftModal(id));
    el.querySelector(".del")?.addEventListener("click", () => deleteShift(id));
  });
}

// ---------- view ----------
function renderWork() {
  const root = $("workRoot");
  if (!root) return;

  const now = new Date();
  const upcoming = shifts.filter((s) => new Date(s.ends_at) >= now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const past = shifts.filter((s) => new Date(s.ends_at) < now)
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

  // hours this week (Mon–Sun)
  const weekStart = new Date(now);
  const dow = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dow); weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const weekMins = shifts
    .filter((s) => { const d = new Date(s.starts_at); return d >= weekStart && d < weekEnd; })
    .reduce((sum, s) => sum + shiftPaidMinutes(s), 0);

  const card = (sh, isPast) => {
    const brk = (sh.breaks || []).length;
    return `
    <div class="work-shift ${isPast ? "past" : ""}" data-id="${sh.id}" style="--shift-color:${esc(sh.color || "#18c2c2")}">
      <div class="ws-main">
        <div class="ws-title-row">
          <strong>${esc(sh.title || "Work")}</strong>
          <span class="ws-hours">${fmtDuration(shiftPaidMinutes(sh))}</span>
        </div>
        <p class="ws-when">${esc(new Date(sh.starts_at).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }))} · ${esc(shiftTimeLabel(sh))}</p>
        ${sh.location ? `<p class="ws-loc">📍 ${esc(sh.location)}</p>` : ""}
        ${brk ? `<p class="ws-breaks">☕ ${brk} break${brk === 1 ? "" : "s"} · ${(sh.breaks || []).map((b) => esc(b.label || "Break")).join(", ")}</p>` : ""}
      </div>
      <div class="ws-actions">
        <button class="icon-btn gcal" title="Add to Google Calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M12 14v4M10 16h4"/></svg></button>
        <button class="icon-btn edit" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/></svg></button>
        <button class="icon-btn del" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg></button>
      </div>
    </div>`;
  };

  root.innerHTML = `
    <div class="section-head">
      <h2>Work</h2>
      <button class="btn-primary" id="addShiftBtn">+ Add shift</button>
    </div>

    <div class="work-stats">
      <div class="work-stat">
        <span class="ws-num">${fmtDuration(weekMins) || "0m"}</span>
        <span class="ws-lbl">This week</span>
      </div>
      <div class="work-stat">
        <span class="ws-num">${upcoming.length}</span>
        <span class="ws-lbl">Upcoming</span>
      </div>
      <div class="work-stat">
        <span class="ws-num">${shifts.length}</span>
        <span class="ws-lbl">Total logged</span>
      </div>
    </div>

    ${upcoming.length ? `
      <h3 class="work-group-title">Upcoming</h3>
      <div class="work-list">${upcoming.map((s) => card(s, false)).join("")}</div>` : `
      <div class="empty"><span class="emoji">💼</span>No upcoming shifts. Tap “Add shift” to log one.</div>`}

    ${past.length ? `
      <h3 class="work-group-title">Past</h3>
      <div class="work-list">${past.slice(0, 10).map((s) => card(s, true)).join("")}</div>` : ""}
  `;

  $("addShiftBtn")?.addEventListener("click", () => openShiftModal());
  root.querySelectorAll(".work-shift").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".edit")?.addEventListener("click", () => openShiftModal(id));
    el.querySelector(".del")?.addEventListener("click", () => deleteShift(id));
    el.querySelector(".gcal")?.addEventListener("click", () => {
      const sh = shifts.find((x) => x.id === id);
      if (gcalConnected() && sh) gcalSyncOne("shift", sh);
      else shiftToGoogleLink(sh);
    });
  });
}

// ---------- modal ----------
function openShiftModal(shiftId = null, presetDate = null) {
  editingShiftId = shiftId;
  const sh = shiftId ? shifts.find((x) => x.id === shiftId) : null;

  $("shiftModalTitle").textContent = sh ? "Edit shift" : "New shift";
  $("shiftTitle").value = sh ? sh.title || "" : "";
  $("shiftLocation").value = sh ? sh.location || "" : "";
  $("shiftNotes").value = sh ? sh.notes || "" : "";
  $("shiftRepeat").value = "none";
  renderPrettySelect("shiftRepeat");
  $("shiftRepeat").disabled = !!sh;
  setDateInput("shiftRepeatUntil", "");
  updateShiftRepeatUI();

  if (sh) {
    const s = new Date(sh.starts_at), e = new Date(sh.ends_at);
    setDateInput("shiftDate", shiftDateStr(sh));
    setTimeInput("shiftStart", `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`);
    setTimeInput("shiftEnd", `${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`);
    shiftBreaksDraft = JSON.parse(JSON.stringify(sh.breaks || []));
  } else {
    setDateInput("shiftDate", presetDate || selectedDate || todayStr());
    setTimeInput("shiftStart", "09:00");
    setTimeInput("shiftEnd", "17:00");
    shiftBreaksDraft = [];
  }

  renderShiftBreaks();
  renderShiftSummary();
  $("shiftModal").classList.add("open");
  setTimeout(() => $("shiftTitle").focus(), 250);
}

function closeShiftModal() {
  $("shiftModal")?.classList.remove("open");
  editingShiftId = null;
  shiftBreaksDraft = [];
}

function renderShiftBreaks() {
  const wrap = $("shiftBreaks");
  const hint = $("shiftBreakHint");
  if (!shiftBreaksDraft.length) {
    wrap.innerHTML = "";
    if (hint) hint.style.display = "";
    return;
  }
  if (hint) hint.style.display = "none";
  wrap.innerHTML = shiftBreaksDraft.map((b, i) => `
    <div class="shift-break-row" data-i="${i}">
      <input type="text" class="sb-label" value="${esc(b.label || "")}" placeholder="Lunch" maxlength="24" />
      <div class="sb-times">
        <button type="button" class="sb-time" data-field="start">${b.start ? esc(prettyTimeValue(b.start)) : "Start"}</button>
        <span>–</span>
        <button type="button" class="sb-time" data-field="end">${b.end ? esc(prettyTimeValue(b.end)) : "End"}</button>
      </div>
      <button type="button" class="icon-btn sb-del" aria-label="Remove break"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>`).join("");

  wrap.querySelectorAll(".shift-break-row").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector(".sb-label").addEventListener("input", (e) => { shiftBreaksDraft[i].label = e.target.value; });
    row.querySelectorAll(".sb-time").forEach((btn) => {
      btn.addEventListener("click", () => {
        // reuse the app's time picker, writing back into the break
        openTimePicker.__shiftBreak = { i, field: btn.dataset.field };
        openBreakTimePicker(i, btn.dataset.field);
      });
    });
    row.querySelector(".sb-del").addEventListener("click", () => {
      shiftBreaksDraft.splice(i, 1);
      renderShiftBreaks();
      renderShiftSummary();
    });
  });
}

// a lightweight wrapper around the existing time picker for breaks
function openBreakTimePicker(i, field) {
  const cur = shiftBreaksDraft[i][field] || (field === "start" ? "12:00" : "12:30");
  const [h, m] = cur.split(":").map(Number);
  tpHour = h; tpMinute = m;
  timePickerTargetId = "__break";
  $("timePickerKicker").textContent = field === "start" ? "Break start" : "Break end";
  syncTimeFields();
  $("timePickerModal").classList.add("open");
  // remember where to write the result
  timePickerBreakTarget = { i, field };
}
let timePickerBreakTarget = null;

function addShiftBreak() {
  shiftBreaksDraft.push({ label: "", start: "12:00", end: "12:30" });
  renderShiftBreaks();
  renderShiftSummary();
}

function renderShiftSummary() {
  const date = $("shiftDate").dataset.iso;
  const st = getTimeInput("shiftStart"), en = getTimeInput("shiftEnd");
  const box = $("shiftSummary");
  if (!date || !st || !en) { box.innerHTML = ""; return; }
  const starts = new Date(`${date}T${st}`);
  let ends = new Date(`${date}T${en}`);
  if (ends <= starts) { box.innerHTML = `<span class="ss-warn">End time must be after the start</span>`; return; }
  const fakeShift = { starts_at: starts.toISOString(), ends_at: ends.toISOString(), breaks: shiftBreaksDraft };
  const paid = shiftPaidMinutes(fakeShift);
  const brkMins = ((ends - starts) / 60000) - paid;
  box.innerHTML = `<span class="ss-main">${fmtDuration(paid)} worked</span>${brkMins > 0 ? `<span class="ss-sub">${fmtDuration(brkMins)} on break</span>` : ""}`;
}

function updateShiftRepeatUI() {
  const repeat = $("shiftRepeat")?.value || "none";
  const field = $("shiftRepeatUntilField");
  const hint = $("shiftRepeatHint");
  if (field) field.hidden = repeat === "none";
  if (hint) hint.style.display = repeat === "none" ? "none" : "";
  if (repeat !== "none" && !$("shiftRepeatUntil")?.dataset.iso) {
    const startIso = $("shiftDate")?.dataset.iso || todayStr();
    const d = new Date(startIso + "T00:00:00");
    d.setDate(d.getDate() + (repeat === "business" ? 42 : 84));
    setDateInput("shiftRepeatUntil", localDateStr(d));
  }
}

function recurringShiftDates(startIso, untilIso, repeat) {
  if (repeat === "none") return [startIso];
  const out = [];
  const start = new Date(startIso + "T00:00:00");
  const until = new Date(untilIso + "T23:59:59");
  const cursor = new Date(start);
  while (cursor <= until && out.length < 260) {
    const day = cursor.getDay();
    if (repeat === "weekly" || (repeat === "business" && day >= 1 && day <= 5)) {
      out.push(localDateStr(cursor));
    }
    cursor.setDate(cursor.getDate() + (repeat === "weekly" ? 7 : 1));
  }
  return out;
}

async function saveShift() {
  const title = $("shiftTitle").value.trim() || "Work";
  const date = $("shiftDate").dataset.iso;
  if (!date) return toast("Pick a date for the shift");
  const st = getTimeInput("shiftStart"), en = getTimeInput("shiftEnd");
  if (!st || !en) return toast("Set a start and end time");

  const starts = new Date(`${date}T${st}`);
  const ends = new Date(`${date}T${en}`);
  if (ends <= starts) return toast("End time must be after the start time");

  // keep only valid breaks
  const breaks = shiftBreaksDraft.filter((b) => b.start && b.end && b.end > b.start);

  const payload = {
    user_id: user.id,
    title,
    location: $("shiftLocation").value.trim() || null,
    notes: $("shiftNotes").value.trim() || null,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    breaks,
    color: "#18c2c2",
  };

  const btn = $("shiftSave");
  btn.disabled = true;
  try {
    let shiftId = editingShiftId;
    let createdCount = 1;
    let createdShiftIds = [];
    if (shiftId) {
      const { error } = await db.from("work_shifts").update(payload).eq("id", shiftId);
      if (error) throw error;
    } else {
      const repeat = $("shiftRepeat")?.value || "none";
      const until = $("shiftRepeatUntil")?.dataset.iso || date;
      if (repeat !== "none" && until < date) throw new Error("Repeat end must be after the first shift");
      const dates = recurringShiftDates(date, until, repeat);
      if (!dates.length) throw new Error("No shifts fall inside that repeat range");
      const rows = dates.map((iso) => {
        const rowStart = new Date(`${iso}T${st}`);
        const rowEnd = new Date(`${iso}T${en}`);
        return { ...payload, starts_at: rowStart.toISOString(), ends_at: rowEnd.toISOString() };
      });
      const { data, error } = await db.from("work_shifts").insert(rows).select();
      if (error) throw error;
      shiftId = data?.[0]?.id;
      createdCount = data?.length || rows.length;
      createdShiftIds = (data || []).map((row) => row.id);
    }
    await loadShifts();
    renderWork();
    renderCalendar();
    closeShiftModal();
    toast(editingShiftId ? "Shift updated 💼" : (createdCount > 1 ? `${createdCount} recurring shifts added 💼` : "Shift added 💼"));

    // background sync to Google
    const saved = shifts.find((x) => x.id === shiftId);
    if (saved) gcalAutoSync("shift", saved);
    if (!editingShiftId && createdCount > 1 && gcalConnected() && gcalAutoOn()) {
      shifts.filter((x) => createdShiftIds.includes(x.id)).forEach((x) => gcalAutoSync("shift", x));
    }
  } catch (err) {
    toast(String(err.message).includes("work_shifts") ? "Couldn't save — run schema-update-8.sql" : "Couldn't save — try again");
  } finally {
    btn.disabled = false;
  }
}

async function deleteShift(id) {
  const sh = shifts.find((x) => x.id === id);
  if (!sh) return;
  if (!confirm(`Delete this ${esc(sh.title || "work")} shift?`)) return;
  gcalAutoRemove("shift", id);
  const { error } = await db.from("work_shifts").delete().eq("id", id);
  if (error) return toast("Couldn't delete — try again");
  shifts = shifts.filter((x) => x.id !== id);
  renderWork();
  renderCalendar();
  toast("Shift deleted");
}

// manual "add to Google" link when not connected
function shiftToGoogleLink(sh) {
  if (!sh) return;
  const stamp = (d) => new Date(d).toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
  const details = [
    sh.notes,
    (sh.breaks || []).length ? "Breaks: " + sh.breaks.map((b) => `${b.label || "Break"} ${b.start}–${b.end}`).join(", ") : "",
    "— added from Prio",
  ].filter(Boolean).join("\n");
  const url = "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(sh.title || "Work")}` +
    `&dates=${stamp(sh.starts_at)}/${stamp(sh.ends_at)}` +
    `&details=${encodeURIComponent(details)}` +
    (sh.location ? `&location=${encodeURIComponent(sh.location)}` : "");
  window.open(url, "_blank");
  toast("Opening Google Calendar 📅");
}

function wireShiftEvents() {
  $("shiftCancel")?.addEventListener("click", closeShiftModal);
  $("shiftSave")?.addEventListener("click", saveShift);
  $("shiftModal")?.addEventListener("click", (e) => { if (e.target.id === "shiftModal") closeShiftModal(); });
  $("shiftAddBreak")?.addEventListener("click", addShiftBreak);
  $("shiftRepeat")?.addEventListener("change", updateShiftRepeatUI);
  $("shiftRepeatUntil")?.addEventListener("click", () => openDatePicker("shiftRepeatUntil"));
  $("shiftDate")?.addEventListener("click", () => openDatePicker("shiftDate"));
  $("shiftStart")?.addEventListener("click", () => openTimePicker("shiftStart", "Shift start"));
  $("shiftEnd")?.addEventListener("click", () => openTimePicker("shiftEnd", "Shift end"));
}
