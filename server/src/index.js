import "./env.js";
import express from "express";
import cors from "cors";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { inTransaction, pool } from "./database.js";

const app = express();
const PORT = process.env.PORT || 4000;
const sessions = new Map();
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM =
  process.env.RESEND_FROM || "EquipTrack <onboarding@resend.dev>";
const RESEND_TEMPLATE_ID = process.env.RESEND_TEMPLATE_ID;
const RESEND_APPROVAL_TEMPLATE_ID = process.env.RESEND_APPROVAL_TEMPLATE_ID;
const EMAIL_TEST_ADDRESS = process.env.EMAIL_TEST_ADDRESS;
const SYSTEM_ADMIN_EMAIL = process.env.STAFF_EMAIL?.trim().toLowerCase();
const USER_ROLES = [
  "system_admin",
  "equipment_custodian",
  "faculty_staff",
  "authorized_student",
];
const MAINTENANCE_STATUSES = [
  "Reported",
  "Scheduled",
  "In Progress",
  "Completed",
  "Cancelled",
];

app.use(cors());
app.use(express.json());

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

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

function userFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    department: row.department,
    role: row.role,
    approved: row.approved,
    phone: row.phone || "",
    passwordHash: row.password_hash,
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    department: user.department,
    role: user.role,
    approved: user.approved,
    phone: user.phone || "",
  };
}

function isBorrower(user) {
  return ["faculty_staff", "authorized_student"].includes(user.role);
}

function canManageEquipment(user) {
  return ["system_admin", "equipment_custodian"].includes(user.role);
}

function equipmentFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location,
    total: row.total,
    available: row.available,
    condition: row.condition,
  };
}

function requestFromRow(row) {
  return {
    id: row.id,
    borrower: row.borrower,
    department: row.department,
    borrowerUserId: row.borrower_user_id,
    ...(row.borrower_email ? { borrowerEmail: row.borrower_email } : {}),
    equipmentId: row.equipment_id,
    equipmentName: row.equipment_name,
    quantity: row.quantity,
    purpose: row.purpose,
    borrowDate: row.borrow_date,
    dueDate: row.due_date,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.released_at
      ? { releasedAt: new Date(row.released_at).toISOString() }
      : {}),
    ...(row.returned_at
      ? { returnedAt: new Date(row.returned_at).toISOString() }
      : {}),
  };
}

function notificationFromRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    type: row.type,
    email: row.email,
    subject: row.subject,
    text: row.text,
    sentAt: new Date(row.sent_at).toISOString(),
    status: row.status,
    providerId: row.provider_id,
    ...(row.error ? { error: row.error } : {}),
  };
}

function activityFromRow(row) {
  return {
    id: row.id,
    message: row.message,
    at: new Date(row.at).toISOString(),
  };
}

function maintenanceFromRow(row) {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    equipmentName: row.equipment_name,
    title: row.title,
    description: row.description,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by_name || "Former user",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.completed_at
      ? { completedAt: new Date(row.completed_at).toISOString() }
      : {}),
  };
}

function overdue(request) {
  return (
    request.status === "Borrowed" &&
    request.dueDate < new Date().toISOString().slice(0, 10)
  );
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function createSession(user) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: user.id,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  });
  return { token, user: publicUser(user) };
}

const requireAuth = asyncRoute(async (req, res, next) => {
  const token = req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  const { rows } = await pool.query(
    `SELECT id, name, email, department, role, approved, phone, password_hash
     FROM users WHERE id = $1`,
    [session.userId],
  );
  if (!rows[0])
    return res.status(401).json({ error: "Please sign in to continue." });
  req.user = userFromRow(rows[0]);
  if (!req.user.approved) {
    sessions.delete(token);
    return res
      .status(403)
      .json({ error: "Your account has not been approved by a System Admin." });
  }
  next();
});

function requireEquipmentStaff(req, res, next) {
  if (!canManageEquipment(req.user))
    return res
      .status(403)
      .json({ error: "Equipment Custodian or System Admin access is required." });
  next();
}

function requireSystemAdmin(req, res, next) {
  if (req.user.role !== "system_admin")
    return res.status(403).json({ error: "System Admin access is required." });
  next();
}

async function addActivity(client, message) {
  await client.query(
    "INSERT INTO activity (id, message) VALUES ($1, $2)",
    [randomUUID(), message],
  );
  await client.query(
    `DELETE FROM activity
     WHERE id IN (
       SELECT id FROM activity ORDER BY at DESC OFFSET 30
     )`,
  );
}

