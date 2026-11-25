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
  LogOut,
  Menu,
  Moon,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
type UserRole =
  | "system_admin"
  | "equipment_custodian"
  | "faculty_staff"
  | "authorized_student";
const USER_ROLES: UserRole[] = [
  "system_admin",
  "equipment_custodian",
  "faculty_staff",
  "authorized_student",
];
type AuthUser = {
  id: string;
  name: string;
  email: string;
  department: string;
  role: UserRole;
  approved: boolean;
  phone: string;
};
type UserRecord = Omit<AuthUser, "phone"> & {
  createdAt: string;
  isBootstrapAdmin: boolean;
};
type SystemSettings = {
  studentRegistrationEnabled: boolean;
  defaultLoanDays: number;
  updatedAt: string;
};
type MaintenanceStatus =
  | "Reported"
  | "Scheduled"
  | "In Progress"
  | "Completed"
  | "Cancelled";
const MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  "Reported",
  "Scheduled",
  "In Progress",
  "Completed",
  "Cancelled",
];
type MaintenanceRecord = {
  id: string;
  equipmentId: string;
  equipmentName: string;
  title: string;
  description: string;
  status: MaintenanceStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
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
  borrowerEmail?: string;
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
type EmailNotification = {
  status: "sent" | "logged" | "failed" | "skipped";
  testRecipient: boolean;
  error?: string;
};
type NotificationRecord = {
  id: string;
  requestId: string | null;
  type: string;
  email: string | null;
  subject: string;
  text: string;
  sentAt: string;
  status: "sent" | "logged" | "failed" | "skipped";
  error?: string;
};
type StatusActionResult = {
  notification?: EmailNotification;
};
type Notice = {
  message: string;
  kind: "ok" | "err";
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
  const token = localStorage.getItem("equiptrack-token");
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d as T;
}
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};
const dateText = (s: string) =>
  new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function storedTheme(): "light" | "dark" {
  return localStorage.getItem("equiptrack-theme") === "dark" ? "dark" : "light";
}
const isBorrowerRole = (role: UserRole) =>
  role === "faculty_staff" || role === "authorized_student";
const isUserRole = (value: string): value is UserRole =>
  USER_ROLES.some((role) => role === value);
const isMaintenanceStatus = (value: string): value is MaintenanceStatus =>
  MAINTENANCE_STATUSES.some((status) => status === value);
const roleLabel = (role: UserRole) =>
  ({
    system_admin: "System Admin",
    equipment_custodian: "Equipment Custodian",
    faculty_staff: "Faculty & Staff",
    authorized_student: "Authorized Student",
  })[role];
