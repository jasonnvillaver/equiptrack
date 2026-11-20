import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const app = express();
const PORT = process.env.PORT || 4000;
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, "../../.env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}
const dataDir = path.resolve(
  process.env.EQUIPTRACK_DATA_DIR || path.resolve(here, "../data"),
);
const dataFile = path.join(dataDir, "db.json");
const sessions = new Map();
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "EquipTrack <onboarding@resend.dev>";
const RESEND_TEMPLATE_ID = process.env.RESEND_TEMPLATE_ID;
const EMAIL_TEST_ADDRESS = process.env.EMAIL_TEST_ADDRESS;
app.use(cors());
app.use(express.json());

const seed = {
  users: [],
  equipment: [
    {
      id: "EQ-1001",
      name: "Laptop - Lenovo ThinkPad",
      category: "Computer",
      location: "IT Laboratory",
      total: 8,
      available: 6,
      condition: "Good",
    },
    {
      id: "EQ-1002",
      name: "Projector - Epson",
      category: "Presentation",
      location: "AV Room",
      total: 4,
      available: 3,
      condition: "Good",
    },
    {
      id: "EQ-1003",
      name: "HDMI Cable",
      category: "Accessory",
      location: "IT Stockroom",
      total: 15,
      available: 12,
      condition: "Good",
    },
    {
      id: "EQ-1004",
      name: "Digital Camera",
      category: "Camera",
      location: "Media Room",
      total: 3,
      available: 2,
      condition: "Good",
    },
    {
      id: "EQ-1005",
      name: "Wireless Microphone",
      category: "Audio",
      location: "AV Room",
      total: 5,
      available: 5,
      condition: "Needs inspection",
    },
  ],
  requests: [
    {
      id: "BR-2001",
      borrower: "Alex Santos",
      department: "BSIT - 3A",
      equipmentId: "EQ-1001",
      equipmentName: "Laptop - Lenovo ThinkPad",
      quantity: 1,
      purpose: "Programming presentation",
      borrowDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      status: "Pending",
      createdAt: new Date().toISOString(),
    },
    {
      id: "BR-2002",
      borrower: "Jamie Cruz",
      department: "BSCS - 2B",
      equipmentId: "EQ-1002",
      equipmentName: "Projector - Epson",
      quantity: 1,
      purpose: "Class report",
      borrowDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      status: "Borrowed",
      createdAt: new Date().toISOString(),
    },
  ],
  activity: [],
  smsLog: [],
};
function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify(seed, null, 2));
  const db = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  let changed = false;
  if (!Array.isArray(db.users)) { db.users = []; changed = true; }
  if (!Array.isArray(db.smsLog)) { db.smsLog = []; changed = true; }
  if (!Array.isArray(db.activity)) { db.activity = []; changed = true; }
  if (changed) fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}
function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}
function writeDb(db) {
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}
function log(db, message) {
  db.activity.unshift({
    id: randomUUID(),
    message,
    at: new Date().toISOString(),
  });
  db.activity = db.activity.slice(0, 30);
}
function overdue(r) {
  return (
    r.status === "Borrowed" && r.dueDate < new Date().toISOString().slice(0, 10)
  );
}
function newId(prefix, items, start) {
  const max = items.reduce(
    (m, x) => Math.max(m, Number(x.id.split("-")[1]) || 0),
    start,
  );
  return `${prefix}-${max + 1}`;
}

function makePasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function passwordMatches(password, storedHash) {
  const [salt, hash] = (storedHash || "").split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, department: user.department, role: user.role, phone: user.phone || "" };
}
function createSession(user) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  return { token, user: publicUser(user) };
}
function requireAuth(req, res, next) {
  const token = req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  const user = readDb().users.find((item) => item.id === session.userId);
  if (!user) return res.status(401).json({ error: "Please sign in to continue." });
  req.user = user;
  next();
}
function requireStaff(req, res, next) {
  if (req.user.role !== "staff") return res.status(403).json({ error: "Staff access is required." });
  next();
}

function normalizePhoneNumber(phone) {
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith("63") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("09") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith("9") && digits.length === 10) return `+63${digits}`;
  return digits.startsWith("+") ? `+${digits}` : `+${digits}`;
}