async function nextEquipmentId(client) {
  const { rows } = await client.query(
    "SELECT nextval('equipment_id_seq') AS value",
  );
  return `EQ-${rows[0].value}`;
}

async function nextRequestId(client) {
  const { rows } = await client.query(
    "SELECT nextval('request_id_seq') AS value",
  );
  return `BR-${rows[0].value}`;
}

async function sendEmail(
  to,
  subject,
  text,
  requestId,
  type,
  templateVariables,
  templateId = RESEND_TEMPLATE_ID,
) {
  const recipient = EMAIL_TEST_ADDRESS || to;
  const entry = {
    id: randomUUID(),
    requestId,
    type,
    email: recipient || null,
    subject,
    text,
    sentAt: new Date().toISOString(),
    status: "skipped",
  };
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
          templateId
            ? {
                from: RESEND_FROM,
                to: [recipient],
                subject,
                template: {
                  id: templateId,
                  variables: templateVariables || {},
                },
              }
            : { from: RESEND_FROM, to: [recipient], subject, text },
        ),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.message || `Resend returned ${response.status}`);
      entry.status = "sent";
      entry.providerId = result.id || null;
    } catch (error) {
      entry.status = "failed";
      entry.error =
        error instanceof Error ? error.message : "Email delivery failed.";
    }
  } else {
    entry.status = "logged";
  }
  const { rows } = await pool.query(
    `INSERT INTO notifications
       (id, request_id, type, email, subject, text, sent_at, status, provider_id, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      entry.id,
      entry.requestId,
      entry.type,
      entry.email,
      entry.subject,
      entry.text,
      entry.sentAt,
      entry.status,
      entry.providerId || null,
      entry.error || null,
    ],
  );
  return notificationFromRow(rows[0]);
}

async function processSmsNotifications() {
  const { rows: requests } = await pool.query(
    `SELECT r.*, u.email AS borrower_account_email
     FROM requests r
     LEFT JOIN users u ON u.id = r.borrower_user_id
     WHERE r.status = 'Borrowed'`,
  );
  const { rows: notifications } = await pool.query(
    `SELECT request_id, type FROM notifications
     WHERE type IN ('due-reminder', 'penalty')`,
  );
  const sent = new Set(
    notifications.map((item) => `${item.request_id}:${item.type}`),
  );

  for (const row of requests) {
    const request = requestFromRow(row);
    const borrowerEmail = row.borrower_email || row.borrower_account_email;
    const due = new Date(`${request.dueDate}T23:59:59`);
    const hoursUntilDue = (due.getTime() - Date.now()) / 3600000;
    const reminderKey = `${request.id}:due-reminder`;
    if (
      hoursUntilDue > 0 &&
      hoursUntilDue <= 24 &&
      !sent.has(reminderKey)
    ) {
      await sendEmail(
        borrowerEmail,
        "EquipTrack Notification: Due Reminder",
        `Reminder: ${request.borrower}, ${request.quantity} × ${request.equipmentName} is due on ${request.dueDate}. Please return it on time.`,
        request.id,
        "due-reminder",
      );
      sent.add(reminderKey);
    }
    const penaltyKey = `${request.id}:penalty`;
    if (
      new Date().toISOString().slice(0, 10) > request.dueDate &&
      !sent.has(penaltyKey)
    ) {
      await sendEmail(
        borrowerEmail,
        "EquipTrack Notification: Penalty Notice",
        `Penalty notice: ${request.borrower}, ${request.equipmentName} was not returned after ${request.dueDate}. Penalty is 20 PHP per day. If overdue for more than 3 days, the department may impose further sanctions.`,
        request.id,
        "penalty",
      );
      sent.add(penaltyKey);
    }
  }
}

app.post(
  "/api/auth/register",
  asyncRoute(async (req, res) => {
    const { name, email, department, password } = req.body;
    const role = req.body.role || "faculty_staff";
    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof department !== "string" ||
      !department.trim() ||
      typeof password !== "string" ||
      password.length < 10 ||
      !["faculty_staff", "authorized_student"].includes(role)
    )
      return res.status(400).json({
        error:
          "Complete all fields, choose a valid borrower type, and use a password of at least 10 characters.",
      });
    const approved = role !== "authorized_student";
    if (!approved) {
      const { rows: settings } = await pool.query(
        "SELECT student_registration_enabled FROM system_settings WHERE id = 1",
      );
      if (!settings[0]?.student_registration_enabled)
        return res.status(403).json({
          error: "Authorized Student registration is currently disabled.",
        });
    }

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const { rows } = await pool.query(
        `INSERT INTO users
           (id, name, email, department, role, approved, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, email, department, role, approved, phone, password_hash`,
        [
          randomUUID(),
          name.trim(),
          normalizedEmail,
          department.trim(),
          role,
          approved,
          makePasswordHash(password),
        ],
      );
      if (!approved)
        return res.status(202).json({
          pendingApproval: true,
          message:
            "Your account has been submitted. A System Admin must approve it before you can sign in.",
        });
      res.status(201).json(createSession(userFromRow(rows[0])));
    } catch (error) {
      if (error?.code === "23505")
        return res
          .status(409)
          .json({ error: "An account with that email already exists." });
      throw error;
    }
  }),
);

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const email = req.body.email?.trim().toLowerCase();
    const { password } = req.body;
    if (!email || typeof password !== "string")
      return res.status(400).json({ error: "Enter your email and password." });
    const { rows } = await pool.query(
      `SELECT id, name, email, department, role, approved, phone, password_hash
       FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0] && userFromRow(rows[0]);
    if (!user || !passwordMatches(password, user.passwordHash))
      return res.status(401).json({ error: "Email or password is incorrect." });
    if (!user.approved)
      return res.status(403).json({
        error: "Your account is awaiting System Admin approval.",
      });
    res.json(createSession(user));
  }),
);

