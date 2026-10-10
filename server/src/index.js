import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const app = express();
const PORT = process.env.PORT || 4000;
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");
const dataFile = path.join(dataDir, "db.json");
app.use(cors());
app.use(express.json());

const seed = {
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
};
function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile))
    fs.writeFileSync(dataFile, JSON.stringify(seed, null, 2));
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

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "EquipTrack API" }),
);
app.get("/api/dashboard", (_req, res) => {
  const d = readDb(),
    borrowed = d.requests.filter((r) => r.status === "Borrowed");
  res.json({
    totalEquipment: d.equipment.reduce((s, e) => s + e.total, 0),
    availableEquipment: d.equipment.reduce((s, e) => s + e.available, 0),
    borrowedEquipment: borrowed.reduce((s, r) => s + r.quantity, 0),
    overdueRequests: d.requests.filter(overdue).length,
    pendingRequests: d.requests.filter((r) => r.status === "Pending").length,
    equipmentCount: d.equipment.length,
    recentActivity: d.activity,
  });
});
app.get("/api/equipment", (_req, res) => res.json(readDb().equipment));
app.post("/api/equipment", (req, res) => {
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
app.put("/api/equipment/:id", (req, res) => {
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
app.delete("/api/equipment/:id", (req, res) => {
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
app.get("/api/requests", (_req, res) =>
  res.json(readDb().requests.map((r) => ({ ...r, overdue: overdue(r) }))),
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
    !borrower?.trim() ||
    !department?.trim() ||
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
    borrower: borrower.trim(),
    department: department.trim(),
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
app.patch("/api/requests/:id/status", (req, res) => {
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
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});
app.listen(PORT, () => {
  ensureDb();
  console.log(`EquipTrack API running at http://localhost:${PORT}`);
});
