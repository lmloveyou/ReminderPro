const storageKey = "reminderpro.reminders";

const form = document.querySelector("#reminderForm");
const calendarGrid = document.querySelector("#calendarGrid");
const reminderList = document.querySelector("#reminderList");
const emptyState = document.querySelector("#emptyState");
const filter = document.querySelector("#filter");
const search = document.querySelector("#search");
const notificationButton = document.querySelector("#notificationButton");
const submitButton = document.querySelector("#submitButton");
const cancelEditButton = document.querySelector("#cancelEditButton");

const fields = {
  editingId: document.querySelector("#editingId"),
  title: document.querySelector("#title"),
  type: document.querySelector("#type"),
  leadTime: document.querySelector("#leadTime"),
  date: document.querySelector("#date"),
  time: document.querySelector("#time"),
  email: document.querySelector("#email"),
  phone: document.querySelector("#phone"),
  notes: document.querySelector("#notes"),
  channelApp: document.querySelector("#channelApp"),
  channelEmail: document.querySelector("#channelEmail"),
  channelSms: document.querySelector("#channelSms")
};

let reminders = loadReminders();
const notifiedReminderIds = new Set();

setDefaultDateTime();
render();
setInterval(checkNotifications, 30000);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const channels = [];
  if (fields.channelApp.checked) channels.push("app");
  if (fields.channelEmail.checked) channels.push("email");
  if (fields.channelSms.checked) channels.push("sms");

  const reminderData = {
    title: fields.title.value.trim(),
    type: fields.type.value,
    leadTime: Number(fields.leadTime.value),
    date: fields.date.value,
    time: fields.time.value,
    email: fields.email.value.trim(),
    phone: fields.phone.value.trim(),
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

notificationButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    alert("Your browser does not support notifications.");
    return;
  }

  const permission = await Notification.requestPermission();
  notificationButton.textContent = permission === "granted" ? "Alerts enabled" : "Enable alerts";
});

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
  fields.channelApp.checked = true;
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
  fields.email.value = reminder.email;
  fields.phone.value = reminder.phone;
  fields.notes.value = reminder.notes;
  fields.channelApp.checked = reminder.channels.includes("app");
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
  checkNotifications();
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

function checkNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  reminders.forEach((item) => {
    if (item.done || !item.channels.includes("app")) return;
    const warningTime = getWarningDate(item);
    const now = new Date();
    if (now >= warningTime && !notifiedReminderIds.has(item.id)) {
      new Notification("ReminderPro", {
        body: `${item.title} is due ${formatDateTime(getDueDate(item))}.`
      });
      notifiedReminderIds.add(item.id);
    }
  });
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
