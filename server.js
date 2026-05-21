const { createServer } = require("node:http");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { extname, join, normalize } = require("node:path");

const port = Number(process.env.PORT || 3000);
const publicDir = __dirname;
const dataDir = process.env.DATA_DIR || join(__dirname, "data");
const remindersFile = join(dataDir, "reminders.json");
const notificationIntervalMs = Number(process.env.NOTIFICATION_INTERVAL_MS || 60000);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    send(response, 200, "ok", "text/plain; charset=utf-8");
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicDir, pathname));

  if (!filePath.startsWith(publicDir)) {
    send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await readFile(filePath);
    send(response, 200, file, contentTypes[extname(filePath)] || "application/octet-stream");
  } catch {
    const index = await readFile(join(publicDir, "index.html"));
    send(response, 200, index, contentTypes[".html"]);
  }
});

server.listen(port, () => {
  console.log(`ReminderPro is running on port ${port}`);
});

setInterval(processReminderNotifications, notificationIntervalMs);
processReminderNotifications().catch((error) => {
  console.error("Notification worker failed:", error.message);
});

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/config") {
    sendJson(response, 200, {
      emailEnabled: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      smsEnabled: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/reminders") {
    sendJson(response, 200, { reminders: await readReminders() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reminders/sync") {
    const body = await readJsonBody(request);
    const incoming = Array.isArray(body.reminders) ? body.reminders : [];
    const saved = await mergeAndWriteReminders(incoming);
    sendJson(response, 200, { reminders: saved });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readReminders() {
  try {
    const content = await readFile(remindersFile, "utf8");
    const data = JSON.parse(content);
    return Array.isArray(data.reminders) ? data.reminders : [];
  } catch {
    return [];
  }
}

async function writeReminders(reminders) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(remindersFile, JSON.stringify({ reminders }, null, 2));
}

async function mergeAndWriteReminders(incoming) {
  const current = await readReminders();
  const byId = new Map(current.map((item) => [item.id, item]));

  incoming.filter(isValidReminder).forEach((item) => {
    const existing = byId.get(item.id) || {};
    byId.set(item.id, {
      ...existing,
      id: item.id,
      title: String(item.title).trim(),
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
      sentNotifications: existing.sentNotifications || item.sentNotifications || {}
    });
  });

  const merged = [...byId.values()];
  await writeReminders(merged);
  return merged;
}

async function processReminderNotifications() {
  const reminders = await readReminders();
  let changed = false;

  for (const reminder of reminders) {
    if (reminder.done) continue;
    if (new Date() < getWarningDate(reminder)) continue;

    reminder.sentNotifications ||= {};
    const message = buildReminderMessage(reminder);

    if (reminder.channels?.includes("email") && reminder.email && !reminder.sentNotifications.email) {
      const result = await sendEmail(reminder.email, `Reminder: ${reminder.title}`, message);
      if (result.ok) {
        reminder.sentNotifications.email = new Date().toISOString();
        changed = true;
      } else {
        console.error("Email notification failed:", result.error);
      }
    }

    if (reminder.channels?.includes("sms") && reminder.phone && !reminder.sentNotifications.sms) {
      const result = await sendSms(reminder.phone, message);
      if (result.ok) {
        reminder.sentNotifications.sms = new Date().toISOString();
        changed = true;
      } else {
        console.error("SMS notification failed:", result.error);
      }
    }

    if (isRecurring(reminder) && allSelectedNotificationsSent(reminder)) {
      advanceRecurringReminder(reminder);
      changed = true;
    }
  }

  if (changed) {
    await writeReminders(reminders);
  }
}

async function sendEmail(to, subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return { ok: false, error: "Missing RESEND_API_KEY or RESEND_FROM_EMAIL" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to,
        subject,
        text
      })
    });

    if (!response.ok) {
      return { ok: false, error: await response.text() };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function sendSms(to, body) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { ok: false, error: "Missing Twilio environment variables" };
  }

  try {
    const params = new URLSearchParams({
      To: to,
      From: TWILIO_FROM_NUMBER,
      Body: body
    });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    if (!response.ok) {
      return { ok: false, error: await response.text() };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function isValidReminder(item) {
  return item && item.id && item.title && item.date && item.time;
}

function getWarningDate(reminder) {
  const due = new Date(`${reminder.date}T${reminder.time}`);
  return new Date(due.getTime() - Number(reminder.leadTime || 0) * 60 * 1000);
}

function buildReminderMessage(reminder) {
  const due = new Date(`${reminder.date}T${reminder.time}`).toLocaleString();
  return `ReminderPro: ${reminder.title} is due ${due}.${reminder.notes ? `\n\n${reminder.notes}` : ""}`;
}

function isRecurring(reminder) {
  return reminder.recurrence?.frequency === "daily" || reminder.recurrence?.frequency === "weekly";
}

function allSelectedNotificationsSent(reminder) {
  return normalizeChannels(reminder.channels).every((channel) => reminder.sentNotifications?.[channel]);
}

function advanceRecurringReminder(reminder) {
  const nextDue = getNextRecurringDueDate(reminder);
  reminder.date = formatDateInput(nextDue);
  reminder.time = formatTimeInput(nextDue);
  reminder.sentNotifications = {};
  reminder.updatedAt = new Date().toISOString();
}

function getNextRecurringDueDate(reminder) {
  const now = new Date();
  const nextDue = new Date(`${reminder.date}T${reminder.time}`);
  const frequency = reminder.recurrence?.frequency;

  if (frequency === "daily") {
    do {
      nextDue.setDate(nextDue.getDate() + 1);
    } while (nextDue <= now);
    return nextDue;
  }

  if (frequency === "weekly") {
    do {
      nextDue.setDate(nextDue.getDate() + 7);
    } while (nextDue <= now);
    return nextDue;
  }

  return nextDue;
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

function normalizeChannels(channels) {
  const allowedChannels = Array.isArray(channels)
    ? channels.filter((channel) => channel === "email" || channel === "sms")
    : [];
  return allowedChannels.length > 0 ? allowedChannels : ["email"];
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTimeInput(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function send(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": statusCode === 200 ? "public, max-age=300" : "no-store"
  });
  response.end(body);
}

function sendJson(response, statusCode, body) {
  send(response, statusCode, JSON.stringify(body), "application/json; charset=utf-8");
}
