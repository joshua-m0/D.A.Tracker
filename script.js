const activityForm        = document.querySelector("#activityForm");
const activityNameInput   = document.querySelector("#activityName");
const activityStartInput  = document.querySelector("#activityStartTime");
const activityDurInput    = document.querySelector("#activityDuration");
const activityCatInput    = document.querySelector("#activityCategory");
const activityNotesInput  = document.querySelector("#activityNotes");
const activityReminderInput = document.querySelector("#activityReminder");
const taskList            = document.querySelector("#taskList");
const emptyMessage        = document.querySelector("#emptyMessage");
const progressText        = document.querySelector("#progressText");
const progressFill        = document.querySelector("#progressFill");
const resetButton         = document.querySelector("#resetButton");
const addButton           = document.querySelector(".add-button");
const clockEl             = document.querySelector("#liveClock");
const alarmToast          = document.querySelector("#alarmToast");
const alarmTitle          = document.querySelector("#alarmTitle");
const alarmSub            = document.querySelector("#alarmSub");
const alarmDismiss        = document.querySelector("#alarmDismiss");

const STORAGE_KEY  = "dailyActivities";
const RECORDS_KEY  = "activityRecords";
const SETTINGS_KEY = "daTrackerSettings";
const activities   = [];
let editingIndex   = null;
let alarmTimeouts  = [];   // track scheduled alarms so we can cancel on edit/delete
let audioCtx       = null; // Web Audio context — created on first user gesture

/* ── Settings ── */
const SETTING_DEFAULTS = {
  theme:            "dark",
  accent:           "#f5a623",
  fontSize:         "15",
  inAppAlarm:       true,
  alarmSound:       true,
  defaultReminder:  10,
  toastDuration:    10,
  defaultCategory:  "other",
  defaultDuration:  60,
  highlightOverdue: true,
  resetTime:        "00:00"
};

function getSettings() {
  try {
    return Object.assign({}, SETTING_DEFAULTS,
      JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch(_) { return Object.assign({}, SETTING_DEFAULTS); }
}

function applySettingsToPage() {
  const s = getSettings();

  // Theme
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = s.theme === "dark" || (s.theme === "system" && prefersDark);
  document.body.classList.toggle("theme-light", !dark);

  // Accent colour
  document.documentElement.style.setProperty("--accent",     s.accent);
  document.documentElement.style.setProperty("--accent-dim", s.accent + "22");
  // naive lighten for hover
  const r = parseInt(s.accent.slice(1,3),16),
        g = parseInt(s.accent.slice(3,5),16),
        b = parseInt(s.accent.slice(5,7),16);
  const lh = "#" + [Math.min(255,r+51),Math.min(255,g+51),Math.min(255,b+51)]
    .map(function(v){ return v.toString(16).padStart(2,"0"); }).join("");
  document.documentElement.style.setProperty("--accent-h", lh);

  // Font size
  document.body.style.fontSize = s.fontSize + "px";

  // Pre-fill form defaults (only when fields are empty / untouched)
  if (activityCatInput && !activityCatInput.dataset.touched) {
    activityCatInput.value = s.defaultCategory;
  }
  if (activityDurInput && !activityDurInput.dataset.touched && !activityDurInput.value) {
    activityDurInput.placeholder = s.defaultDuration;
  }
  if (activityReminderInput && !activityReminderInput.dataset.touched && !activityReminderInput.value) {
    activityReminderInput.placeholder = s.defaultReminder;
  }
}

// Mark fields as "user-touched" so we don't overwrite their edits
[activityCatInput, activityDurInput, activityReminderInput].forEach(function(el) {
  if (el) el.addEventListener("change", function() { el.dataset.touched = "1"; });
});

const CATEGORIES = {
  health:   { label: "Health",   color: "#00d68f" },
  work:     { label: "Work",     color: "#f5a623" },
  personal: { label: "Personal", color: "#a78bfa" },
  social:   { label: "Social",   color: "#38bdf8" },
  other:    { label: "Other",    color: "#8b93a8" }
};

/* ── Audio ── */
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// Unlock audio on first tap/click (required by browsers)
document.addEventListener("click", function() { getAudioCtx(); }, { once: true });

function playAlarm() {
  if (!getSettings().alarmSound) return;   // respect settings
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();

    // Three rising beeps
    [0, 0.35, 0.7].forEach(function(offset, i) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.value = 880 + i * 220;   // 880, 1100, 1320 Hz

      gain.gain.setValueAtTime(0, ctx.currentTime + offset);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + offset + 0.05);
      gain.gain.linearRampToValueAtTime(0,   ctx.currentTime + offset + 0.28);

      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.3);
    });
  } catch(e) {
    console.warn("Audio error:", e);
  }
}

