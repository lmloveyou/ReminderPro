const { createServer } = require("node:http");
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { extname, join, normalize } = require("node:path");

const port = Number(process.env.PORT || 3000);
const publicDir = __dirname;
const dataDir = process.env.DATA_DIR || join(__dirname, "data");
const remindersFile = join(dataDir, "reminders.json");
const notificationIntervalMs = Number(process.env.NOTIFICATION_INTERVAL_MS || 60000);
let dbPool = null;

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
    try {
      await handleApi(request, response, url);
    } catch (error) {
      console.error("API error:", error.message);
      sendJson(response, 500, { error: "Server error. Check Railway variables and database connection." });
    }
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

startServer();

async function startServer() {
  await initDatabase();
  server.listen(port, () => {
    console.log(`ReminderPro is running on port ${port}`);
  });

  setInterval(processReminderNotifications, notificationIntervalMs);
  processReminderNotifications().catch((error) => {
    console.error("Notification worker failed:", error.message);
  });
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/config") {
    sendJson(response, 200, {
      emailEnabled: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      smsEnabled: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/me") {
    const user = await getAuthenticatedUser(request);
    if (!user) return sendJson(response, 401, { error: "Not signed in" });
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/register") {
    const body = await readJsonBody(request);
    const result = await registerUser(body);
    if (!result.ok) return sendJson(response, result.status, { error: result.error });
    setSessionCookie(response, result.sessionId);
    sendJson(response, 200, { user: publicUser(result.user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readJsonBody(request);
    const result = await loginUser(body);
    if (!result.ok) return sendJson(response, result.status, { error: result.error });
    setSessionCookie(response, result.sessionId);
    sendJson(response, 200, { user: publicUser(result.user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    await deleteSession(getCookie(request, "session"));
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/reminders") {
    const user = await getAuthenticatedUser(request);
    if (!user) return sendJson(response, 401, { error: "Not signed in" });
    sendJson(response, 200, { reminders: await readReminders(user.id) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reminders/sync") {
    const user = await getAuthenticatedUser(request);
    if (!user) return sendJson(response, 401, { error: "Not signed in" });
    const body = await readJsonBody(request);
    const incoming = Array.isArray(body.reminders) ? body.reminders : [];
    const saved = await mergeAndWriteReminders(user.id, incoming);
    sendJson(response, 200, { reminders: saved });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is missing. Accounts require a Railway PostgreSQL database.");
    return;
  }

  const { Pool } = await import("pg");
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
  });

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      lead_time INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      recurrence JSONB DEFAULT '{"frequency":"none"}',
      channels TEXT[] DEFAULT ARRAY['email'],
      done BOOLEAN DEFAULT FALSE,
      sent_notifications JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);
}

async function query(sql, params = []) {
  if (!dbPool) throw new Error("Database is not configured. Add Railway PostgreSQL and DATABASE_URL.");
  return dbPool.query(sql, params);
}

async function registerUser(body) {
  if (!dbPool) return { ok: false, status: 503, error: "Database is not configured. Add Railway PostgreSQL." };
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || email.split("@")[0] || "ReminderPro user").trim();
  const phone = String(body.phone || "").trim();

  if (!email || !password) return { ok: false, status: 400, error: "Email and password are required." };
  if (password.length < 8) return { ok: false, status: 400, error: "Password must be at least 8 characters." };

  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const user = {
    id: randomBytes(16).toString("hex"),
    name,
    email,
    phone,
    password_hash: passwordHash,
    salt
  };

  try {
    await query(
      "INSERT INTO users (id, name, email, phone, password_hash, salt) VALUES ($1, $2, $3, $4, $5, $6)",
      [user.id, user.name, user.email, user.phone, user.password_hash, user.salt]
    );
  } catch (error) {
    if (error.code === "23505") return { ok: false, status: 409, error: "This email already has an account." };
    throw error;
  }

  const sessionId = await createSession(user.id);
  return { ok: true, user, sessionId };
}

async function loginUser(body) {
  if (!dbPool) return { ok: false, status: 503, error: "Database is not configured. Add Railway PostgreSQL." };
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const result = await query("SELECT * FROM users WHERE email = $1", [email]);
  const user = result.rows[0];
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return { ok: false, status: 401, error: "Email or password is incorrect." };
  }

  const sessionId = await createSession(user.id);
  return { ok: true, user, sessionId };
}

async function createSession(userId) {
  const sessionId = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [sessionId, userId, expiresAt]);
  return sessionId;
}

async function deleteSession(sessionId) {
  if (!sessionId || !dbPool) return;
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

async function getAuthenticatedUser(request) {
  const sessionId = getCookie(request, "session");
  if (!sessionId || !dbPool) return null;
  const result = await query(
    `SELECT users.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = $1 AND sessions.expires_at > NOW()`,
    [sessionId]
  );
  return result.rows[0] || null;
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || ""
  };
}

function getCookie(request, name) {
  const cookies = request.headers.cookie || "";
  return cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("=")[1];
}

function setSessionCookie(response, sessionId) {
  response.setHeader("Set-Cookie", [
    `session=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  ]);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", ["session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"]);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readReminders(userId) {
  if (dbPool && userId) {
    const result = await query("SELECT * FROM reminders WHERE user_id = $1 ORDER BY date ASC, time ASC", [userId]);
    return result.rows.map(rowToReminder);
  }

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

async function mergeAndWriteReminders(userId, incoming) {
  if (dbPool && userId) {
    const saved = [];
    const validIncoming = incoming.filter(isValidReminder);
    const incomingIds = validIncoming.map((item) => item.id);
    if (incomingIds.length > 0) {
      await query("DELETE FROM reminders WHERE user_id = $1 AND NOT (id = ANY($2::text[]))", [userId, incomingIds]);
    } else {
      await query("DELETE FROM reminders WHERE user_id = $1", [userId]);
    }

    for (const item of validIncoming) {
      const reminder = normalizeReminder(item);
      await query(
        `INSERT INTO reminders (
          id, user_id, title, type, lead_time, date, time, email, phone, notes,
          recurrence, channels, done, sent_notifications, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          type = EXCLUDED.type,
          lead_time = EXCLUDED.lead_time,
          date = EXCLUDED.date,
          time = EXCLUDED.time,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          notes = EXCLUDED.notes,
          recurrence = EXCLUDED.recurrence,
          channels = EXCLUDED.channels,
          done = EXCLUDED.done,
          sent_notifications = reminders.sent_notifications,
          updated_at = NOW()
        WHERE reminders.user_id = EXCLUDED.user_id`,
        [
          reminder.id,
          userId,
          reminder.title,
          reminder.type,
          reminder.leadTime,
          reminder.date,
          reminder.time,
          reminder.email,
          reminder.phone,
          reminder.notes,
          JSON.stringify(reminder.recurrence),
          reminder.channels,
          reminder.done,
          JSON.stringify(reminder.sentNotifications),
          reminder.createdAt,
          reminder.updatedAt
        ]
      );
      saved.push(reminder);
    }
    return readReminders(userId);
  }

  const current = await readReminders();
  const byId = new Map(current.map((item) => [item.id, item]));

  incoming.filter(isValidReminder).forEach((item) => {
    const existing = byId.get(item.id) || {};
    byId.set(item.id, { ...existing, ...normalizeReminder(item), sentNotifications: existing.sentNotifications || item.sentNotifications || {} });
  });

  const merged = [...byId.values()];
  await writeReminders(merged);
  return merged;
}

async function processReminderNotifications() {
  const reminders = await readAllRemindersForNotifications();
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

    if (dbPool && changed) {
      await saveNotificationState(reminder);
      changed = false;
    }
  }

  if (changed && !dbPool) {
    await writeReminders(reminders);
  }
}

async function readAllRemindersForNotifications() {
  if (dbPool) {
    const result = await query("SELECT * FROM reminders WHERE done = FALSE ORDER BY date ASC, time ASC");
    return result.rows.map(rowToReminder);
  }
  return readReminders();
}

async function saveNotificationState(reminder) {
  await query(
    `UPDATE reminders
     SET date = $2,
         time = $3,
         sent_notifications = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [
      reminder.id,
      reminder.date,
      reminder.time,
      JSON.stringify(reminder.sentNotifications || {})
    ]
  );
}

function normalizeReminder(item) {
  return {
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
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt,
    sentNotifications: item.sentNotifications || {}
  };
}

function rowToReminder(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    leadTime: row.lead_time,
    date: row.date,
    time: row.time,
    email: row.email || "",
    phone: row.phone || "",
    notes: row.notes || "",
    recurrence: normalizeRecurrence(row.recurrence, row.date),
    channels: normalizeChannels(row.channels),
    done: Boolean(row.done),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentNotifications: row.sent_notifications || {}
  };
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
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}
