import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  Computer,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
  XCircle,
} from "lucide-react";
const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
type Equipment = {
  id: string;
  name: string;
  category: string;
  location: string;
  total: number;
  available: number;
  condition: string;
};
type RequestItem = {
  id: string;
  borrower: string;
  department: string;
  equipmentId: string;
  equipmentName: string;
  quantity: number;
  purpose: string;
  borrowDate: string;
  dueDate: string;
  status: string;
  overdue?: boolean;
  createdAt: string;
};
type Dashboard = {
  totalEquipment: number;
  availableEquipment: number;
  borrowedEquipment: number;
  overdueRequests: number;
  pendingRequests: number;
  equipmentCount: number;
  recentActivity: { id: string; message: string; at: string }[];
};
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d as T;
}
const today = () => new Date().toISOString().slice(0, 10);
const dateText = (s: string) =>
  new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export default function App() {
  const [page, setPage] = useState("Dashboard"),
    [equipment, setEquipment] = useState<Equipment[]>([]),
    [requests, setRequests] = useState<RequestItem[]>([]),
    [dash, setDash] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [modal, setModal] = useState<"request" | "equipment" | null>(null),
    [saving, setSaving] = useState(false),
    [mobile, setMobile] = useState(false);
  const refresh = useCallback(async () => {
    setError("");
    try {
      const [e, r, d] = await Promise.all([
        api<Equipment[]>("/equipment"),
        api<RequestItem[]>("/requests"),
        api<Dashboard>("/dashboard"),
      ]);
      setEquipment(e);
      setRequests(r);
      setDash(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend connection failed.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function act(fn: () => Promise<unknown>, message: string) {
    setSaving(true);
    setError("");
    try {
      await fn();
      await refresh();
      setNotice(message);
      window.setTimeout(() => setNotice(""), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setSaving(false);
    }
  }
  async function status(id: string, s: string) {
    await act(
      () =>
        api(`/requests/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: s }),
        }),
      `${id} updated to ${s}.`,
    );
  }
  const eqRows = useMemo(
    () =>
      equipment.filter(
        (e) =>
          `${e.name} ${e.id} ${e.category} ${e.location}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (filter === "All" || e.category === filter),
      ),
    [equipment, search, filter],
  );
  const reqRows = useMemo(
    () =>
      requests.filter(
        (r) =>
          `${r.id} ${r.borrower} ${r.equipmentName} ${r.department}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (filter === "All" ||
            r.status === filter ||
            (filter === "Overdue" && r.overdue)),
      ),
    [requests, search, filter],
  );
  const nav = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Equipment", icon: Package },
    { name: "Borrowing Requests", icon: ClipboardList },
    { name: "Reports", icon: Activity },
  ];
  function go(p: string) {
    setPage(p);
    setSearch("");
    setFilter("All");
    setMobile(false);
  }
  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="brand">
          <div className="brandmark">
            <Package />
          </div>
          <div>
            <b>EquipTrack</b>
            <small>ASSET MANAGEMENT</small>
          </div>
          <button className="close mobile" onClick={() => setMobile(false)}>
            <X />
          </button>
        </div>
        <div className="workspace">
          <span>IT</span>
          <div>
            <b>Institution Workspace</b>
            <small>Equipment Services</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="navlabel">WORKSPACE</div>
        {nav.map((n) => (
          <button
            key={n.name}
            className={`navitem ${page === n.name ? "active" : ""}`}
            onClick={() => go(n.name)}
          >
            <n.icon size={18} />
            {n.name}
            {n.name === "Borrowing Requests" && dash?.pendingRequests ? (
              <em>{dash.pendingRequests}</em>
            ) : null}
          </button>
        ))}
        <div className="sidebottom">
          <div className="help">
            <ShieldCheck />
            <b>Keep assets accountable</b>
            <p>Track every request, release, and return in one place.</p>
            <button onClick={() => go("Reports")}>
              View reports <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="navitem">
            <Settings size={18} />
            Settings
          </button>
          <div className="profile">
            <span>AD</span>
            <div>
              <b>System Admin</b>
              <small>Administrator</small>
            </div>
            <ChevronDown size={14} />
          </div>
        </div>
      </aside>
      {mobile && <button className="scrim" onClick={() => setMobile(false)} />}
      <main className="main">
        <header className="topbar">
          <div className="crumb">
            <button className="hamb" onClick={() => setMobile(true)}>
              <Menu />
            </button>
            <span>Workspace</span> / <b>{page}</b>
          </div>
          <div className="topright">
            <span>
              <CalendarDays size={15} />
              {new Date().toLocaleDateString("en-PH", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <button className="iconbutton">
              <Bell />
              <i />
            </button>
            <b className="admin">AD</b>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="alert err">
              <XCircle />
              {error}
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          {notice && (
            <div className="alert ok">
              <CheckCircle2 />
              {notice}
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {loading && <div className="loading">Loading system data…</div>}
          {page === "Dashboard" && (
            <>
              <Heading
                title="Equipment dashboard"
                sub="Monitor equipment, borrowing requests, and inventory activity."
                eyebrow="OVERVIEW"
                button="New borrowing request"
                onClick={() => setModal("request")}
              />
              <div className="stats">
                <Stat
                  title="Total equipment units"
                  value={dash?.totalEquipment ?? "—"}
                  sub={`${dash?.equipmentCount ?? 0} equipment types`}
                  icon={<Package />}
                  color="blue"
                />
                <Stat
                  title="Available units"
                  value={dash?.availableEquipment ?? "—"}
                  sub="Ready for borrowing"
                  icon={<CheckCircle2 />}
                  color="green"
                />
                <Stat
                  title="Currently borrowed"
                  value={dash?.borrowedEquipment ?? "—"}
                  sub="Units released"
                  icon={<ArrowDownToLine />}
                  color="purple"
                />
                <Stat
                  title="Overdue requests"
                  value={dash?.overdueRequests ?? "—"}
                  sub="Past their due date"
                  icon={<Clock3 />}
                  color="orange"
                />
              </div>
              <div className="twocol">
                <section className="panel">
                  <PanelTitle
                    title="Equipment inventory"
                    sub="Overview of tracked assets"
                    action="View all"
                    click={() => go("Equipment")}
                  />
                  <EquipmentTable rows={equipment.slice(0, 5)} />
                </section>
                <section className="panel">
                  <PanelTitle
                    title="Recent activity"
                    sub="Latest system updates"
                  />
                  {dash?.recentActivity?.length ? (
                    dash.recentActivity.slice(0, 6).map((a) => (
                      <div className="activity" key={a.id}>
                        <span>
                          <Check size={14} />
                        </span>
                        <div>
                          {a.message}
                          <small>{new Date(a.at).toLocaleString()}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty text="Activity will appear here as the system is used." />
                  )}
                </section>
              </div>
              <section className="panel">
                <PanelTitle
                  title="Recent borrowing requests"
                  sub="Review requests and monitor equipment movement"
                  action="View requests"
                  click={() => go("Borrowing Requests")}
                />
                <RequestTable
                  rows={requests.slice(0, 5)}
                  onStatus={status}
                  saving={saving}
                />
              </section>
            </>
          )}
          {page === "Equipment" && (
            <>
              <Heading
                title="Equipment inventory"
                sub="Manage equipment records, quantities, and availability."
                eyebrow="ASSET CONTROL"
                button="Add equipment"
                onClick={() => setModal("equipment")}
              />
              <div className="toolbar">
                <div className="search">
                  <Search />
                  <input
                    placeholder="Search equipment, ID, category..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="filter">
                  <SlidersHorizontal />
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option>All</option>
                    {Array.from(new Set(equipment.map((e) => e.category))).map(
                      (c) => (
                        <option key={c}>{c}</option>
                      ),
                    )}
                  </select>
                </div>
                <button className="iconbutton" onClick={() => void refresh()}>
                  <RefreshCw />
                </button>
              </div>
              <section className="panel">
                <EquipmentTable
                  rows={eqRows}
                  onDelete={(id) => {
                    if (confirm("Delete this equipment record?"))
                      void act(
                        () => api(`/equipment/${id}`, { method: "DELETE" }),
                        "Equipment deleted.",
                      );
                  }}
                />
              </section>
            </>
          )}
          {page === "Borrowing Requests" && (
            <>
              <Heading
                title="Borrowing requests"
                sub="Approve requests, record equipment releases, and process returns."
                eyebrow="BORROWING WORKFLOW"
                button="New request"
                onClick={() => setModal("request")}
              />
              <div className="requestcards">
                {["All", "Pending", "Borrowed", "Overdue"].map((s) => (
                  <button
                    className={filter === s ? "selected" : ""}
                    key={s}
                    onClick={() => setFilter(s)}
                  >
                    <span>{s} requests</span>
                    <b>
                      {s === "All"
                        ? requests.length
                        : s === "Overdue"
                          ? requests.filter((r) => r.overdue).length
                          : requests.filter((r) => r.status === s).length}
                    </b>
                  </button>
                ))}
              </div>
              <div className="toolbar">
                <div className="search">
                  <Search />
                  <input
                    placeholder="Search borrower, request ID, equipment..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="filter">
                  <SlidersHorizontal />
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "All",
                      "Pending",
                      "Approved",
                      "Rejected",
                      "Borrowed",
                      "Returned",
                      "Overdue",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <section className="panel">
                <RequestTable
                  rows={reqRows}
                  onStatus={status}
                  saving={saving}
                />
              </section>
            </>
          )}
          {page === "Reports" && (
            <>
              <Heading
                title="Reports overview"
                sub="Operational totals based on current records."
                eyebrow="REPORTING & ANALYTICS"
                button="Print report"
                onClick={() => window.print()}
              />
              <div className="stats">
                <Stat
                  title="Total units"
                  value={dash?.totalEquipment ?? "—"}
                  icon={<Package />}
                  color="blue"
                />
                <Stat
                  title="Available units"
                  value={dash?.availableEquipment ?? "—"}
                  icon={<CheckCircle2 />}
                  color="green"
                />
                <Stat
                  title="Pending requests"
                  value={dash?.pendingRequests ?? "—"}
                  icon={<ClipboardList />}
                  color="orange"
                />
                <Stat
                  title="Overdue requests"
                  value={dash?.overdueRequests ?? "—"}
                  icon={<Clock3 />}
                  color="purple"
                />
              </div>
              <div className="twocol">
                <section className="panel">
                  <PanelTitle
                    title="Inventory by category"
                    sub="Total units in each category"
                  />
                  {Array.from(new Set(equipment.map((e) => e.category))).map(
                    (c) => {
                      const n = equipment
                        .filter((e) => e.category === c)
                        .reduce((s, e) => s + e.total, 0);
                      const all = Math.max(
                        1,
                        equipment.reduce((s, e) => s + e.total, 0),
                      );
                      return (
                        <div className="barrow" key={c}>
                          <div>
                            {c}
                            <b>{n} units</b>
                          </div>
                          <span>
                            <i style={{ width: `${(n / all) * 100}%` }} />
                          </span>
                        </div>
                      );
                    },
                  )}
                </section>
                <section className="panel">
                  <PanelTitle
                    title="Request status"
                    sub="Count by workflow stage"
                  />
                  {[
                    "Pending",
                    "Approved",
                    "Borrowed",
                    "Returned",
                    "Rejected",
                  ].map((s) => (
                    <div className="statuscount" key={s}>
                      <span className={`dot ${s.toLowerCase()}`} />
                      {s}
                      <b>{requests.filter((r) => r.status === s).length}</b>
                    </div>
                  ))}
                </section>
              </div>
              <section className="panel">
                <PanelTitle
                  title="Equipment register"
                  sub="Current inventory records"
                />
                <EquipmentTable rows={equipment} />
              </section>
            </>
          )}
        </div>
        <footer>
          EquipTrack · Initial presentation prototype{" "}
          <span>
            <i /> API-connected demo
          </span>
        </footer>
      </main>
      {modal && (
        <Modal
          title={
            modal === "request" ? "Create borrowing request" : "Add equipment"
          }
          close={() => setModal(null)}
        >
          {modal === "request" ? (
            <RequestForm
              equipment={equipment}
              saving={saving}
              cancel={() => setModal(null)}
              submit={(d) =>
                void act(
                  () =>
                    api("/requests", {
                      method: "POST",
                      body: JSON.stringify(d),
                    }),
                  "Borrowing request created.",
                ).then(() => setModal(null))
              }
            />
          ) : (
            <EquipmentForm
              saving={saving}
              cancel={() => setModal(null)}
              submit={(d) =>
                void act(
                  () =>
                    api("/equipment", {
                      method: "POST",
                      body: JSON.stringify(d),
                    }),
                  "Equipment added successfully.",
                ).then(() => setModal(null))
              }
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function Heading({
  title,
  sub,
  eyebrow,
  button,
  onClick,
}: {
  title: string;
  sub: string;
  eyebrow: string;
  button: string;
  onClick: () => void;
}) {
  return (
    <div className="heading">
      <div>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <button className="primary" onClick={onClick}>
        <Plus size={16} />
        {button}
      </button>
    </div>
  );
}
function Stat({
  title,
  value,
  sub,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="stat">
      <span className={`staticon ${color}`}>{icon}</span>
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        {sub && <em>{sub}</em>}
      </div>
    </div>
  );
}
function PanelTitle({
  title,
  sub,
  action,
  click,
}: {
  title: string;
  sub: string;
  action?: string;
  click?: () => void;
}) {
  return (
    <div className="paneltitle">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {action && (
        <button onClick={click}>
          {action}
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Archive size={23} />
      {text}
    </div>
  );
}
function EquipmentTable({
  rows,
  onDelete,
}: {
  rows: Equipment[];
  onDelete?: (id: string) => void;
}) {
  if (!rows.length) return <Empty text="No equipment records found." />;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Equipment</th>
            <th>Category</th>
            <th>Location</th>
            <th>Availability</th>
            <th>Condition</th>
            {onDelete && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td>
                <div className="equipcell">
                  <span>
                    <Computer size={18} />
                  </span>
                  <div>
                    <b>{e.name}</b>
                    <small>
                      {e.id} · {e.total} total units
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <label className="chip">{e.category}</label>
              </td>
              <td>{e.location}</td>
              <td>
                <b>{e.available}</b>
                <small className="inline"> / {e.total} available</small>
                <div className="progress">
                  <i
                    style={{
                      width: `${e.total ? (e.available / e.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </td>
              <td>
                <label
                  className={`condition ${e.condition === "Good" ? "good" : "warn"}`}
                >
                  {e.condition}
                </label>
              </td>
              {onDelete && (
                <td>
                  <button className="delete" onClick={() => onDelete(e.id)}>
                    <X size={14} /> Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function RequestTable({
  rows,
  onStatus,
  saving,
}: {
  rows: RequestItem[];
  onStatus: (id: string, s: string) => void;
  saving: boolean;
}) {
  if (!rows.length)
    return <Empty text="No borrowing requests match your search." />;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Request / Borrower</th>
            <th>Equipment</th>
            <th>Borrow period</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="person">
                  <span>
                    {r.borrower
                      .split(" ")
                      .map((x) => x[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div>
                    <b>{r.borrower}</b>
                    <small>
                      {r.id} · {r.department}
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <b>{r.equipmentName}</b>
                <small>Quantity: {r.quantity}</small>
              </td>
              <td>
                <b>{dateText(r.borrowDate)}</b>
                <small>Due {dateText(r.dueDate)}</small>
              </td>
              <td>
                <label
                  className={`status ${r.overdue ? "overdue" : r.status.toLowerCase()}`}
                >
                  {r.overdue ? "Overdue" : r.status}
                </label>
              </td>
              <td>
                <div className="actions">
                  {r.status === "Pending" && (
                    <>
                      <button
                        disabled={saving}
                        className="approve"
                        onClick={() => onStatus(r.id, "Approved")}
                        title="Approve"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        disabled={saving}
                        className="reject"
                        onClick={() => onStatus(r.id, "Rejected")}
                        title="Reject"
                      >
                        <X size={14} />
                      </button>
                    </>
                  )}
                  {r.status === "Approved" && (
                    <button
                      disabled={saving}
                      className="release"
                      onClick={() => onStatus(r.id, "Borrowed")}
                    >
                      <ArrowDownToLine size={14} /> Release
                    </button>
                  )}
                  {r.status === "Borrowed" && (
                    <button
                      disabled={saving}
                      className="approve"
                      onClick={() => onStatus(r.id, "Returned")}
                    >
                      <Check size={14} /> Return
                    </button>
                  )}
                  {["Returned", "Rejected"].includes(r.status) && (
                    <span className="dim">—</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="modal">
        <header>
          <div>
            <small>EQUIPTRACK FORM</small>
            <h2>{title}</h2>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function RequestForm({
  equipment,
  saving,
  cancel,
  submit,
}: {
  equipment: Equipment[];
  saving: boolean;
  cancel: () => void;
  submit: (d: Record<string, unknown>) => void;
}) {
  const [f, S] = useState({
    borrower: "",
    department: "",
    equipmentId: equipment[0]?.id || "",
    quantity: "1",
    purpose: "",
    borrowDate: today(),
    dueDate: today(),
  });
  const [err, E] = useState("");
  useEffect(() => {
    if (!f.equipmentId && equipment[0])
      S((x) => ({ ...x, equipmentId: equipment[0].id }));
  }, [equipment, f.equipmentId]);
  function send(e: React.FormEvent) {
    e.preventDefault();
    const item = equipment.find((x) => x.id === f.equipmentId);
    if (!item || Number(f.quantity) > item.available) {
      E(`Only ${item?.available ?? 0} unit(s) available.`);
      return;
    }
    E("");
    submit({ ...f, quantity: Number(f.quantity) });
  }
  return (
    <form onSubmit={send}>
      <div className="formgrid">
        {err && <p className="formerror">{err}</p>}
        <label>
          Borrower's full name
          <input
            required
            value={f.borrower}
            onChange={(e) => S({ ...f, borrower: e.target.value })}
            placeholder="e.g. Alex Santos"
          />
        </label>
        <label>
          Department / section
          <input
            required
            value={f.department}
            onChange={(e) => S({ ...f, department: e.target.value })}
            placeholder="e.g. BSIT - 3A"
          />
        </label>
        <label className="span2">
          Equipment
          <select
            required
            value={f.equipmentId}
            onChange={(e) => S({ ...f, equipmentId: e.target.value })}
          >
            {equipment.map((x) => (
              <option key={x.id} value={x.id} disabled={!x.available}>
                {x.name} ({x.available} available)
              </option>
            ))}
          </select>
        </label>
        <label>
          Quantity
          <input
            type="number"
            min="1"
            max={equipment.find((x) => x.id === f.equipmentId)?.available || 1}
            required
            value={f.quantity}
            onChange={(e) => S({ ...f, quantity: e.target.value })}
          />
        </label>
        <label>
          Purpose
          <input
            required
            value={f.purpose}
            onChange={(e) => S({ ...f, purpose: e.target.value })}
            placeholder="Reason for borrowing"
          />
        </label>
        <label>
          Borrow date
          <input
            type="date"
            required
            value={f.borrowDate}
            onChange={(e) => S({ ...f, borrowDate: e.target.value })}
          />
        </label>
        <label>
          Due date
          <input
            type="date"
            min={f.borrowDate}
            required
            value={f.dueDate}
            onChange={(e) => S({ ...f, dueDate: e.target.value })}
          />
        </label>
      </div>
      <div className="modalactions">
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={saving || !equipment.length}>
          {saving ? "Saving…" : "Create request"}
        </button>
      </div>
    </form>
  );
}
function EquipmentForm({
  saving,
  cancel,
  submit,
}: {
  saving: boolean;
  cancel: () => void;
  submit: (d: Record<string, unknown>) => void;
}) {
  const [f, S] = useState({
    name: "",
    category: "Computer",
    location: "IT Laboratory",
    total: "1",
    condition: "Good",
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit({ ...f, total: Number(f.total) });
      }}
    >
      <div className="formgrid">
        <label className="span2">
          Equipment name
          <input
            required
            value={f.name}
            onChange={(e) => S({ ...f, name: e.target.value })}
            placeholder="e.g. Laptop - Dell Latitude"
          />
        </label>
        <label>
          Category
          <select
            value={f.category}
            onChange={(e) => S({ ...f, category: e.target.value })}
          >
            {[
              "Computer",
              "Presentation",
              "Accessory",
              "Camera",
              "Audio",
              "Networking",
              "Other",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Location
          <input
            required
            value={f.location}
            onChange={(e) => S({ ...f, location: e.target.value })}
          />
        </label>
        <label>
          Total quantity
          <input
            type="number"
            min="1"
            required
            value={f.total}
            onChange={(e) => S({ ...f, total: e.target.value })}
          />
        </label>
        <label>
          Condition
          <select
            value={f.condition}
            onChange={(e) => S({ ...f, condition: e.target.value })}
          >
            <option>Good</option>
            <option>Needs inspection</option>
            <option>Under repair</option>
          </select>
        </label>
      </div>
      <div className="modalactions">
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : "Add equipment"}
        </button>
      </div>
    </form>
  );
}
