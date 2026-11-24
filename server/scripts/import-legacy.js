import "../src/env.js";
import pg from "pg";

const { Pool } = pg;
const dryRun = process.argv.includes("--dry-run");
const confirmImport = process.argv.includes("--confirm-import");

if (dryRun === confirmImport) {
  throw new Error("Specify exactly one of --dry-run or --confirm-import.");
}

const apiUrlValue = process.env.LEGACY_API_URL;
const staffEmail = process.env.LEGACY_STAFF_EMAIL;
const staffPassword = process.env.LEGACY_STAFF_PASSWORD;
const targetDatabaseUrl = process.env.LEGACY_IMPORT_DATABASE_URL;

if (!apiUrlValue || !staffEmail || !staffPassword || !targetDatabaseUrl) {
  throw new Error(
    "Set LEGACY_API_URL, LEGACY_STAFF_EMAIL, LEGACY_STAFF_PASSWORD, and LEGACY_IMPORT_DATABASE_URL.",
  );
}

const apiUrl = new URL(apiUrlValue);
if (
  apiUrl.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(apiUrl.hostname)
) {
  throw new Error("LEGACY_API_URL must use HTTPS.");
}
apiUrl.pathname = `${apiUrl.pathname.replace(/\/+$/, "")}/`;

if (process.env.DATABASE_URL) {
  const activeDatabaseUrl = new URL(process.env.DATABASE_URL);
  const importDatabaseUrl = new URL(targetDatabaseUrl);
  if (
    activeDatabaseUrl.hostname === importDatabaseUrl.hostname &&
    activeDatabaseUrl.port === importDatabaseUrl.port &&
    activeDatabaseUrl.pathname === importDatabaseUrl.pathname
  ) {
    throw new Error(
      "LEGACY_IMPORT_DATABASE_URL must be different from DATABASE_URL.",
    );
  }
}

const pool = new Pool({
  connectionString: targetDatabaseUrl,
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Legacy data has an invalid ${field}.`);
  }
  return value.trim();
}

function requireInteger(value, field, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`Legacy data has an invalid ${field}.`);
  }
  return value;
}

function normalizeTimestamp(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Legacy data has an invalid ${field}.`);
  }
  return date.toISOString();
}

function normalizeDate(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Legacy data has an invalid ${field}.`);
  }
  return value;
}

function normalizeEquipment(item) {
  const id = requireString(item.id, "equipment ID");
  if (!/^EQ-\d+$/.test(id)) {
    throw new Error("Legacy data has an unsupported equipment ID.");
  }
  const total = requireInteger(item.total, "equipment total", 1);
  const available = requireInteger(item.available, "available quantity", 0);
  if (available > total) {
    throw new Error("Legacy data has available equipment above its total.");
  }
  return {
    id,
    name: requireString(item.name, "equipment name"),
    category: requireString(item.category, "equipment category"),
    location: requireString(item.location, "equipment location"),
    total,
    available,
    condition: requireString(item.condition, "equipment condition"),
  };
}

function normalizeRequest(item) {
  const id = requireString(item.id, "request ID");
  if (!/^BR-\d+$/.test(id)) {
    throw new Error("Legacy data has an unsupported request ID.");
  }
  const status = requireString(item.status, "request status");
  if (
    !["Pending", "Approved", "Rejected", "Borrowed", "Returned"].includes(
      status,
    )
  ) {
    throw new Error("Legacy data has an unsupported request status.");
  }
  const borrowDate = normalizeDate(item.borrowDate, "borrow date");
  const dueDate = normalizeDate(item.dueDate, "due date");
  if (dueDate < borrowDate) {
    throw new Error("Legacy data has a due date before its borrow date.");
  }
  return {
    id,
    borrower: requireString(item.borrower, "borrower name"),
    department: requireString(item.department, "borrower department"),
    borrowerEmail:
      typeof item.borrowerEmail === "string" && item.borrowerEmail.trim()
        ? item.borrowerEmail.trim().toLowerCase()
        : null,
    equipmentId: requireString(item.equipmentId, "request equipment ID"),
    equipmentName: requireString(item.equipmentName, "request equipment name"),
    quantity: requireInteger(item.quantity, "request quantity", 1),
    purpose: requireString(item.purpose, "request purpose"),
    borrowDate,
    dueDate,
    status,
    createdAt: normalizeTimestamp(item.createdAt, "request creation time"),
    releasedAt: item.releasedAt
      ? normalizeTimestamp(item.releasedAt, "release time")
      : null,
    returnedAt: item.returnedAt
      ? normalizeTimestamp(item.returnedAt, "return time")
      : null,
  };
}

async function fetchJson(path, { token, body } = {}) {
  const response = await fetch(new URL(path, apiUrl), {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`Legacy API request failed with HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Legacy API returned an invalid JSON response.");
  }
}

