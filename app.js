const storageKey = "reminderpro.reminders";
const syncStatus = {
  enabled: false,
  syncing: false
};

const accountPanel = document.querySelector("#accountPanel");
const accountForm = document.querySelector("#accountForm");
const accountStatus = document.querySelector("#accountStatus");
const registerButton = document.querySelector("#registerButton");
const accountFields = {
  name: document.querySelector("#accountName"),
  email: document.querySelector("#accountEmail"),
  phone: document.querySelector("#accountPhone"),
  password: document.querySelector("#accountPassword")
};
const form = document.querySelector("#reminderForm");
const calendarGrid = document.querySelector("#calendarGrid");
const reminderList = document.querySelector("#reminderList");
const emptyState = document.querySelector("#emptyState");
const filter = document.querySelector("#filter");
const search = document.querySelector("#search");
const submitButton = document.querySelector("#submitButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const exportButton = document.querySelector("#exportButton");
const importButton = document.querySelector("#importButton");
const importFile = document.querySelector("#importFile");
const clearDoneButton = document.querySelector("#clearDoneButton");

const fields = {
  editingId: document.querySelector("#editingId"),
  title: document.querySelector("#title"),
  type: document.querySelector("#type"),
  leadTime: document.querySelector("#leadTime"),
  date: document.querySelector("#date"),
  time: document.querySelector("#time"),
  repeat: document.querySelector("#repeat"),
  email: document.querySelector("#email"),
  phone: document.querySelector("#phone"),
  notes: document.querySelector("#notes"),
  channelEmail: document.querySelector("#channelEmail"),
  channelSms: document.querySelector("#channelSms")
};

let reminders = loadReminders();
let currentUser = null;

setDefaultDateTime();
render();
loadAccount();
registerServiceWorker();

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAccount("login");
});

registerButton.addEventListener("click", async () => {
  await submitAccount("register");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const channels = [];
  if (fields.channelEmail.checked) channels.push("email");
  if (fields.channelSms.checked) channels.push("sms");
  const email = fields.email.value.trim();
  const phone = fields.phone.value.trim();

  if (channels.length === 0) {
    alert("Choose Email, SMS, or both.");
    return;
  }

  if (channels.includes("email") && !email) {
    alert("Add an email address for email reminders.");
    fields.email.focus();
    return;
  }

  if (channels.includes("sms") && !phone) {
    alert("Add a phone number for SMS reminders.");
    fields.phone.focus();
    return;
  }

  const reminderData = {
    title: fields.title.value.trim(),
    type: fields.type.value,
    leadTime: Number(fields.leadTime.value),
    date: fields.date.value,
    time: fields.time.value,
    recurrence: buildRecurrence(),
    email,
    phone,
    notes: fields.notes.value.trim(),
    channels
  };

  if (fields.editingId.value) {
    reminders = reminders.map((item) => {
      if (item.id !== fields.editingId.value) return item;
      return {
        ...item,
        ...reminderData,
        updatedAt: new Date().toISOString()
      };
    });
  } else {
    reminders = [{
      id: crypto.randomUUID(),
      ...reminderData,
      done: false,
      createdAt: new Date().toISOString()
    }, ...reminders];
  }

  saveReminders();
  resetForm();
  render();
});

filter.addEventListener("change", render);
search.addEventListener("input", render);
cancelEditButton.addEventListener("click", resetForm);
exportButton.addEventListener("click", exportReminders);
importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", importReminders);
clearDoneButton.addEventListener("click", clearCompletedReminders);

reminderList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const reminder = reminders.find((item) => item.id === id);
  if (!reminder) return;

  if (button.dataset.action === "toggle") {
    reminder.done = !reminder.done;
  }

  if (button.dataset.action === "edit") {
    startEdit(reminder);
    return;
  }

  if (button.dataset.action === "delete") {
    reminders = reminders.filter((item) => item.id !== id);
  }

  saveReminders();
  render();
});

function loadReminders() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || [];
  } catch {
    return [];
  }
}

function saveReminders() {
  localStorage.setItem(storageKey, JSON.stringify(reminders));
  syncToServer();
}