app.use(
  "/api",
  asyncRoute(async (req, res, next) => {
    if (["/health", "/auth/register", "/auth/login"].includes(req.path))
      return next();
    return requireAuth(req, res, next);
  }),
);

app.get("/api/auth/me", (req, res) => res.json(publicUser(req.user)));
app.post("/api/auth/logout", (req, res) => {
  const token = req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.get(
  "/api/health",
  asyncRoute(async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "EquipTrack API" });
  }),
);

app.get(
  "/api/settings",
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT student_registration_enabled, default_loan_days, updated_at
       FROM system_settings WHERE id = 1`,
    );
    if (!rows[0]) throw new Error("System settings have not been initialized.");
    res.json({
      studentRegistrationEnabled: rows[0].student_registration_enabled,
      defaultLoanDays: rows[0].default_loan_days,
      updatedAt: new Date(rows[0].updated_at).toISOString(),
    });
  }),
);

app.patch(
  "/api/settings",
  requireSystemAdmin,
  asyncRoute(async (req, res) => {
    const { studentRegistrationEnabled, defaultLoanDays } = req.body;
    if (
      typeof studentRegistrationEnabled !== "boolean" ||
      !Number.isInteger(defaultLoanDays) ||
      defaultLoanDays < 1 ||
      defaultLoanDays > 365
    )
      return res.status(400).json({
        error:
          "Student registration must be enabled or disabled, and default loan days must be between 1 and 365.",
      });
    const { rows } = await pool.query(
      `UPDATE system_settings
       SET student_registration_enabled = $1, default_loan_days = $2,
           updated_by = $3, updated_at = NOW()
       WHERE id = 1
       RETURNING student_registration_enabled, default_loan_days, updated_at`,
      [studentRegistrationEnabled, defaultLoanDays, req.user.id],
    );
    res.json({
      studentRegistrationEnabled: rows[0].student_registration_enabled,
      defaultLoanDays: rows[0].default_loan_days,
      updatedAt: new Date(rows[0].updated_at).toISOString(),
    });
  }),
);

app.get(
  "/api/users",
  requireSystemAdmin,
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, email, department, role, approved, created_at
       FROM users ORDER BY created_at DESC`,
    );
    res.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        department: row.department,
        role: row.role,
        approved: row.approved,
        isBootstrapAdmin: row.email === SYSTEM_ADMIN_EMAIL,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    );
  }),
);

app.post(
  "/api/users",
  requireSystemAdmin,
  asyncRoute(async (req, res) => {
    const { name, email, department, password, role } = req.body;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof department !== "string" ||
      !department.trim() ||
      typeof password !== "string" ||
      password.length < 10 ||
      !USER_ROLES.includes(role)
    )
      return res.status(400).json({
        error:
          "Provide a name, email, department, valid role, and password of at least 10 characters.",
      });
    try {
      const { rows } = await pool.query(
        `INSERT INTO users
           (id, name, email, department, role, approved, password_hash)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         RETURNING id, name, email, department, role, approved, created_at`,
        [
          randomUUID(),
          name.trim(),
          email.trim().toLowerCase(),
          department.trim(),
          role,
          makePasswordHash(password),
        ],
      );
      const user = rows[0];
      res.status(201).json({
        id: user.id,
        name: user.name,
        email: user.email,
        department: user.department,
        role: user.role,
        approved: user.approved,
        createdAt: new Date(user.created_at).toISOString(),
      });
    } catch (error) {
      if (error?.code === "23505")
        return res
          .status(409)
          .json({ error: "An account with that email already exists." });
      throw error;
    }
  }),
);

