const activityForm        = document.querySelector("#activityForm");
const activityNameInput   = document.querySelector("#activityName");
const activityStartInput  = document.querySelector("#activityStartTime");
const activityDurInput    = document.querySelector("#activityDuration");
const activityCatInput    = document.querySelector("#activityCategory");
const activityNotesInput  = document.querySelector("#activityNotes");
const taskList            = document.querySelector("#taskList");
const emptyMessage        = document.querySelector("#emptyMessage");
const progressText        = document.querySelector("#progressText");
const progressFill        = document.querySelector("#progressFill");
const resetButton         = document.querySelector("#resetButton");
const addButton           = document.querySelector(".add-button");
const clockEl             = document.querySelector("#liveClock");

const STORAGE_KEY  = "dailyActivities";
const RECORDS_KEY  = "activityRecords";
const activities   = [];
let editingIndex   = null;

const CATEGORIES = {
  health:   { label: "Health",   color: "#00d68f" },
  work:     { label: "Work",     color: "#f5a623" },
  personal: { label: "Personal", color: "#a78bfa" },
  social:   { label: "Social",   color: "#38bdf8" },
  other:    { label: "Other",    color: "#8b93a8" }
};

/* ── Live clock ── */
function updateClock() {
  if (!clockEl) return;
  const n = new Date();
  clockEl.textContent =
    String(n.getHours()).padStart(2,"0") + ":" +
    String(n.getMinutes()).padStart(2,"0") + ":" +
    String(n.getSeconds()).padStart(2,"0");
}
updateClock();
setInterval(updateClock, 1000);

/* ── Donut chart ── */
function updateDonut() {
  const canvas = document.getElementById("donutCanvas");
  if (!canvas) return;
  const ctx   = canvas.getContext("2d");
  const total = activities.length;
  const done  = activities.filter(function(a){ return a.completed; }).length;
  const pct   = total ? done / total : 0;
  const sz    = canvas.width;
  const cx = sz/2, cy = sz/2, r = sz*0.36, lw = sz*0.13;

  ctx.clearRect(0, 0, sz, sz);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.strokeStyle = "#1f2435";
  ctx.lineWidth = lw;
  ctx.stroke();

  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct);
    ctx.strokeStyle = pct === 1 ? "#00d68f" : "#f5a623";
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.fillStyle = "#f0f2f8";
  ctx.font = "bold " + Math.round(sz*0.18) + "px Syne,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(Math.round(pct*100) + "%", cx, cy - sz*0.04);
  ctx.fillStyle = "#505769";
  ctx.font = Math.round(sz*0.1) + "px DM Sans,sans-serif";
  ctx.fillText(done + "/" + total, cx, cy + sz*0.14);
}

/* ── Time helpers ── */
function getNow() {
  const n = new Date();
  return String(n.getHours()).padStart(2,"0") + ":" + String(n.getMinutes()).padStart(2,"0");
}

function toMins(t) {
  const p = t.split(":"); return Number(p[0])*60 + Number(p[1]);
}

function fromMins(m) {
  const t = m % (24*60);
  return String(Math.floor(t/60)).padStart(2,"0") + ":" + String(t%60).padStart(2,"0");
}

function endTime(start, dur) { return fromMins(toMins(start) + Number(dur)); }

function isOverdue(a) { return a.endTime < getNow() && !a.completed; }

/* ── Storage ── */
function saveActivities() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(activities));
  saveTodayRecord();
}

function loadActivities() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  JSON.parse(raw).forEach(function(a) {
    const st = a.startTime || a.time;
    const du = Number(a.duration) || 0;
    activities.push({
      name: a.name, startTime: st, duration: du,
      endTime: a.endTime || endTime(st, du),
      completed: a.completed,
      category: a.category || "other",
      notes: a.notes || ""
    });
  });
}

/* ── Records ── */
function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth()+1).padStart(2,"0") + "-" +
    String(d.getDate()).padStart(2,"0");
}

function saveTodayRecord() {
  const records = JSON.parse(localStorage.getItem(RECORDS_KEY) || "{}");
  records[todayKey()] = {
    date: todayKey(),
    savedAt: new Date().toISOString(),
    activities: activities.map(function(a) {
      return { name: a.name, startTime: a.startTime, endTime: a.endTime,
               duration: a.duration, completed: a.completed,
               category: a.category || "other", notes: a.notes || "" };
    })
  };
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

function scheduleEndOfDaySave() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 5);
  setTimeout(function(){ saveTodayRecord(); scheduleEndOfDaySave(); }, midnight - now);
}

/* ── Progress ── */
function updateProgress() {
  const total = activities.length;
  const done  = activities.filter(function(a){ return a.completed; }).length;
  const pct   = total ? (done/total)*100 : 0;
  progressText.textContent = done + "/" + total + " activities completed";
  progressFill.style.width = pct + "%";
  emptyMessage.style.display = total === 0 ? "block" : "none";
  updateDonut();
}