function showAlarmToast(name, minutesBefore) {
  if (!alarmToast) return;
  if (!getSettings().inAppAlarm) return;   // respect settings
  alarmTitle.textContent = "⏰ " + name;
  alarmSub.textContent   = minutesBefore === 0
    ? "Starting now!"
    : "Starts in " + minutesBefore + " minute" + (minutesBefore === 1 ? "" : "s");
  alarmToast.style.display = "flex";
  alarmToast.classList.add("alarm-show");

  // Auto-hide using toastDuration setting (0 = never)
  const secs = Number(getSettings().toastDuration);
  if (secs > 0) setTimeout(function() { hideAlarmToast(); }, secs * 1000);
}

function hideAlarmToast() {
  if (!alarmToast) return;
  alarmToast.classList.remove("alarm-show");
  setTimeout(function() { alarmToast.style.display = "none"; }, 300);
}

if (alarmDismiss) {
  alarmDismiss.addEventListener("click", hideAlarmToast);
}

/* ── Schedule alarms ── */
function clearAllAlarms() {
  alarmTimeouts.forEach(function(id) { clearTimeout(id); });
  alarmTimeouts = [];
}

function scheduleAlarms() {
  clearAllAlarms();
  const now = new Date();
  const nowMs = now.getTime();

  activities.forEach(function(a) {
    if (!a.reminder || Number(a.reminder) < 0) return;
    if (a.completed) return;

    const reminderMins = Number(a.reminder);

    // Calculate today's alarm time in ms
    const parts = a.startTime.split(":");
    const alarmDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Number(parts[0]), Number(parts[1]) - reminderMins, 0);
    const delay = alarmDate.getTime() - nowMs;

    if (delay < 0) return; // already passed today

    const id = setTimeout(function() {
      if (!a.completed) {
        playAlarm();
        showAlarmToast(a.name, reminderMins);
      }
    }, delay);

    alarmTimeouts.push(id);
  });
}

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
  ctx.strokeStyle = "#1f2435"; ctx.lineWidth = lw; ctx.stroke();

  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct);
    ctx.strokeStyle = pct === 1 ? "#00d68f" : "#f5a623";
    ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.stroke();
  }

  ctx.fillStyle = "#f0f2f8";
  ctx.font = "bold " + Math.round(sz*0.18) + "px Syne,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
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
function toMins(t) { const p = t.split(":"); return Number(p[0])*60 + Number(p[1]); }
function fromMins(m) {
  const t = m % (24*60);
  return String(Math.floor(t/60)).padStart(2,"0") + ":" + String(t%60).padStart(2,"0");
}
function endTime(start, dur) { return fromMins(toMins(start) + Number(dur)); }
function isOverdue(a) { return getSettings().highlightOverdue && a.endTime < getNow() && !a.completed; }