app.patch(
  "/api/users/:id",
  requireSystemAdmin,
  asyncRoute(async (req, res) => {
    const role = req.body.role;
    const approved = req.body.approved;
    if (
      (role !== undefined && !USER_ROLES.includes(role)) ||
      (approved !== undefined && typeof approved !== "boolean") ||
      (role === undefined && approved === undefined)
    )
      return res.status(400).json({ error: "Provide a valid role or approval status." });

    const user = await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(73421001)");
      const { rows } = await client.query(
        `SELECT id, name, email, department, role, approved, created_at
         FROM users WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      );
      const current = rows[0];
      if (!current) throw new HttpError(404, "User not found.");
      const nextRole = role ?? current.role;
      const nextApproved =
        approved ?? (role && role !== "authorized_student" ? true : current.approved);
      if (
        current.email === SYSTEM_ADMIN_EMAIL &&
        (nextRole !== "system_admin" || !nextApproved)
      )
        throw new HttpError(
          400,
          "The configured bootstrap System Admin account must remain active.",
        );
      if (current.id === req.user.id && nextRole !== "system_admin")
        throw new HttpError(
          400,
          "Use another System Admin account to change your own role.",
        );
      if (!nextApproved && nextRole !== "authorized_student")
        throw new HttpError(
          400,
          "Only Authorized Student accounts can be awaiting approval.",
        );
      if (nextRole === "system_admin" && !nextApproved)
        throw new HttpError(400, "A System Admin account must be approved.");
      if (
        current.role === "system_admin" &&
        (nextRole !== "system_admin" || !nextApproved)
      ) {
        const { rows: admins } = await client.query(
          "SELECT COUNT(*)::INTEGER AS count FROM users WHERE role = 'system_admin' AND approved = TRUE",
        );
        if (admins[0].count <= 1)
          throw new HttpError(
            400,
            "The last approved System Admin cannot be demoted or suspended.",
          );
      }
      const { rows: updated } = await client.query(
        `UPDATE users SET role = $2, approved = $3
         WHERE id = $1
         RETURNING id, name, email, department, role, approved, created_at`,
        [current.id, nextRole, nextApproved],
      );
      await addActivity(
        client,
        `Updated account access for ${updated[0].email}`,
      );
      return updated[0];
    });
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      department: user.department,
      role: user.role,
      approved: user.approved,
      createdAt: new Date(user.created_at).toISOString(),
    });
  }),
);

app.delete(
  "/api/users/:id",
  requireSystemAdmin,
  asyncRoute(async (req, res) => {
    const user = await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(73421001)");
      const { rows } = await client.query(
        `SELECT id, email, role, approved
         FROM users WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      );
      const current = rows[0];
      if (!current) throw new HttpError(404, "User not found.");
      if (current.id === req.user.id)
        throw new HttpError(400, "You cannot delete your own account.");
      if (current.email === SYSTEM_ADMIN_EMAIL)
        throw new HttpError(
          400,
          "The configured bootstrap System Admin account cannot be deleted.",
        );
      if (current.role === "system_admin" && current.approved) {
        const { rows: admins } = await client.query(
          "SELECT COUNT(*)::INTEGER AS count FROM users WHERE role = 'system_admin' AND approved = TRUE",
        );
        if (admins[0].count <= 1)
          throw new HttpError(
            400,
            "The last approved System Admin cannot be deleted.",
          );
      }

      await addActivity(client, `Deleted user account: ${current.email}`);
      await client.query("DELETE FROM users WHERE id = $1", [current.id]);
      return current;
    });
    res.json({
      ok: true,
      id: user.id,
      message: "User account deleted. Historical records are retained.",
    });
  }),
);