async function syncFromServer() {
  try {
    const response = await fetch("/api/reminders");
    if (response.status === 401) return;
    if (!response.ok) return;

    const data = await response.json();
    if (!Array.isArray(data.reminders)) return;

    syncStatus.enabled = true;
    reminders = mergeReminders(data.reminders, reminders);
    localStorage.setItem(storageKey, JSON.stringify(reminders));
    render();
    await syncToServer();
  } catch {
    syncStatus.enabled = false;
  }
}

async function syncToServer() {
  if (!currentUser) return;
  if (syncStatus.syncing) return;
  syncStatus.syncing = true;

  try {
    const response = await fetch("/api/reminders/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ reminders })
    });
    if (!response.ok) return;

    const data = await response.json();
    if (Array.isArray(data.reminders)) {
      syncStatus.enabled = true;
      reminders = mergeReminders(reminders, data.reminders);
      localStorage.setItem(storageKey, JSON.stringify(reminders));
    }
  } catch {
    syncStatus.enabled = false;
  } finally {
    syncStatus.syncing = false;
  }
}

async function loadAccount() {
  try {
    const response = await fetch("/api/me");
    if (!response.ok) {
      showSignedOut();
      return;
    }
    const data = await response.json();
    showSignedIn(data.user);
    await syncFromServer();
  } catch {
    showSignedOut();
  }
}

