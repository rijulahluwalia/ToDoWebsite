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
init();
async function init() {
  const { data } = await db.auth.getSession();
  if (!data.session) { window.location.href = "index.html"; return; }
  user = data.session.user;

  await loadProfile();
  await loadPriorities();
  await loadTasks();

  renderGreeting();
  renderAll();
  wireEvents();
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
}

// ---------- navigation ----------
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view-" + name).classList.add("active");
  document.querySelectorAll("[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  $("fabBtn").style.display = (name === "tasks" || name === "calendar") ? "grid" : "none";
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
      <button class="icon-btn del" aria-label="Delete task">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg>
      </button>
    </div>`;
}

function renderTasks() {
  const list = $("taskList");
  let shown = tasks;
  if (activeFilter === "done") shown = tasks.filter((t) => t.completed);
  else if (activeFilter !== "all") shown = tasks.filter((t) => t.priority_id === activeFilter && !t.completed);
  else shown = tasks.filter((t) => !t.completed);

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
    el.querySelector(".task-body").addEventListener("click", () => openModal(id));
  });
}

async function toggleTask(id, el) {
  const t = tasks.find((x) => x.id === id);
  t.completed = !t.completed;
  el.classList.toggle("done", t.completed);
  const { error } = await db.from("tasks").update({ completed: t.completed }).eq("id", id);
  if (error) { t.completed = !t.completed; el.classList.toggle("done"); return toast("Couldn't save — try again"); }
  if (t.completed) toast("Nice one ✓");
  setTimeout(() => { renderTasks(); renderCalendar(); }, 500);
}

async function removeTask(id, el) {
  el.classList.add("leaving");
  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) { el.classList.remove("leaving"); return toast("Couldn't delete — try again"); }
  tasks = tasks.filter((t) => t.id !== id);
  setTimeout(() => { renderTasks(); renderCalendar(); }, 350);
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
  const payload = {
    title,
    notes: $("taskNotes").value.trim() || null,
    priority_id: modalPriorityId,
    due_date: $("taskDate").value || null,
    user_id: user.id,
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