app.get(
  "/api/dashboard",
  asyncRoute(async (req, res) => {
    const [
      { rows: equipmentTotals },
      { rows: requests },
      { rows: equipmentCount },
      { rows: activity },
    ] = await Promise.all([
      pool.query(
        "SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(available), 0) AS available FROM equipment WHERE active = TRUE",
      ),
      pool.query(
        `SELECT * FROM requests
         ${isBorrower(req.user) ? "WHERE borrower_user_id = $1" : ""}
         ORDER BY created_at DESC`,
        isBorrower(req.user) ? [req.user.id] : [],
      ),
      pool.query("SELECT COUNT(*) AS count FROM equipment WHERE active = TRUE"),
      !isBorrower(req.user)
        ? pool.query("SELECT * FROM activity ORDER BY at DESC LIMIT 30")
        : Promise.resolve({ rows: [] }),
    ]);
    const visibleRequests = requests.map(requestFromRow);
    const borrowed = visibleRequests.filter((request) => request.status === "Borrowed");
    res.json({
      totalEquipment: Number(equipmentTotals[0].total),
      availableEquipment: Number(equipmentTotals[0].available),
      borrowedEquipment: borrowed.reduce((sum, request) => sum + request.quantity, 0),
      overdueRequests: visibleRequests.filter(overdue).length,
      pendingRequests: visibleRequests.filter((request) => request.status === "Pending")
        .length,
      equipmentCount: Number(equipmentCount[0].count),
      recentActivity: activity.map(activityFromRow),
    });
  }),
);

app.get(
  "/api/equipment",
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM equipment WHERE active = TRUE ORDER BY id",
    );
    res.json(rows.map(equipmentFromRow));
  }),
);

app.post(
  "/api/equipment",
  requireEquipmentStaff,
  asyncRoute(async (req, res) => {
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

    const item = await inTransaction(async (client) => {
      const id = await nextEquipmentId(client);
      const { rows } = await client.query(
        `INSERT INTO equipment
           (id, name, category, location, total, available, condition)
         VALUES ($1, $2, $3, $4, $5, $5, $6)
         RETURNING *`,
        [
          id,
          name.trim(),
          category.trim(),
          location.trim(),
          Number(total),
          condition,
        ],
      );
      await addActivity(client, `Added equipment: ${name.trim()}`);
      return equipmentFromRow(rows[0]);
    });
    res.status(201).json(item);
  }),
);

app.put(
  "/api/equipment/:id",
  requireEquipmentStaff,
  asyncRoute(async (req, res) => {
    const item = await inTransaction(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM equipment WHERE id = $1 AND active = TRUE FOR UPDATE",
        [req.params.id],
      );
      const current = rows[0];
      if (!current) throw new HttpError(404, "Equipment not found.");
      const borrowed = current.total - current.available;
      const total =
        req.body.total === undefined ? current.total : Number(req.body.total);
      if (!Number.isInteger(total) || total < borrowed)
        throw new HttpError(
          400,
          `Total cannot be less than ${borrowed} borrowed units.`,
        );
      const { rows: updated } = await client.query(
        `UPDATE equipment
         SET name = $2, category = $3, location = $4, condition = $5,
             total = $6, available = $6 - $7
         WHERE id = $1
         RETURNING *`,
        [
          current.id,
          (req.body.name || current.name).trim(),
          req.body.category || current.category,
          req.body.location || current.location,
          req.body.condition || current.condition,
          total,
          borrowed,
        ],
      );
      await addActivity(client, `Updated equipment: ${updated[0].name}`);
      return equipmentFromRow(updated[0]);
    });
    res.json(item);
  }),
);

app.delete(
  "/api/equipment/:id",
  requireEquipmentStaff,
  asyncRoute(async (req, res) => {
    await inTransaction(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM equipment WHERE id = $1 AND active = TRUE FOR UPDATE",
        [req.params.id],
      );
      const item = rows[0];
      if (!item) throw new HttpError(404, "Equipment not found.");
      if (item.available !== item.total)
        throw new HttpError(
          400,
          "Cannot delete equipment while units are borrowed.",
        );
      await client.query(
        "UPDATE equipment SET active = FALSE WHERE id = $1",
        [item.id],
      );
      await addActivity(client, `Deleted equipment: ${item.name}`);
    });
    res.json({ ok: true });
  }),
);