async function sendEmail(to, subject, text, db, requestId, type, templateVariables) {
  const recipient = EMAIL_TEST_ADDRESS || to;
  const entry = { id: randomUUID(), requestId, type, email: recipient || null, subject, text, sentAt: new Date().toISOString(), status: "skipped" };
  if (!recipient) {
    entry.status = "failed";
    entry.error = "Borrower email address is missing.";
  } else if (RESEND_API_KEY) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          RESEND_TEMPLATE_ID
            ? {
                from: RESEND_FROM,
                to: [recipient],
                subject,
                template: { id: RESEND_TEMPLATE_ID, variables: templateVariables || {} },
              }
            : { from: RESEND_FROM, to: [recipient], subject, text },
        ),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `Resend returned ${response.status}`);
      entry.status = "sent";
      entry.providerId = result.id || null;
    } catch (error) {
      entry.status = "failed";
      entry.error = error instanceof Error ? error.message : "Email delivery failed.";
    }
  } else {
    entry.status = "logged";
  }
  db.smsLog.unshift(entry);
  db.smsLog = db.smsLog.slice(0, 300);
  return entry;
}

async function processSmsNotifications() {
  const db = readDb();
  db.smsLog ||= [];
  for (const request of db.requests) {
    if (request.status !== "Borrowed") continue;
    const borrower = db.users.find((user) => user.id === request.borrowerUserId);
    const alreadySent = (type) => db.smsLog.some((item) => item.requestId === request.id && item.type === type);
    const due = new Date(`${request.dueDate}T23:59:59`);
    const hoursUntilDue = (due.getTime() - Date.now()) / 3600000;
    if (hoursUntilDue > 0 && hoursUntilDue <= 24 && !alreadySent("due-reminder")) {
      await sendEmail(borrower?.email, "EquipTrack Notification: Due Reminder", `Reminder: ${request.borrower}, ${request.quantity} × ${request.equipmentName} is due on ${request.dueDate}. Please return it on time.`, db, request.id, "due-reminder");
    }
    if (new Date().toISOString().slice(0, 10) > request.dueDate && !alreadySent("penalty")) {
      await sendEmail(borrower?.email, "EquipTrack Notification: Penalty Notice", `Penalty notice: ${request.borrower}, ${request.equipmentName} was not returned after ${request.dueDate}. Penalty is 20 PHP per day. If overdue for more than 3 days, the department may impose further sanctions.`, db, request.id, "penalty");
    }
  }
  writeDb(db);
}

app.post("/api/auth/register", (req, res) => {
  const { name, email, department, password } = req.body;
  if (!name?.trim() || !email?.trim() || !department?.trim() || typeof password !== "string" || password.length < 10)
    return res.status(400).json({ error: "Complete all fields. Passwords must be at least 10 characters." });
  const d = readDb();
  const normalizedEmail = email.trim().toLowerCase();
  if (d.users.some((user) => user.email === normalizedEmail)) return res.status(409).json({ error: "An account with that email already exists." });
  const user = { id: randomUUID(), name: name.trim(), email: normalizedEmail, department: department.trim(), role: "borrower", passwordHash: makePasswordHash(password) };
  d.users.push(user); writeDb(d); res.status(201).json(createSession(user));
});
app.post("/api/auth/login", (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const { password } = req.body;
  if (!email || typeof password !== "string") return res.status(400).json({ error: "Enter your email and password." });
  const user = readDb().users.find((item) => item.email === email);
  if (!user || !passwordMatches(password, user.passwordHash)) return res.status(401).json({ error: "Email or password is incorrect." });
  res.json(createSession(user));
});
app.use("/api", (req, res, next) => {
  if (["/health", "/auth/register", "/auth/login"].includes(req.path)) return next();
  requireAuth(req, res, next);
});
app.get("/api/auth/me", (req, res) => res.json(publicUser(req.user)));
app.post("/api/auth/logout", (req, res) => {
  const token = req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token) sessions.delete(token); res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "EquipTrack API" }));