/* ── Edit/Delete ── */
function cancelEdit() {
  editingIndex = null;
  addButton.textContent = "Add Activity";
  addButton.classList.remove("save-button");
  activityForm.reset();
  activityNameInput.focus();
}

function startEdit(i) {
  const a = activities[i];
  editingIndex = i;
  activityNameInput.value  = a.name;
  activityStartInput.value = a.startTime;
  activityDurInput.value   = a.duration;
  if (activityCatInput)   activityCatInput.value   = a.category || "other";
  if (activityNotesInput) activityNotesInput.value = a.notes || "";
  addButton.textContent = "Save Changes";
  addButton.classList.add("save-button");
  activityNameInput.scrollIntoView({ behavior: "smooth", block: "nearest" });
  activityNameInput.focus();
  showActivities();
}

function deleteActivity(i) {
  activities.splice(i, 1);
  if (editingIndex === i) cancelEdit();
  else if (editingIndex !== null && editingIndex > i) editingIndex--;
  saveActivities(); showActivities();
}

function saveEdit(name, start, dur, cat, notes) {
  const a = activities[editingIndex];
  a.name = name; a.startTime = start; a.duration = dur;
  a.endTime = endTime(start, dur); a.category = cat; a.notes = notes;
  cancelEdit(); sortByTime(); saveActivities(); showActivities();
}

/* ── Render ── */
function createItem(activity, i) {
  const cat = CATEGORIES[activity.category] || CATEGORIES.other;
  const li  = document.createElement("li");
  li.className = "task-item" +
    (isOverdue(activity) ? " task-overdue" : "") +
    (editingIndex === i ? " task-editing" : "");

  // Label + checkbox
  const label = document.createElement("label");
  label.style.cssText = "display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;cursor:pointer;";

  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.className = "task-checkbox"; cb.checked = activity.completed;
  cb.style.marginTop = "2px";

  const details = document.createElement("span");
  details.className = "task-details";

  // Name + badge row
  const nameRow = document.createElement("span");
  nameRow.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";

  const nameEl = document.createElement("span");
  nameEl.className = "task-name"; nameEl.textContent = activity.name;

  const badge = document.createElement("span");
  badge.className = "cat-badge";
  badge.textContent = cat.label;
  badge.style.cssText = "background:" + cat.color + "22;color:" + cat.color + ";border:1px solid " + cat.color + "44;";

  nameRow.appendChild(nameEl); nameRow.appendChild(badge);

  const timeEl = document.createElement("span");
  timeEl.className = "task-time";
  timeEl.textContent = activity.startTime + " → " + activity.endTime + " · " + activity.duration + " min";

  details.appendChild(nameRow); details.appendChild(timeEl);

  if (activity.notes) {
    const notesEl = document.createElement("span");
    notesEl.className = "task-notes"; notesEl.textContent = activity.notes;
    details.appendChild(notesEl);
  }

  label.appendChild(cb); label.appendChild(details);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "task-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button"; editBtn.className = "action-button edit-button"; editBtn.textContent = "Edit";

  const delBtn = document.createElement("button");
  delBtn.type = "button"; delBtn.className = "action-button delete-button"; delBtn.textContent = "Delete";

  actions.appendChild(editBtn); actions.appendChild(delBtn);
  li.appendChild(label); li.appendChild(actions);

  cb.addEventListener("change", function(){ activity.completed = cb.checked; saveActivities(); showActivities(); });
  editBtn.addEventListener("click", function(){ startEdit(i); });
  delBtn.addEventListener("click", function(){ deleteActivity(i); });

  return li;
}

function showActivities() {
  taskList.innerHTML = "";
  activities.forEach(function(a, i){ taskList.appendChild(createItem(a, i)); });
  updateProgress();
}

function sortByTime() {
  activities.sort(function(a, b){ return a.startTime.localeCompare(b.startTime); });
}

function addActivity(name, start, dur, cat, notes) {
  activities.push({ name, startTime: start, duration: dur,
    endTime: endTime(start, dur), completed: false, category: cat, notes });
  sortByTime(); saveActivities(); showActivities();
}

/* ── Events ── */
activityForm.addEventListener("submit", function(e) {
  e.preventDefault();
  const name  = activityNameInput.value.trim();
  const start = activityStartInput.value;
  const dur   = Number(activityDurInput.value);
  const cat   = activityCatInput ? activityCatInput.value : "other";
  const notes = activityNotesInput ? activityNotesInput.value.trim() : "";
  if (!name || !start || dur <= 0) return;
  if (editingIndex !== null) {
    saveEdit(name, start, dur, cat, notes);
  } else {
    addActivity(name, start, dur, cat, notes);
    activityForm.reset(); activityNameInput.focus();
  }
});

resetButton.addEventListener("click", function() {
  if (editingIndex !== null) cancelEdit();
  activities.forEach(function(a){ a.completed = false; });
  saveActivities(); showActivities();
});

loadActivities(); sortByTime(); showActivities();
setInterval(showActivities, 60000);
scheduleEndOfDaySave();