app.get(
  "/api/maintenance",
  requireEquipmentStaff,
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT m.*, e.name AS equipment_name, u.name AS created_by_name
       FROM maintenance_records m
       JOIN equipment e ON e.id = m.equipment_id
       LEFT JOIN users u ON u.id = m.created_by
       ORDER BY m.created_at DESC`,
    );
    res.json(rows.map(maintenanceFromRow));
  }),
);

app.post(
  "/api/maintenance",
  requireEquipmentStaff,
  asyncRoute(async (req, res) => {
    const { equipmentId, title, description = "" } = req.body;
    if (
      typeof equipmentId !== "string" ||
      !equipmentId ||
      !title?.trim() ||
      typeof description !== "string"
    )
      return res.status(400).json({
        error: "Select equipment and provide a maintenance title.",
      });
    const record = await inTransaction(async (client) => {
      const { rows: equipmentRows } = await client.query(
        "SELECT id, name FROM equipment WHERE id = $1 AND active = TRUE",
        [equipmentId],
      );
      if (!equipmentRows[0])
        throw new HttpError(404, "Active equipment not found.");
      const { rows } = await client.query(
        `INSERT INTO maintenance_records
           (id, equipment_id, title, description, status, created_by)
         VALUES ($1, $2, $3, $4, 'Reported', $5)
         RETURNING *`,
        [
          randomUUID(),
          equipmentId,
          title.trim(),
          description.trim(),
          req.user.id,
        ],
      );
      await addActivity(
        client,
        `Maintenance reported for ${equipmentRows[0].name}: ${title.trim()}`,
      );
      return {
        ...rows[0],
        equipment_name: equipmentRows[0].name,
        created_by_name: req.user.name,
      };
    });
    res.status(201).json(maintenanceFromRow(record));
  }),
);

app.patch(
  "/api/maintenance/:id",
  requireEquipmentStaff,
  asyncRoute(async (req, res) => {
    const { status, notes } = req.body;
    if (
      !MAINTENANCE_STATUSES.includes(status) ||
      (notes !== undefined && typeof notes !== "string")
    )
      return res.status(400).json({
        error: "Provide a valid maintenance status and optional notes.",
      });
    const record = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT m.*, e.name AS equipment_name, u.name AS created_by_name
         FROM maintenance_records m
         JOIN equipment e ON e.id = m.equipment_id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE m.id = $1 FOR UPDATE OF m`,
        [req.params.id],
      );
      const current = rows[0];
      if (!current) throw new HttpError(404, "Maintenance record not found.");
      const transitions = {
        Reported: ["Scheduled", "In Progress", "Cancelled"],
        Scheduled: ["In Progress", "Cancelled"],
        "In Progress": ["Completed", "Cancelled"],
        Completed: [],
        Cancelled: [],
      };
      if (!transitions[current.status].includes(status))
        throw new HttpError(
          400,
          `Maintenance cannot move from ${current.status} to ${status}.`,
        );
      const { rows: updated } = await client.query(
        `UPDATE maintenance_records
         SET status = $2, notes = COALESCE($3, notes), updated_at = NOW(),
             completed_at = CASE WHEN $2 = 'Completed' THEN NOW() ELSE NULL END
         WHERE id = $1
         RETURNING *`,
        [current.id, status, notes ?? null],
      );
      await addActivity(
        client,
        `Maintenance ${current.id} changed to ${status}`,
      );
      return {
        ...updated[0],
        equipment_name: current.equipment_name,
        created_by_name: current.created_by_name,
      };
    });
    res.json(maintenanceFromRow(record));
  }),
);