app.get("/api/dashboard", (req, res) => {
  const d = readDb();
  const visibleRequests = req.user.role === "staff"
    ? d.requests
    : d.requests.filter((r) => r.borrowerUserId === req.user.id);
  const borrowed = visibleRequests.filter((r) => r.status === "Borrowed");
  res.json({
    totalEquipment: d.equipment.reduce((s, e) => s + e.total, 0),
    availableEquipment: d.equipment.reduce((s, e) => s + e.available, 0),
    borrowedEquipment: borrowed.reduce((s, r) => s + r.quantity, 0),
    overdueRequests: visibleRequests.filter(overdue).length,
    pendingRequests: visibleRequests.filter((r) => r.status === "Pending").length,
    equipmentCount: d.equipment.length,
    recentActivity: req.user.role === "staff" ? d.activity : [],
  });
});
app.get("/api/equipment", (_req, res) => res.json(readDb().equipment));
app.post("/api/equipment", requireStaff, (req, res) => {
  const { name, category, location, total, condition = "Good" } = req.body;
  if (
    !name?.trim() ||
    !category?.trim() ||
    !location?.trim() ||
    !Number.isInteger(Number(total)) ||
    Number(total) < 1
  )
    return res
      .status(400)
      .json({ error: "Name, category, location and quantity are required." });
  const d = readDb(),
    item = {
      id: newId("EQ", d.equipment, 1000),
      name: name.trim(),
      category,
      location,
      total: Number(total),
      available: Number(total),
      condition,
    };
  d.equipment.unshift(item);
  log(d, `Added equipment: ${item.name}`);
  writeDb(d);
  res.status(201).json(item);
});
app.put("/api/equipment/:id", requireStaff, (req, res) => {
  const d = readDb(),
    e = d.equipment.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: "Equipment not found." });
  const borrowed = e.total - e.available;
  const total = req.body.total === undefined ? e.total : Number(req.body.total);
  if (!Number.isInteger(total) || total < borrowed)
    return res
      .status(400)
      .json({ error: `Total cannot be less than ${borrowed} borrowed units.` });
  e.name = (req.body.name || e.name).trim();
  e.category = req.body.category || e.category;
  e.location = req.body.location || e.location;
  e.condition = req.body.condition || e.condition;
  e.total = total;
  e.available = total - borrowed;
  log(d, `Updated equipment: ${e.name}`);
  writeDb(d);
  res.json(e);
});
app.delete("/api/equipment/:id", requireStaff, (req, res) => {
  const d = readDb(),
    e = d.equipment.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: "Equipment not found." });
  if (e.available !== e.total)
    return res
      .status(400)
      .json({ error: "Cannot delete equipment while units are borrowed." });
  d.equipment = d.equipment.filter((x) => x.id !== e.id);
  log(d, `Deleted equipment: ${e.name}`);
  writeDb(d);
  res.json({ ok: true });
});
app.get("/api/requests", (req, res) =>
  res.json(readDb().requests
    .filter((r) => req.user.role === "staff" || r.borrowerUserId === req.user.id)
    .map((r) => ({ ...r, overdue: overdue(r) }))),
);
app.post("/api/requests", (req, res) => {
  const {
    borrower,
    department,
    equipmentId,
    quantity,
    purpose,
    borrowDate,
    dueDate,
  } = req.body;
  if (
    (req.user.role === "staff" && (!borrower?.trim() || !department?.trim())) ||
    !equipmentId ||
    !purpose?.trim() ||
    !borrowDate ||
    !dueDate
  )
    return res.status(400).json({ error: "Complete all request fields." });
  if (dueDate < borrowDate)
    return res
      .status(400)
      .json({ error: "Due date cannot precede borrow date." });
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1)
    return res
      .status(400)
      .json({ error: "Quantity must be a positive whole number." });
  const d = readDb(),
    e = d.equipment.find((x) => x.id === equipmentId);
  if (!e) return res.status(404).json({ error: "Equipment not found." });
  if (e.available < qty)
    return res
      .status(400)
      .json({ error: `Only ${e.available} unit(s) available.` });
  const r = {
    id: newId("BR", d.requests, 2000),
    borrower: req.user.role === "borrower" ? req.user.name : borrower?.trim(),
    department: req.user.role === "borrower" ? req.user.department : department?.trim(),
    borrowerUserId: req.user.role === "borrower" ? req.user.id : null,
    equipmentId,
    equipmentName: e.name,
    quantity: qty,
    purpose: purpose.trim(),
    borrowDate,
    dueDate,
    status: "Pending",
    createdAt: new Date().toISOString(),
  };
  d.requests.unshift(r);
  log(d, `${r.borrower} requested ${qty} × ${e.name}`);
  writeDb(d);
  res.status(201).json(r);
});
app.patch("/api/requests/:id/status", requireStaff, async (req, res) => {
  const status = req.body.status,
    allowed = ["Approved", "Rejected", "Borrowed", "Returned"];
  if (!allowed.includes(status))
    return res.status(400).json({ error: "Unsupported status." });
  const d = readDb(),
    r = d.requests.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Request not found." });
  const e = d.equipment.find((x) => x.id === r.equipmentId);
  if (["Approved", "Rejected"].includes(status)) {
    if (r.status !== "Pending")
      return res
        .status(400)
        .json({ error: "Only pending requests can be approved or rejected." });
    if (status === "Approved") {
      if (!e || e.available < r.quantity)
        return res
          .status(400)
          .json({ error: "Not enough inventory to approve." });
      e.available -= r.quantity;
    }
    r.status = status;
  } else if (status === "Borrowed") {
    if (r.status !== "Approved")
      return res
        .status(400)
        .json({ error: "Approve request before releasing equipment." });
    r.status = "Borrowed";
    r.releasedAt = new Date().toISOString();
    const borrower = d.users.find((user) => user.id === r.borrowerUserId);
    await sendEmail(borrower?.email, "EquipTrack Notification: Borrowed Equipment", `Confirmation: ${r.borrower}, you borrowed ${r.quantity} × ${r.equipmentName}. Due date: ${r.dueDate}. Please return it on time.`, d, r.id, "confirmation");
  } else {
    if (r.status !== "Borrowed")
      return res
        .status(400)
        .json({ error: "Only borrowed equipment can be returned." });
    r.status = "Returned";
    r.returnedAt = new Date().toISOString();
    if (e) e.available = Math.min(e.total, e.available + r.quantity);
  }
  log(d, `${r.id} status changed to ${status}`);
  writeDb(d);
  res.json({ ...r, overdue: overdue(r) });
});
app.get("/api/notifications", requireStaff, (req, res) => res.json(readDb().smsLog || []));
app.post("/api/notifications/process", requireStaff, async (_req, res) => {
  await processSmsNotifications();
  res.json({ ok: true });
});
app.post("/api/notifications/test", requireStaff, async (req, res) => {
  const email = req.body.email?.trim() || EMAIL_TEST_ADDRESS;
  if (!email) return res.status(400).json({ error: "Provide an email address or set EMAIL_TEST_ADDRESS." });
  const d = readDb();
  const entry = await sendEmail(
    email,
    "EquipTrack Email Test",
    "This is a test email from EquipTrack.",
    d,
    null,
    "test",
    {
      BORROWER_NAME: "Jasonn Villaver",
      ITEM: "HDMI Cable",
      DUE_DATE: "November 21, 2026",
    },
  );
  writeDb(d);
  if (entry.status === "failed") return res.status(502).json(entry);
  res.json(entry);
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});
app.listen(PORT, () => {
  ensureDb();
  if (process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD?.length >= 10) {
    const d = readDb();
    const email = process.env.STAFF_EMAIL.trim().toLowerCase();
    if (!d.users.some((user) => user.email === email)) {
      d.users.push({
        id: randomUUID(),
        name: process.env.STAFF_NAME?.trim() || "EquipTrack Staff",
        email,
        department: "Equipment Services",
        phone: "",
        role: "staff",
        passwordHash: makePasswordHash(process.env.STAFF_PASSWORD),
      });
      writeDb(d);
    }
  } else {
    console.warn("Staff login is not configured. Set STAFF_EMAIL and STAFF_PASSWORD (10+ characters).");
  }
  void processSmsNotifications();
  setInterval(() => void processSmsNotifications(), 60 * 60 * 1000);
  console.log(`EquipTrack API running at http://localhost:${PORT}`);
});
