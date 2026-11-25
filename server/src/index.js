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
    phone: user.phone || "",
  };
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
    `SELECT id, name, email, department, role, phone, password_hash
     FROM users WHERE id = $1`,
    [session.userId],
  );
  if (!rows[0])
    return res.status(401).json({ error: "Please sign in to continue." });
  req.user = userFromRow(rows[0]);
  next();
});

function requireStaff(req, res, next) {
  if (req.user.role !== "staff")
    return res.status(403).json({ error: "Staff access is required." });
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
    if (
      !name?.trim() ||
      !email?.trim() ||
      !department?.trim() ||
      typeof password !== "string" ||
      password.length < 10
    )
      return res.status(400).json({
        error: "Complete all fields. Passwords must be at least 10 characters.",
      });

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (id, name, email, department, role, password_hash)
         VALUES ($1, $2, $3, $4, 'borrower', $5)
         RETURNING id, name, email, department, role, phone, password_hash`,
        [
          randomUUID(),
          name.trim(),
          normalizedEmail,
          department.trim(),
          makePasswordHash(password),
        ],
      );
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
      `SELECT id, name, email, department, role, phone, password_hash
       FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0] && userFromRow(rows[0]);
    if (!user || !passwordMatches(password, user.passwordHash))
      return res.status(401).json({ error: "Email or password is incorrect." });
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
         ${req.user.role === "staff" ? "" : "WHERE borrower_user_id = $1"}
         ORDER BY created_at DESC`,
        req.user.role === "staff" ? [] : [req.user.id],
      ),
      pool.query("SELECT COUNT(*) AS count FROM equipment WHERE active = TRUE"),
      req.user.role === "staff"
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
  requireStaff,
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
  requireStaff,
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
  requireStaff,
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
  "/api/requests",
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM requests
       ${req.user.role === "staff" ? "" : "WHERE borrower_user_id = $1"}
       ORDER BY created_at DESC`,
      req.user.role === "staff" ? [] : [req.user.id],
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
    if (
      (req.user.role === "staff" &&
        (!borrower?.trim() || !department?.trim() || !staffBorrowerEmail)) ||
      !equipmentId ||
      !purpose?.trim() ||
      !borrowDate ||
      !dueDate
    )
      return res.status(400).json({ error: "Complete all request fields." });
    if (
      req.user.role === "staff" &&
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
        borrower: req.user.role === "borrower" ? req.user.name : borrower.trim(),
        department:
          req.user.role === "borrower"
            ? req.user.department
            : department.trim(),
        borrowerUserId: req.user.role === "borrower" ? req.user.id : null,
        borrowerEmail:
          req.user.role === "staff" ? staffBorrowerEmail.toLowerCase() : null,
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
  requireStaff,
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
  requireStaff,
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM notifications ORDER BY sent_at DESC LIMIT 300",
    );
    res.json(rows.map(notificationFromRow));
  }),
);

app.post(
  "/api/notifications/process",
  requireStaff,
  asyncRoute(async (_req, res) => {
    await processSmsNotifications();
    res.json({ ok: true });
  }),
);

app.post(
  "/api/notifications/test",
  requireStaff,
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
       VALUES ($1, $2, $3, 'Equipment Services', 'staff', $4)
       ON CONFLICT (email) DO NOTHING`,
      [
        randomUUID(),
        process.env.STAFF_NAME?.trim() || "EquipTrack Staff",
        email,
        makePasswordHash(process.env.STAFF_PASSWORD),
      ],
    );
  } else {
    console.warn(
      "Staff login is not configured. Set STAFF_EMAIL and STAFF_PASSWORD (10+ characters).",
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