export default function App() {
  const [page, setPage] = useState("Dashboard"),
    [theme, setTheme] = useState<"light" | "dark">(storedTheme),
    [authUser, setAuthUser] = useState<AuthUser | null>(null),
    [authLoading, setAuthLoading] = useState(true),
    [equipment, setEquipment] = useState<Equipment[]>([]),
    [requests, setRequests] = useState<RequestItem[]>([]),
    [dash, setDash] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<Notice | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [modal, setModal] = useState<
      "request" | "equipment" | "maintenance" | "user" | null
    >(null),
    [saving, setSaving] = useState(false),
    [mobile, setMobile] = useState(false),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [notifications, setNotifications] = useState<NotificationRecord[]>([]),
    [notificationsLoading, setNotificationsLoading] = useState(false),
    [notificationsError, setNotificationsError] = useState(""),
    [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]),
    [maintenanceLoading, setMaintenanceLoading] = useState(false),
    [users, setUsers] = useState<UserRecord[]>([]),
    [usersLoading, setUsersLoading] = useState(false),
    [systemSettings, setSystemSettings] = useState<SystemSettings>({
      studentRegistrationEnabled: true,
      defaultLoanDays: 7,
      updatedAt: "",
    });
  const isStaff =
    authUser?.role === "system_admin" ||
    authUser?.role === "equipment_custodian";
  const isSystemAdmin = authUser?.role === "system_admin";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("equiptrack-theme", theme);
  }, [theme]);
  const refresh = useCallback(async () => {
    setError("");
    try {
      const [e, r, d, s] = await Promise.all([
        api<Equipment[]>("/equipment"),
        api<RequestItem[]>("/requests"),
        api<Dashboard>("/dashboard"),
        api<SystemSettings>("/settings"),
      ]);
      setEquipment(e);
      setRequests(r);
      setDash(d);
      setSystemSettings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend connection failed.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const token = localStorage.getItem("equiptrack-token");
    if (!token) {
      setAuthLoading(false);
      return;
    }
    void api<AuthUser>("/auth/me")
      .then(setAuthUser)
      .catch(() => localStorage.removeItem("equiptrack-token"))
      .finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => {
    if (authUser) void refresh();
  }, [authUser, refresh]);
  const loadMaintenance = useCallback(async () => {
    setMaintenanceLoading(true);
    try {
      setMaintenance(await api<MaintenanceRecord[]>("/maintenance"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load maintenance.");
    } finally {
      setMaintenanceLoading(false);
    }
  }, []);
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      setUsers(await api<UserRecord[]>("/users"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load user accounts.");
    } finally {
      setUsersLoading(false);
    }
  }, []);
  useEffect(() => {
    if (isStaff && page === "Maintenance") void loadMaintenance();
    if (isSystemAdmin && page === "Settings") void loadUsers();
  }, [isStaff, isSystemAdmin, page, loadMaintenance, loadUsers]);
  async function act<T>(
    fn: () => Promise<T>,
    message: string | ((result: T) => Notice),
  ): Promise<boolean> {
    setSaving(true);
    setError("");
    try {
      const result = await fn();
      await refresh();
      setNotice(
        typeof message === "function"
          ? message(result)
          : { message, kind: "ok" },
      );
      window.setTimeout(() => setNotice(null), 3500);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function status(id: string, s: string) {
    await act(
      () =>
        api<StatusActionResult>(`/requests/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: s }),
        }),
      (result) => {
        const notification = result.notification;
        if (s !== "Approved" || !notification)
          return { message: `${id} updated to ${s}.`, kind: "ok" };
        if (notification.status === "sent") {
          return notification.testRecipient
            ? {
                message: `${id} approved. Email was sent to the configured test address, not the borrower.`,
                kind: "err",
              }
            : {
                message: `${id} approved and the email was sent to the borrower.`,
                kind: "ok",
              };
        }
        if (notification.status === "logged")
          return {
            message: `${id} approved, but the email was only logged locally and was not delivered.`,
            kind: "err",
          };
        return {
          message: `${id} approved, but the email failed${notification.error ? `: ${notification.error}` : "."}`,
          kind: "err",
        };
      },
    );
  }
  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      setNotifications(await api<NotificationRecord[]>("/notifications"));
    } catch (e) {
      setNotificationsError(
        e instanceof Error ? e.message : "Unable to load notifications.",
      );
    } finally {
      setNotificationsLoading(false);
    }
  }
  async function toggleNotifications() {
    const shouldOpen = !notificationsOpen;
    setNotificationsOpen(shouldOpen);
    if (shouldOpen && isStaff) await loadNotifications();
  }
  async function saveSystemSettings() {
    await act(
      () =>
        api<SystemSettings>("/settings", {
          method: "PATCH",
          body: JSON.stringify({
            studentRegistrationEnabled:
              systemSettings.studentRegistrationEnabled,
            defaultLoanDays: systemSettings.defaultLoanDays,
          }),
        }),
      "System settings saved.",
    );
  }
  async function updateUser(
    id: string,
    change: { role?: UserRole; approved?: boolean },
  ) {
    const success = await act(
      () =>
        api<UserRecord>(`/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify(change),
        }),
      "User access updated.",
    );
    if (success) await loadUsers();
  }
  async function deleteUser(id: string) {
    const success = await act(
      () => api(`/users/${id}`, { method: "DELETE" }),
      "User account deleted. Historical records were retained.",
    );
    if (success) await loadUsers();
  }
  async function updateMaintenance(
    id: string,
    status: MaintenanceStatus,
  ) {
    const success = await act(
      () =>
        api<MaintenanceRecord>(`/maintenance/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      `Maintenance status changed to ${status}.`,
    );
    if (success) await loadMaintenance();
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
    { name: "Dashboard", label: "Dashboard", icon: LayoutDashboard },
    { name: "Equipment", label: "Equipment", icon: Package },
    {
      name: "Borrowing Requests",
      label: isStaff ? "Borrowing Requests" : "My Requests",
      icon: ClipboardList,
    },
    ...(isStaff
      ? [{ name: "Maintenance", label: "Maintenance", icon: Wrench }]
      : []),
    ...(isStaff ? [{ name: "Reports", label: "Reports", icon: Activity }] : []),
  ];
  function go(p: string) {
    setPage(p);
    setSearch("");
    setFilter("All");
    setMobile(false);
  }
  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem("equiptrack-token");
    setAuthUser(null);
    setPage("Dashboard");
    setEquipment([]);
    setRequests([]);
    setDash(null);
  }
  if (authLoading)
    return <div className="authloading">Checking your session…</div>;
  if (!authUser)
    return (
      <AuthScreen
        onAuthenticated={(session) => {
          localStorage.setItem("equiptrack-token", session.token);
          setAuthUser(session.user);
        }}
      />
    );
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
            {n.label}
            {n.name === "Borrowing Requests" && dash?.pendingRequests ? (
              <em>{dash.pendingRequests}</em>
            ) : null}
          </button>
        ))}
        <div className="sidebottom">
          {isStaff && (
            <div className="help">
              <ShieldCheck />
              <b>Keep assets accountable</b>
              <p>Track every request, release, and return in one place.</p>
              <button onClick={() => go("Reports")}>
                View reports <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          <button
            className={`navitem ${page === "Settings" ? "active" : ""}`}
            onClick={() => go("Settings")}
          >
            <Settings size={18} />
            Settings
          </button>
          <div className="profile">
            <span>
              {authUser.name
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <div>
              <b>{authUser.name}</b>
              <small>{roleLabel(authUser.role)}</small>
            </div>
          </div>
          <button
            className="logout"
            onClick={() => void signOut()}
            title="Sign out"
          >
            <LogOut size={15} /> Sign out
          </button>
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
            {isStaff && (
              <div className="notification-control">
                <button
                  className="iconbutton"
                  aria-label="Notifications"
                  aria-expanded={notificationsOpen}
                  onClick={() => void toggleNotifications()}
                >
                  <Bell />
                  {notifications.length > 0 && (
                    <span className="notification-count">
                      {notifications.length > 99 ? "99+" : notifications.length}
                    </span>
                  )}
                </button>
                {notificationsOpen && (
                  <section className="notification-panel">
                    <div className="notification-heading">
                      <div>
                        <b>Notifications</b>
                        <small>Email delivery history</small>
                      </div>
                      <button
                        className="notification-refresh"
                        aria-label="Refresh notifications"
                        onClick={() => void loadNotifications()}
                      >
                        <RefreshCw size={15} />
                      </button>
                    </div>
                    {notificationsLoading ? (
                      <div className="notification-message">Loading…</div>
                    ) : notificationsError ? (
                      <div className="notification-message notification-error">
                        {notificationsError}
                      </div>
                    ) : notifications.length ? (
                      <div className="notification-list">
                        {notifications.slice(0, 20).map((notification) => (
                          <article
                            className="notification-item"
                            key={notification.id}
                          >
                            <div>
                              <b>{notification.subject}</b>
                              <small>
                                {notification.requestId
                                  ? `${notification.requestId} · `
                                  : ""}
                                {new Date(notification.sentAt).toLocaleString()}
                              </small>
                              <p>{notification.text}</p>
                              {notification.error && (
                                <small className="notification-error">
                                  {notification.error}
                                </small>
                              )}
                            </div>
                            <span
                              className={`notification-status ${notification.status}`}
                            >
                              {notification.status}
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="notification-message">
                        No email notifications yet.
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
            <b className="admin">{authUser.name.slice(0, 1).toUpperCase()}</b>
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
            <div className={`alert ${notice.kind}`}>
              {notice.kind === "ok" ? <CheckCircle2 /> : <XCircle />}
              {notice.message}
              <button onClick={() => setNotice(null)}>×</button>
            </div>
          )}
          {loading && <div className="loading">Loading system data…</div>}
          {page === "Dashboard" && (
            <>
              <Heading
                title="Equipment dashboard"
                sub="Monitor equipment, borrowing requests, and inventory activity."
                eyebrow="OVERVIEW"
                button={isStaff ? undefined : "New borrowing request"}
                onClick={isStaff ? undefined : () => setModal("request")}
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
                    title={isStaff ? "Recent activity" : "Your recent requests"}
                    sub={
                      isStaff
                        ? "Latest system updates"
                        : "Latest borrowing activity"
                    }
                  />
                  {!isStaff ? (
                    <RequestTable
                      rows={requests.slice(0, 5)}
                      onStatus={status}
                      saving={saving}
                      canManage={false}
                    />
                  ) : dash?.recentActivity?.length ? (
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
              {isStaff && (
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
                    canManage
                  />
                </section>
              )}
            </>
          )}
          {page === "Equipment" && (
            <>
              <Heading
                title="Equipment inventory"
                sub="Manage equipment records, quantities, and availability."
                eyebrow="ASSET CONTROL"
                button={isStaff ? "Add equipment" : undefined}
                onClick={isStaff ? () => setModal("equipment") : undefined}
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
                  onDelete={
                    isStaff
                      ? (id) => {
                          if (confirm("Delete this equipment record?"))
                            void act(
                              () =>
                                api(`/equipment/${id}`, { method: "DELETE" }),
                              "Equipment deleted.",
                            );
                        }
                      : undefined
                  }
                />
              </section>
            </>
          )}
          {page === "Borrowing Requests" && (
            <>
              <Heading
                title="Borrowing requests"
                sub={
                  isStaff
                    ? "Approve requests, record equipment releases, and process returns."
                    : "Track the status of your equipment requests."
                }
                eyebrow={isStaff ? "BORROWING WORKFLOW" : "YOUR BORROWING"}
                button={isStaff ? undefined : "New request"}
                onClick={isStaff ? undefined : () => setModal("request")}
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
                  canManage={isStaff}
                />
              </section>
            </>
          )}
          {isStaff && page === "Maintenance" && (
            <>
              <Heading
                title="Maintenance management"
                sub="Record equipment issues and track maintenance progress."
                eyebrow="ASSET CARE"
                button="Report maintenance"
                onClick={() => setModal("maintenance")}
              />
              {maintenanceLoading && (
                <div className="loading">Loading maintenance records…</div>
              )}
              <section className="panel">
                <PanelTitle
                  title="Maintenance records"
                  sub="Status changes are recorded in the system activity log."
                />
                <MaintenanceTable
                  rows={maintenance}
                  onStatus={updateMaintenance}
                />
              </section>
            </>
          )}
          {isStaff && page === "Reports" && (
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
          {page === "Settings" && (
            <>
              <Heading
                title="Settings"
                sub="Adjust how EquipTrack looks on this device."
                eyebrow="PREFERENCES"
              />
              <section className="panel settings-panel">
                <PanelTitle
                  title="Appearance"
                  sub="Choose a theme for the EquipTrack interface."
                />
                <div className="theme-setting">
                  <div className="theme-description">
                    <span className="theme-icon">
                      {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
                    </span>
                    <div>
                      <b>Color theme</b>
                      <small>
                        Your preference is saved in this browser.
                      </small>
                    </div>
                  </div>
                  <div
                    className="theme-options"
                    role="group"
                    aria-label="Color theme"
                  >
                    {(["light", "dark"] as const).map((option) => (
                      <button
                        key={option}
                        className={theme === option ? "selected" : ""}
                        aria-pressed={theme === option}
                        onClick={() => setTheme(option)}
                      >
                        {option === "light" ? (
                          <Sun size={15} />
                        ) : (
                          <Moon size={15} />
                        )}
                        {option === "light" ? "Light" : "Dark"}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              {isSystemAdmin && (
                <>
                  <section className="panel settings-panel">
                    <PanelTitle
                      title="System configuration"
                      sub="Set student registration availability and the default loan period."
                    />
                    <div className="global-settings">
                      <label className="setting-check">
                        <input
                          type="checkbox"
                          checked={systemSettings.studentRegistrationEnabled}
                          onChange={(event) =>
                            setSystemSettings({
                              ...systemSettings,
                              studentRegistrationEnabled: event.target.checked,
                            })
                          }
                        />
                        Allow Authorized Student self-registration
                      </label>
                      <label className="setting-number">
                        Default loan duration (days)
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={systemSettings.defaultLoanDays}
                          onChange={(event) =>
                            setSystemSettings({
                              ...systemSettings,
                              defaultLoanDays: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <button
                        className="primary"
                        disabled={saving}
                        onClick={() => void saveSystemSettings()}
                      >
                        {saving ? "Saving…" : "Save system settings"}
                      </button>
                    </div>
                  </section>
                  <section className="panel settings-panel">
                    <PanelTitle
                      title="User management"
                      sub="Assign roles and approve Authorized Student accounts."
                      action="Add user"
                      click={() => setModal("user")}
                    />
                    {usersLoading ? (
                      <div className="notification-message">Loading users…</div>
                    ) : (
                      <UserTable
                        rows={users}
                        currentUserId={authUser?.id ?? ""}
                        onRole={(id, role) => void updateUser(id, { role })}
                        onApproval={(id, approved) =>
                          void updateUser(id, { approved })
                        }
                        onDelete={(id) => {
                          const user = users.find((row) => row.id === id);
                          if (
                            user &&
                            confirm(
                              `Delete ${user.name}'s account? Historical records will be retained.`,
                            )
                          )
                            void deleteUser(id);
                        }}
                      />
                    )}
                  </section>
                </>
              )}
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
      {modal &&
        ((modal === "request" && !isStaff) ||
          (["equipment", "maintenance"].includes(modal) && isStaff) ||
          (modal === "user" && isSystemAdmin)) && (
        <Modal
          title={
            modal === "request"
              ? "Create borrowing request"
              : modal === "equipment"
                ? "Add equipment"
                : modal === "maintenance"
                  ? "Report maintenance"
                  : "Create user account"
          }
          close={() => setModal(null)}
        >
          {modal === "request" ? (
            <RequestForm
              equipment={equipment}
              user={authUser}
              defaultLoanDays={systemSettings.defaultLoanDays}
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
                ).then((success) => {
                  if (success) setModal(null);
                })
              }
            />
          ) : modal === "equipment" ? (
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
                ).then((success) => {
                  if (success) setModal(null);
                })
              }
            />
          ) : modal === "maintenance" ? (
            <MaintenanceForm
              equipment={equipment}
              saving={saving}
              cancel={() => setModal(null)}
              submit={(data) =>
                void act(
                  () =>
                    api<MaintenanceRecord>("/maintenance", {
                      method: "POST",
                      body: JSON.stringify(data),
                    }),
                  "Maintenance record created.",
                ).then(async (success) => {
                  if (success) {
                    await loadMaintenance();
                    setModal(null);
                  }
                })
              }
            />
          ) : (
            <UserForm
              saving={saving}
              cancel={() => setModal(null)}
              submit={(data) =>
                void act(
                  () =>
                    api<UserRecord>("/users", {
                      method: "POST",
                      body: JSON.stringify(data),
                    }),
                  "User account created.",
                ).then(async (success) => {
                  if (success) {
                    await loadUsers();
                    setModal(null);
                  }
                })
              }
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (session: { token: string; user: AuthUser }) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({
    name: "",
    email: "",
    department: "",
    phone: "",
    password: "",
    role: "faculty_staff" as UserRole,
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<
        | { token: string; user: AuthUser }
        | { pendingApproval: true; message: string }
      >(
        mode === "login" ? "/auth/login" : "/auth/register",
        { method: "POST", body: JSON.stringify(form) },
      );
      if ("pendingApproval" in result) {
        setSuccess(result.message);
        return;
      }
      onAuthenticated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className="authscreen">
      <section className="authpanel">
        <div className="authbrand">
          <span>
            <Package size={22} />
          </span>
          <div>
            <b>EquipTrack</b>
            <small>ASSET MANAGEMENT</small>
          </div>
        </div>
        <p className="autheyebrow">EQUIPMENT SERVICES</p>
        <h1>{mode === "login" ? "Welcome back" : "Borrower account"}</h1>
        <p className="authcopy">
          {mode === "login"
            ? "Sign in to manage equipment and borrowing requests."
            : "Create an account to request equipment and track your loans."}
        </p>
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <label>
                Full name
                <input
                  required
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Department / section
                <input
                  required
                  value={form.department}
                  onChange={(e) =>
                    setForm({ ...form, department: e.target.value })
                  }
                />
              </label>
              <label>
                Account type
                <select
                  value={form.role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role:
                        e.target.value === "authorized_student"
                          ? "authorized_student"
                          : "faculty_staff",
                    })
                  }
                >
                  <option value="faculty_staff">Faculty &amp; Staff</option>
                  <option value="authorized_student">
                    Authorized Student
                  </option>
                </select>
              </label>
            </>
          )}
          <label>
            Email address
            <input
              required
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={mode === "register" ? 10 : undefined}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {error && <p className="autherror">{error}</p>}
          {success && <p className="authsuccess">{success}</p>}
          <button className="primary" disabled={saving}>
            {saving
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create borrower account"}
          </button>
        </form>
        <p className="authswitch">
          {mode === "login" ? "New borrower?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
              setSuccess("");
            }}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
      <div className="authaside">
        <div className="authaside-mark">
          <Package />
        </div>
        <p>ASSETS, ACCOUNTED FOR</p>
        <h2>Equipment access, without the guesswork.</h2>
        <span>
          Browse what is available. Keep every request and return in view.
        </span>
      </div>
    </main>
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
  button?: string;
  onClick?: () => void;
}) {
  return (
    <div className="heading">
      <div>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {button && (
        <button className="primary" onClick={onClick}>
          <Plus size={16} />
          {button}
        </button>
      )}
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
  canManage,
}: {
  rows: RequestItem[];
  onStatus: (id: string, s: string) => void;
  saving: boolean;
  canManage: boolean;
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
            {canManage && <th>Actions</th>}
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
              {canManage && (
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
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const maintenanceTransitions: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  Reported: ["Scheduled", "In Progress", "Cancelled"],
  Scheduled: ["In Progress", "Cancelled"],
  "In Progress": ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};
function MaintenanceTable({
  rows,
  onStatus,
}: {
  rows: MaintenanceRecord[];
  onStatus: (id: string, status: MaintenanceStatus) => void;
}) {
  if (!rows.length) return <Empty text="No maintenance records yet." />;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Equipment</th>
            <th>Issue</th>
            <th>Reported</th>
            <th>Status</th>
            <th>Update status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((record) => (
            <tr key={record.id}>
              <td>
                <b>{record.equipmentName}</b>
                <small>{record.equipmentId}</small>
              </td>
              <td>
                <b>{record.title}</b>
                <small>{record.description || "No description provided."}</small>
                {record.notes && <small>Notes: {record.notes}</small>}
              </td>
              <td>
                <b>{new Date(record.createdAt).toLocaleDateString()}</b>
                <small>By {record.createdBy}</small>
              </td>
              <td>
                <label
                  className={`status ${record.status.toLowerCase().replace(/ /g, "-")}`}
                >
                  {record.status}
                </label>
              </td>
              <td>
                {maintenanceTransitions[record.status].length ? (
                  <select
                    className="maintenance-status-select"
                    value=""
                    aria-label={`Update status for ${record.title}`}
                    onChange={(event) => {
                      if (isMaintenanceStatus(event.target.value))
                        onStatus(record.id, event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      Change to…
                    </option>
                    {maintenanceTransitions[record.status].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="dim">Final</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function UserTable({
  rows,
  currentUserId,
  onRole,
  onApproval,
  onDelete,
}: {
  rows: UserRecord[];
  currentUserId: string;
  onRole: (id: string, role: UserRole) => void;
  onApproval: (id: string, approved: boolean) => void;
  onDelete: (id: string) => void;
}) {
  if (!rows.length) return <Empty text="No user accounts found." />;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Department</th>
            <th>Role</th>
            <th>Access</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((user) => (
            <tr key={user.id}>
              <td>
                <b>{user.name}</b>
                <small>{user.email}</small>
              </td>
              <td>{user.department}</td>
              <td>
                <select
                  className="user-role-select"
                  aria-label={`Role for ${user.name}`}
                  value={user.role}
                  disabled={user.isBootstrapAdmin || user.id === currentUserId}
                  onChange={(event) => {
                    if (isUserRole(event.target.value))
                      onRole(user.id, event.target.value);
                  }}
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <label
                  className={`condition ${user.approved ? "good" : "warn"}`}
                >
                  {user.approved ? "Approved" : "Awaiting approval"}
                </label>
              </td>
              <td>
                {user.role === "authorized_student" && !user.approved && (
                  <button
                    className="approve"
                    onClick={() => onApproval(user.id, true)}
                  >
                    Approve
                  </button>
                )}
                <button
                  className="delete"
                  disabled={user.isBootstrapAdmin || user.id === currentUserId}
                  title={
                    user.isBootstrapAdmin
                      ? "The bootstrap System Admin account cannot be deleted."
                      : user.id === currentUserId
                        ? "You cannot delete your own account."
                        : "Delete account"
                  }
                  aria-label={`Delete account for ${user.name}`}
                  onClick={() => onDelete(user.id)}
                >
                  <Trash2 size={14} /> Delete
                </button>
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
function MaintenanceForm({
  equipment,
  saving,
  cancel,
  submit,
}: {
  equipment: Equipment[];
  saving: boolean;
  cancel: () => void;
  submit: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    equipmentId: equipment[0]?.id || "",
    title: "",
    description: "",
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(form);
      }}
    >
      <div className="formgrid">
        <label className="span2">
          Equipment
          <select
            required
            value={form.equipmentId}
            onChange={(event) =>
              setForm({ ...form, equipmentId: event.target.value })
            }
          >
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.id})
              </option>
            ))}
          </select>
        </label>
        <label className="span2">
          Maintenance title
          <input
            required
            maxLength={160}
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            placeholder="e.g. Projector lamp replacement"
          />
        </label>
        <label className="span2">
          Details
          <textarea
            rows={4}
            maxLength={2000}
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
            placeholder="Describe the issue or planned work."
          />
        </label>
      </div>
      <div className="modalactions">
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={saving || !equipment.length}>
          {saving ? "Saving…" : "Create maintenance record"}
        </button>
      </div>
    </form>
  );
}
function UserForm({
  saving,
  cancel,
  submit,
}: {
  saving: boolean;
  cancel: () => void;
  submit: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState<{
    name: string;
    email: string;
    department: string;
    password: string;
    role: UserRole;
  }>({
    name: "",
    email: "",
    department: "",
    password: "",
    role: "equipment_custodian",
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(form);
      }}
    >
      <div className="formgrid">
        <label>
          Full name
          <input
            required
            value={form.name}
            onChange={(event) =>
              setForm({ ...form, name: event.target.value })
            }
          />
        </label>
        <label>
          Department / section
          <input
            required
            value={form.department}
            onChange={(event) =>
              setForm({ ...form, department: event.target.value })
            }
          />
        </label>
        <label className="span2">
          Email address
          <input
            required
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
          />
        </label>
        <label className="span2">
          Temporary password
          <input
            required
            type="password"
            minLength={10}
            autoComplete="new-password"
            value={form.password}
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
          />
        </label>
        <label className="span2">
          Role
          <select
            value={form.role}
            onChange={(event) => {
              if (isUserRole(event.target.value))
                setForm({ ...form, role: event.target.value });
            }}
          >
            <option value="equipment_custodian">Equipment Custodian</option>
            <option value="system_admin">System Admin</option>
            <option value="faculty_staff">Faculty &amp; Staff</option>
            <option value="authorized_student">Authorized Student</option>
          </select>
        </label>
      </div>
      <div className="modalactions">
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : "Create account"}
        </button>
      </div>
    </form>
  );
}
function RequestForm({
  equipment,
  user,
  defaultLoanDays,
  saving,
  cancel,
  submit,
}: {
  equipment: Equipment[];
  user: AuthUser;
  defaultLoanDays: number;
  saving: boolean;
  cancel: () => void;
  submit: (d: Record<string, unknown>) => void;
}) {
  const [f, S] = useState({
    borrower: isBorrowerRole(user.role) ? user.name : "",
    department: isBorrowerRole(user.role) ? user.department : "",
    borrowerEmail: isBorrowerRole(user.role) ? user.email : "",
    equipmentId: equipment[0]?.id || "",
    quantity: "1",
    purpose: "",
    borrowDate: today(),
    dueDate: addDays(today(), defaultLoanDays),
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
            readOnly={isBorrowerRole(user.role)}
            value={f.borrower}
            onChange={(e) => S({ ...f, borrower: e.target.value })}
            placeholder="e.g. Alex Santos"
          />
        </label>
        <label>
          Department / section
          <input
            required
            readOnly={isBorrowerRole(user.role)}
            value={f.department}
            onChange={(e) => S({ ...f, department: e.target.value })}
            placeholder="e.g. BSIT - 3A"
          />
        </label>
        {!isBorrowerRole(user.role) && (
          <label className="span2">
            Borrower's email address
            <input
              required
              type="email"
              autoComplete="email"
              value={f.borrowerEmail}
              onChange={(e) => S({ ...f, borrowerEmail: e.target.value })}
              placeholder="borrower@example.com"
            />
          </label>
        )}
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
            onChange={(e) =>
              S({
                ...f,
                borrowDate: e.target.value,
                dueDate: addDays(e.target.value, defaultLoanDays),
              })
            }
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