async function submitAccount(mode) {
  const payload = {
    name: accountFields.name.value.trim(),
    email: accountFields.email.value.trim(),
    phone: accountFields.phone.value.trim(),
    password: accountFields.password.value
  };

  try {
    const response = await fetch(`/api/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error || "Account request failed.");
      return;
    }
    accountFields.password.value = "";
    showSignedIn(data.user);
    await syncFromServer();
  } catch {
    alert("Could not connect to the account server.");
  }
}

function showSignedIn(user) {
  currentUser = user;
  accountPanel.classList.add("hidden");
  accountFields.name.value = user.name || "";
  accountFields.email.value = user.email || "";
  accountFields.phone.value = user.phone || "";
  if (!fields.email.value) fields.email.value = user.email || "";
  if (!fields.phone.value) fields.phone.value = user.phone || "";
  accountStatus.innerHTML = `
    <span class="meta">${escapeHtml(user.name || user.email)}</span>
    <button class="ghost-button" id="logoutButton" type="button">Sign out</button>
  `;
  document.querySelector("#logoutButton").addEventListener("click", logout);
}

function showSignedOut() {
  currentUser = null;
  accountPanel.classList.remove("hidden");
  accountStatus.innerHTML = "";
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  currentUser = null;
  reminders = [];
  localStorage.removeItem(storageKey);
  render();
  showSignedOut();
}

function exportReminders() {
  const exportData = {
    app: "ReminderPro",
    version: 1,
    exportedAt: new Date().toISOString(),
    reminders
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reminderpro-${formatDateInput(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importReminders(event) {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    const importedReminders = Array.isArray(data) ? data : data.reminders;
    if (!Array.isArray(importedReminders)) {
      throw new Error("The selected file does not contain reminders.");
    }

    reminders = mergeReminders(reminders, importedReminders.filter(isValidReminder));
    saveReminders();
    render();
  } catch (error) {
    alert(error.message || "Could not import reminders.");
  } finally {
    importFile.value = "";
  }
}

function mergeReminders(currentReminders, importedReminders) {
  const byId = new Map(currentReminders.map((item) => [item.id, item]));
  importedReminders.forEach((item) => {
    const id = item.id || crypto.randomUUID();
    const existing = byId.get(id) || {};
    byId.set(id, {
      ...existing,
      id,
      title: String(item.title || "").trim(),
      type: item.type || "task",
      leadTime: Number(item.leadTime || 0),
      date: item.date,
      time: item.time,
      email: item.email || "",
      phone: item.phone || "",
      notes: item.notes || "",
      recurrence: normalizeRecurrence(item.recurrence, item.date),
      channels: normalizeChannels(item.channels),
      done: Boolean(item.done),
      createdAt: item.createdAt || existing.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || existing.updatedAt,
      sentNotifications: item.sentNotifications || existing.sentNotifications || {}
    });
  });
  return [...byId.values()];
}

function isValidReminder(item) {
  return item && item.title && item.date && item.time;
}

function clearCompletedReminders() {
  const completedCount = reminders.filter((item) => item.done).length;
  if (completedCount === 0) return;

  const confirmed = confirm(`Delete ${completedCount} completed reminder${completedCount === 1 ? "" : "s"}?`);
  if (!confirmed) return;

  reminders = reminders.filter((item) => !item.done);
  saveReminders();
  render();
}

function setDefaultDateTime() {
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  fields.date.value = formatDateInput(nextHour);
  fields.time.value = `${String(nextHour.getHours()).padStart(2, "0")}:00`;
}

function resetForm() {
  form.reset();
  fields.editingId.value = "";
  fields.channelEmail.checked = true;
  fields.email.value = currentUser?.email || "";
  fields.phone.value = currentUser?.phone || "";
  submitButton.textContent = "Add reminder";
  cancelEditButton.classList.add("hidden");
  document.querySelector("#formTitle").textContent = "Add something important";
  setDefaultDateTime();
}

function startEdit(reminder) {
  fields.editingId.value = reminder.id;
  fields.title.value = reminder.title;
  fields.type.value = reminder.type;
  fields.leadTime.value = String(reminder.leadTime);
  fields.date.value = reminder.date;
  fields.time.value = reminder.time;
  fields.repeat.value = reminder.recurrence?.frequency || "none";
  fields.email.value = reminder.email;
  fields.phone.value = reminder.phone;
  fields.notes.value = reminder.notes;
  fields.channelEmail.checked = reminder.channels.includes("email");
  fields.channelSms.checked = reminder.channels.includes("sms");
  submitButton.textContent = "Save changes";
  cancelEditButton.classList.remove("hidden");
  document.querySelector("#formTitle").textContent = "Edit reminder";
  fields.title.focus();
}

function render() {
  const sorted = [...reminders].sort((a, b) => getDueDate(a) - getDueDate(b));
  renderStats(sorted);
  renderCalendar(sorted);
  renderList(sorted);
}

function renderStats(items) {
  const open = items.filter((item) => !item.done);
  document.querySelector("#openCount").textContent = open.length;
  document.querySelector("#dueSoonCount").textContent = open.filter(isDueSoon).length;
  document.querySelector("#overdueCount").textContent = open.filter(isOverdue).length;
  document.querySelector("#doneCount").textContent = items.filter((item) => item.done).length;
}

function renderCalendar(items) {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return date;
  });

  calendarGrid.innerHTML = days.map((day) => {
    const dayItems = items.filter((item) => sameDay(getDueDate(item), day) && !item.done);
    const preview = dayItems.slice(0, 3).map((item) => `
      <span class="calendar-item">${escapeHtml(item.time)} - ${escapeHtml(item.title)}</span>
    `).join("");
    const extra = dayItems.length > 3 ? `<span class="calendar-item">+${dayItems.length - 3} more</span>` : "";

    return `
      <article class="day-card ${sameDay(day, new Date()) ? "today" : ""}">
        <span class="day-name">${day.toLocaleDateString(undefined, { weekday: "short" })}</span>
        <strong class="day-number">${day.getDate()}</strong>
        ${preview || '<span class="meta">No reminders</span>'}
        ${extra}
      </article>
    `;
  }).join("");
}

function renderList(items) {
  const visibleItems = items.filter(matchesFilter);
  emptyState.classList.toggle("hidden", visibleItems.length > 0);

  reminderList.innerHTML = visibleItems.map((item) => {
    const dueDate = getDueDate(item);
    const dueSoon = isDueSoon(item);
    const overdue = isOverdue(item);
    const recurrenceLabel = formatRecurrence(item.recurrence);
    const channels = item.channels.map((channel) => `<span class="badge">${channel.toUpperCase()}</span>`).join("");
    const emailLink = item.email
      ? `<a class="action-button" href="${buildMailto(item)}">Email</a>`
      : "";
    const smsLink = item.phone
      ? `<a class="action-button" href="${buildSms(item)}">SMS</a>`
      : "";

    return `
      <article class="reminder-card ${item.done ? "done" : ""} ${dueSoon ? "due-soon" : ""} ${overdue ? "overdue" : ""}">
        <div>
          <h3 class="reminder-title">${escapeHtml(item.title)}</h3>
          <p class="meta">${escapeHtml(item.type)} - ${formatDateTime(dueDate)} - warning ${formatLeadTime(item.leadTime)}</p>
          ${item.notes ? `<p class="notes">${escapeHtml(item.notes)}</p>` : ""}
          <div class="badge-row">
            ${dueSoon && !item.done ? '<span class="badge alert">DUE SOON</span>' : ""}
            ${overdue && !item.done ? '<span class="badge danger">OVERDUE</span>' : ""}
            ${recurrenceLabel ? `<span class="badge">${escapeHtml(recurrenceLabel)}</span>` : ""}
            ${channels}
          </div>
        </div>
        <div class="actions">
          ${emailLink}
          ${smsLink}
          <button class="action-button" type="button" data-action="toggle" data-id="${item.id}">
            ${item.done ? "Reopen" : "Done"}
          </button>
          <button class="action-button" type="button" data-action="edit" data-id="${item.id}">Edit</button>
          <button class="action-button" type="button" data-action="delete" data-id="${item.id}">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

function matchesFilter(item) {
  const query = search.value.trim().toLowerCase();
  const searchableText = `${item.title} ${item.type} ${item.notes} ${item.email} ${item.phone}`.toLowerCase();
  if (query && !searchableText.includes(query)) return false;

  if (filter.value === "open") return !item.done;
  if (filter.value === "done") return item.done;
  if (filter.value === "due-soon") return !item.done && isDueSoon(item);
  if (filter.value === "overdue") return !item.done && isOverdue(item);
  return true;
}

function getDueDate(item) {
  return new Date(`${item.date}T${item.time}`);
}

function getWarningDate(item) {
  return new Date(getDueDate(item).getTime() - item.leadTime * 60 * 1000);
}

function isDueSoon(item) {
  const now = new Date();
  const due = getDueDate(item);
  const warning = getWarningDate(item);
  return now >= warning && due >= now;
}

function isOverdue(item) {
  return getDueDate(item) < new Date();
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function sameDay(first, second) {
  return startOfDay(first).getTime() === startOfDay(second).getTime();
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(date) {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatLeadTime(minutes) {
  if (minutes === 0) return "at the time";
  if (minutes === 60) return "1 hour before";
  if (minutes === 1440) return "1 day before";
  return `${minutes} minutes before`;
}

function buildMailto(item) {
  const subject = encodeURIComponent(`Reminder: ${item.title}`);
  const body = encodeURIComponent(`${item.title}\nDue: ${formatDateTime(getDueDate(item))}\n\n${item.notes}`);
  return `mailto:${encodeURIComponent(item.email)}?subject=${subject}&body=${body}`;
}

function buildSms(item) {
  const body = encodeURIComponent(`ReminderPro: ${item.title} is due ${formatDateTime(getDueDate(item))}.`);
  return `sms:${encodeURIComponent(item.phone)}?body=${body}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeChannels(channels) {
  const allowedChannels = Array.isArray(channels)
    ? channels.filter((channel) => channel === "email" || channel === "sms")
    : [];
  return allowedChannels.length > 0 ? allowedChannels : ["email"];
}

function buildRecurrence() {
  const frequency = fields.repeat.value;
  if (frequency === "daily") {
    return { frequency: "daily" };
  }
  if (frequency === "weekly") {
    return {
      frequency: "weekly",
      weekday: getDueDate({ date: fields.date.value, time: fields.time.value }).getDay()
    };
  }
  return { frequency: "none" };
}

function normalizeRecurrence(recurrence, date) {
  if (!recurrence || recurrence.frequency === "none") {
    return { frequency: "none" };
  }
  if (recurrence.frequency === "daily") {
    return { frequency: "daily" };
  }
  if (recurrence.frequency === "weekly") {
    const weekday = Number.isInteger(recurrence.weekday)
      ? recurrence.weekday
      : new Date(`${date}T00:00`).getDay();
    return { frequency: "weekly", weekday };
  }
  return { frequency: "none" };
}

function formatRecurrence(recurrence) {
  if (!recurrence || recurrence.frequency === "none") return "";
  if (recurrence.frequency === "daily") return "EVERY DAY";
  if (recurrence.frequency === "weekly") return "EVERY WEEK";
  return "";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // The app still works without offline caching.
    });
  });
}