app.get(
  "/api/requests",
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM requests
       ${isBorrower(req.user) ? "WHERE borrower_user_id = $1" : ""}
       ORDER BY created_at DESC`,
      isBorrower(req.user) ? [req.user.id] : [],
    );
    res.json(rows.map((row) => ({ ...requestFromRow(row), overdue: overdue(requestFromRow(row)) })));
  }),
);

app.post(
  "/api/requests",
  asyncRoute(async (req, res) => {
    const {
      borrower,
      department,
      borrowerEmail,
      equipmentId,
      quantity,
      purpose,
      borrowDate,
      dueDate,
    } = req.body;
    const staffBorrowerEmail =
      typeof borrowerEmail === "string" ? borrowerEmail.trim() : "";
    const borrowerAccount = isBorrower(req.user);
    if (
      (!borrowerAccount &&
        (!borrower?.trim() || !department?.trim() || !staffBorrowerEmail)) ||
      !equipmentId ||
      !purpose?.trim() ||
      !borrowDate ||
      !dueDate
    )
      return res.status(400).json({ error: "Complete all request fields." });
    if (
      !borrowerAccount &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffBorrowerEmail)
    )
      return res
        .status(400)
        .json({ error: "Enter a valid borrower email address." });
    if (!isIsoDate(borrowDate) || !isIsoDate(dueDate))
      return res
        .status(400)
        .json({ error: "Borrow and due dates must be valid calendar dates." });
    if (dueDate < borrowDate)
      return res
        .status(400)
        .json({ error: "Due date cannot precede borrow date." });
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1)
      return res
        .status(400)
        .json({ error: "Quantity must be a positive whole number." });

    const request = await inTransaction(async (client) => {
      const { rows: equipmentRows } = await client.query(
        "SELECT * FROM equipment WHERE id = $1 AND active = TRUE",
        [equipmentId],
      );
      const item = equipmentRows[0];
      if (!item) throw new HttpError(404, "Equipment not found.");
      if (item.available < qty)
        throw new HttpError(400, `Only ${item.available} unit(s) available.`);
      const id = await nextRequestId(client);
      const requestData = {
        id,
        borrower: borrowerAccount ? req.user.name : borrower.trim(),
        department:
          borrowerAccount ? req.user.department : department.trim(),
        borrowerUserId: borrowerAccount ? req.user.id : null,
        borrowerEmail:
          borrowerAccount ? null : staffBorrowerEmail.toLowerCase(),
        equipmentId,
        equipmentName: item.name,
        quantity: qty,
        purpose: purpose.trim(),
        borrowDate,
        dueDate,
      };
      const { rows } = await client.query(
        `INSERT INTO requests
           (id, borrower, department, borrower_user_id, borrower_email,
            equipment_id, equipment_name, quantity, purpose, borrow_date, due_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Pending')
         RETURNING *`,
        [
          requestData.id,
          requestData.borrower,
          requestData.department,
          requestData.borrowerUserId,
          requestData.borrowerEmail,
          requestData.equipmentId,
          requestData.equipmentName,
          requestData.quantity,
          requestData.purpose,
          requestData.borrowDate,
          requestData.dueDate,
        ],
      );
      await addActivity(
        client,
        `${requestData.borrower} requested ${qty} × ${item.name}`,
      );
      return requestFromRow(rows[0]);
    });
    res.status(201).json(request);
  }),
);

app.patch(
  "/api/requests/:id/status",
  requireEquipmentStaff,
  asyncRoute(async (req, res) => {
    const status = req.body.status;
    const allowed = ["Approved", "Rejected", "Borrowed", "Returned"];
    if (!allowed.includes(status))
      return res.status(400).json({ error: "Unsupported status." });

    const result = await inTransaction(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM requests WHERE id = $1 FOR UPDATE",
        [req.params.id],
      );
      const row = rows[0];
      if (!row) throw new HttpError(404, "Request not found.");
      const request = requestFromRow(row);
      let recipient;
      let equipment;
      if (["Approved", "Rejected"].includes(status)) {
        if (request.status !== "Pending")
          throw new HttpError(
            400,
            "Only pending requests can be approved or rejected.",
          );
        if (status === "Approved") {
          const { rows: equipmentRows } = await client.query(
            "SELECT * FROM equipment WHERE id = $1 AND active = TRUE FOR UPDATE",
            [request.equipmentId],
          );
          equipment = equipmentRows[0];
          if (!equipment || equipment.available < request.quantity)
            throw new HttpError(400, "Not enough inventory to approve.");
          const { rows: borrowerRows } = request.borrowerUserId
            ? await client.query("SELECT email FROM users WHERE id = $1", [
                request.borrowerUserId,
              ])
            : { rows: [] };
          recipient = request.borrowerEmail || borrowerRows[0]?.email;
          if (!recipient)
            throw new HttpError(
              400,
              "A borrower email address is required before approval.",
            );
          await client.query(
            "UPDATE equipment SET available = available - $2 WHERE id = $1",
            [equipment.id, request.quantity],
          );
        }
      } else if (status === "Borrowed") {
        if (request.status !== "Approved")
          throw new HttpError(
            400,
            "Approve request before releasing equipment.",
          );
        const { rows: borrowerRows } = request.borrowerUserId
          ? await client.query("SELECT email FROM users WHERE id = $1", [
              request.borrowerUserId,
            ])
          : { rows: [] };
        recipient = request.borrowerEmail || borrowerRows[0]?.email;
      } else {
        if (request.status !== "Borrowed")
          throw new HttpError(
            400,
            "Only borrowed equipment can be returned.",
          );
        const { rows: equipmentRows } = await client.query(
          "SELECT * FROM equipment WHERE id = $1 FOR UPDATE",
          [request.equipmentId],
        );
        equipment = equipmentRows[0];
        if (equipment) {
          await client.query(
            "UPDATE equipment SET available = LEAST(total, available + $2) WHERE id = $1",
            [equipment.id, request.quantity],
          );
        }
      }

      const timestampColumn =
        status === "Borrowed"
          ? ", released_at = NOW()"
          : status === "Returned"
            ? ", returned_at = NOW()"
            : "";
      const { rows: updatedRows } = await client.query(
        `UPDATE requests SET status = $2${timestampColumn}
         WHERE id = $1 RETURNING *`,
        [request.id, status],
      );
      await addActivity(client, `${request.id} status changed to ${status}`);
      return {
        request: requestFromRow(updatedRows[0]),
        recipient,
      };
    });

    let notification;
    if (status === "Approved") {
      notification = await sendEmail(
        result.recipient,
        "EquipTrack Notification: Request Approved",
        `Good news, ${result.request.borrower}: your request for ${result.request.quantity} × ${result.request.equipmentName} has been approved. Please wait for the equipment to be released. Due date: ${result.request.dueDate}.`,
        result.request.id,
        "approval",
        {
          BORROWER_NAME: result.request.borrower,
          ITEM: result.request.equipmentName,
          DUE_DATE: result.request.dueDate,
        },
        RESEND_APPROVAL_TEMPLATE_ID || null,
      );
    } else if (status === "Borrowed") {
      notification = await sendEmail(
        result.recipient,
        "EquipTrack Notification: Borrowed Equipment",
        `Confirmation: ${result.request.borrower}, you borrowed ${result.request.quantity} × ${result.request.equipmentName}. Due date: ${result.request.dueDate}. Please return it on time.`,
        result.request.id,
        "confirmation",
      );
    }

    res.json({
      ...result.request,
      overdue: overdue(result.request),
      ...(status === "Approved" && notification
        ? {
            notification: {
              status: notification.status,
              testRecipient: Boolean(EMAIL_TEST_ADDRESS),
              error: notification.error,
            },
          }
        : {}),
    });
  }),
);

app.get(
  "/api/notifications",
  requireEquipmentStaff,
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM notifications ORDER BY sent_at DESC LIMIT 300",
    );
    res.json(rows.map(notificationFromRow));
  }),
);

app.post(
  "/api/notifications/process",
  requireEquipmentStaff,
  asyncRoute(async (_req, res) => {
    await processSmsNotifications();
    res.json({ ok: true });
  }),
);

app.post(
  "/api/notifications/test",
  requireEquipmentStaff,
  asyncRoute(async (req, res) => {
    const email = req.body.email?.trim() || EMAIL_TEST_ADDRESS;
    if (!email)
      return res
        .status(400)
        .json({ error: "Provide an email address or set EMAIL_TEST_ADDRESS." });
    const entry = await sendEmail(
      email,
      "EquipTrack Email Test",
      "This is a test email from EquipTrack.",
      null,
      "test",
      {
        BORROWER_NAME: "EquipTrack User",
        ITEM: "HDMI Cable",
        DUE_DATE: "November 21, 2026",
      },
    );
    if (entry.status === "failed") return res.status(502).json(entry);
    res.json(entry);
  }),
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err instanceof HttpError ? err.status : 500).json({
    error:
      err instanceof HttpError ? err.message : "Unexpected server error.",
  });
});

async function start() {
  await pool.query("SELECT 1");
  if (process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD?.length >= 10) {
    const email = process.env.STAFF_EMAIL.trim().toLowerCase();
    await pool.query(
      `INSERT INTO users (id, name, email, department, role, password_hash)
       VALUES ($1, $2, $3, 'Equipment Services', 'system_admin', $4)
       ON CONFLICT (email) DO UPDATE
       SET role = 'system_admin', approved = TRUE`,
      [
        randomUUID(),
        process.env.STAFF_NAME?.trim() || "EquipTrack Staff",
        email,
        makePasswordHash(process.env.STAFF_PASSWORD),
      ],
    );
  } else {
    console.warn(
      "System Admin login is not configured. Set STAFF_EMAIL and STAFF_PASSWORD (10+ characters).",
    );
  }
  app.listen(PORT, () => {
    void processSmsNotifications().catch((error) =>
      console.error("Could not process email notifications.", error),
    );
    setInterval(
      () =>
        void processSmsNotifications().catch((error) =>
          console.error("Could not process email notifications.", error),
        ),
      60 * 60 * 1000,
    );
    console.log(`EquipTrack API running at http://localhost:${PORT}`);
  });
}

void start().catch(async (error) => {
  console.error("Could not start EquipTrack API.", error);
  await pool.end();
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await pool.end();
    process.exit(0);
  });
}