async function fetchLegacyData() {
  const session = await fetchJson("auth/login", {
    body: { email: staffEmail, password: staffPassword },
  });
  if (!session?.token || session.user?.role !== "staff") {
    throw new Error("Legacy API login did not return a staff session.");
  }
  const [equipment, requests] = await Promise.all([
    fetchJson("equipment", { token: session.token }),
    fetchJson("requests", { token: session.token }),
  ]);
  if (!Array.isArray(equipment) || !Array.isArray(requests)) {
    throw new Error("Legacy API returned an unexpected data format.");
  }
  const normalizedEquipment = equipment.map(normalizeEquipment);
  const normalizedRequests = requests.map(normalizeRequest);
  if (normalizedEquipment.length === 0) {
    throw new Error("Legacy API returned no equipment; import was stopped.");
  }
  if (
    new Set(normalizedEquipment.map((item) => item.id)).size !==
    normalizedEquipment.length
  ) {
    throw new Error("Legacy API returned duplicate equipment IDs.");
  }
  if (
    new Set(normalizedRequests.map((item) => item.id)).size !==
    normalizedRequests.length
  ) {
    throw new Error("Legacy API returned duplicate request IDs.");
  }
  return { equipment: normalizedEquipment, requests: normalizedRequests };
}

async function importData(client, { equipment, requests }, { dryRun }) {
  const { rows: targetRequests } = await client.query(
    "SELECT COUNT(*)::INTEGER AS count FROM requests",
  );
  if (targetRequests[0].count !== 0)
    throw new Error(
      "Target database already contains requests; import was stopped.",
    );

  const seedEquipmentIds = new Set([
    "EQ-1001",
    "EQ-1002",
    "EQ-1003",
    "EQ-1004",
    "EQ-1005",
  ]);
  const { rows: targetEquipment } = await client.query(
    "SELECT id FROM equipment",
  );
  if (targetEquipment.some((item) => !seedEquipmentIds.has(item.id))) {
    throw new Error(
      "Target database contains non-seed equipment; import was stopped.",
    );
  }

  await client.query("UPDATE equipment SET active = FALSE");
  for (const item of equipment) {
    await client.query(
      `INSERT INTO equipment
         (id, name, category, location, total, available, condition, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, category = EXCLUDED.category,
           location = EXCLUDED.location, total = EXCLUDED.total,
           available = EXCLUDED.available, condition = EXCLUDED.condition,
           active = TRUE`,
      [
        item.id,
        item.name,
        item.category,
        item.location,
        item.total,
        item.available,
        item.condition,
      ],
    );
  }

  const equipmentIds = new Set(equipment.map((item) => item.id));
  const missingEquipment = new Map();
  for (const request of requests) {
    if (equipmentIds.has(request.equipmentId)) continue;
    const existing = missingEquipment.get(request.equipmentId) || {
      name: request.equipmentName,
      outstanding: 0,
    };
    if (["Approved", "Borrowed"].includes(request.status)) {
      existing.outstanding += request.quantity;
    }
    missingEquipment.set(request.equipmentId, existing);
  }

  for (const [id, item] of missingEquipment) {
    const total = Math.max(item.outstanding, 1);
    await client.query(
      `INSERT INTO equipment
         (id, name, category, location, total, available, condition, active)
       VALUES ($1, $2, 'Legacy archive', 'Legacy archive', $3, $4, 'Not tracked', FALSE)
       ON CONFLICT (id) DO UPDATE SET active = FALSE`,
      [id, item.name, total, total - item.outstanding],
    );
  }

  for (const request of requests) {
    await client.query(
      `INSERT INTO requests
         (id, borrower, department, borrower_user_id, borrower_email,
          equipment_id, equipment_name, quantity, purpose, borrow_date, due_date,
          status, created_at, released_at, returned_at)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        request.id,
        request.borrower,
        request.department,
        request.borrowerEmail,
        request.equipmentId,
        request.equipmentName,
        request.quantity,
        request.purpose,
        request.borrowDate,
        request.dueDate,
        request.status,
        request.createdAt,
        request.releasedAt,
        request.returnedAt,
      ],
    );
  }

  if (!dryRun) {
    await client.query(
      `SELECT setval(
         'equipment_id_seq',
         GREATEST(
           COALESCE(
             (SELECT MAX(SUBSTRING(id FROM 4)::INTEGER)
              FROM equipment WHERE id ~ '^EQ-[0-9]+$'),
             1000
           ),
           1000
         )
       )`,
    );
    await client.query(
      `SELECT setval(
         'request_id_seq',
         GREATEST(
           COALESCE(
             (SELECT MAX(SUBSTRING(id FROM 4)::INTEGER)
              FROM requests WHERE id ~ '^BR-[0-9]+$'),
             2000
           ),
           2000
         )
       )`,
    );
  }
}

let client;
let transactionOpen = false;
try {
  const legacyData = await fetchLegacyData();
  client = await pool.connect();
  await client.query("BEGIN");
  transactionOpen = true;
  await importData(client, legacyData, { dryRun });

  if (dryRun) {
    await client.query("ROLLBACK");
    transactionOpen = false;
    console.log(
      `Dry run passed: ${legacyData.equipment.length} equipment records and ${legacyData.requests.length} requests validated; no changes were committed.`,
    );
  } else {
    await client.query("COMMIT");
    transactionOpen = false;
    console.log(
      `Legacy import complete: ${legacyData.equipment.length} equipment records and ${legacyData.requests.length} requests imported. User accounts and activity logs were not imported.`,
    );
  }
} catch (error) {
  if (client && transactionOpen) await client.query("ROLLBACK");
  console.error(
    "Legacy import failed.",
    error instanceof Error ? error.message : "Unknown error.",
  );
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