/* ── Storage ── */
function saveActivities() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(activities));
  saveTodayRecord();
  scheduleAlarms();
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
      notes: a.notes || "",
      reminder: a.reminder !== undefined ? a.reminder : ""
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
    date: todayKey(), savedAt: new Date().toISOString(),
    activities: activities.map(function(a) {
      return { name: a.name, startTime: a.startTime, endTime: a.endTime,
               duration: a.duration, completed: a.completed,
               category: a.category || "other", notes: a.notes || "",
               reminder: a.reminder || "" };
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

function applyFormDefaults() {
  const s = getSettings();
  if (activityCatInput)      activityCatInput.value      = s.defaultCategory;
  if (activityDurInput)      activityDurInput.placeholder = s.defaultDuration;
  if (activityReminderInput) activityReminderInput.placeholder = s.defaultReminder;
  // clear touched flags
  [activityCatInput, activityDurInput, activityReminderInput].forEach(function(el) {
    if (el) delete el.dataset.touched;
  });
}

/* ── Edit / Delete ── */
function cancelEdit() {
  editingIndex = null;
  addButton.textContent = "Add Activity";
  addButton.classList.remove("save-button");
  activityForm.reset();
  applyFormDefaults();
  activityNameInput.focus();
}

function startEdit(i) {
  const a = activities[i];
  editingIndex = i;
  activityNameInput.value  = a.name;
  activityStartInput.value = a.startTime;
  activityDurInput.value   = a.duration;
  if (activityCatInput)      activityCatInput.value      = a.category || "other";
  if (activityNotesInput)    activityNotesInput.value    = a.notes || "";
  if (activityReminderInput) activityReminderInput.value = a.reminder !== "" ? a.reminder : "";
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

function saveEdit(name, start, dur, cat, notes, reminder) {
  const a = activities[editingIndex];
  a.name = name; a.startTime = start; a.duration = dur;
  a.endTime = endTime(start, dur); a.category = cat;
  a.notes = notes; a.reminder = reminder;
  cancelEdit(); sortByTime(); saveActivities(); showActivities();
}

/* ── Render ── */
function createItem(activity, i) {
  const cat = CATEGORIES[activity.category] || CATEGORIES.other;
  const li  = document.createElement("li");
  li.className = "task-item" +
    (isOverdue(activity) ? " task-overdue" : "") +
    (editingIndex === i ? " task-editing" : "");

  const label = document.createElement("label");
  label.style.cssText = "display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;cursor:pointer;";

  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.className = "task-checkbox"; cb.checked = activity.completed;
  cb.style.marginTop = "2px";

  const details = document.createElement("span");
  details.className = "task-details";

  const nameRow = document.createElement("span");
  nameRow.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";

  const nameEl = document.createElement("span");
  nameEl.className = "task-name"; nameEl.textContent = activity.name;

  const badge = document.createElement("span");
  badge.className = "cat-badge";
  badge.textContent = cat.label;
  badge.style.cssText = "background:" + cat.color + "22;color:" + cat.color + ";border:1px solid " + cat.color + "44;";

  nameRow.appendChild(nameEl); nameRow.appendChild(badge);

  // Reminder badge
  if (activity.reminder !== "" && activity.reminder !== null && activity.reminder !== undefined) {
    const remBadge = document.createElement("span");
    remBadge.className = "reminder-badge";
    remBadge.textContent = "🔔 " + activity.reminder + "min before";
    nameRow.appendChild(remBadge);
  }

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

function addActivity(name, start, dur, cat, notes, reminder) {
  activities.push({ name, startTime: start, duration: dur,
    endTime: endTime(start, dur), completed: false,
    category: cat, notes, reminder });
  sortByTime(); saveActivities(); showActivities();
}

/* ── Form submit ── */
activityForm.addEventListener("submit", function(e) {
  e.preventDefault();
  const name     = activityNameInput.value.trim();
  const start    = activityStartInput.value;
  const dur      = Number(activityDurInput.value);
  const cat      = activityCatInput ? activityCatInput.value : "other";
  const notes    = activityNotesInput ? activityNotesInput.value.trim() : "";
  const reminder = activityReminderInput && activityReminderInput.value !== ""
    ? Number(activityReminderInput.value) : "";

  if (!name || !start || dur <= 0) return;

  if (editingIndex !== null) {
    saveEdit(name, start, dur, cat, notes, reminder);
  } else {
    addActivity(name, start, dur, cat, notes, reminder);
    activityForm.reset();
    applyFormDefaults();
    activityNameInput.focus();
  }
});

resetButton.addEventListener("click", function() {
  if (editingIndex !== null) cancelEdit();
  activities.forEach(function(a){ a.completed = false; });
  saveActivities(); showActivities();
});

applySettingsToPage();
loadActivities(); sortByTime(); showActivities();
applyFormDefaults();
scheduleAlarms();
setInterval(showActivities, 60000);
scheduleEndOfDaySave();
