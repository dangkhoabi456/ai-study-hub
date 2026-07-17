import { useEffect, useMemo, useState } from "react";
import {
  getAdminUsers,
  updateUserRole,
  updateUserStatus,
} from "../../../../utils/adminApi";
import { getStoredUser } from "../../../../utils/authToken";
import "./UserManagementPage.css";

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatStorage(used, quota) {
  return `${formatBytes(used)} / ${formatBytes(quota)}`;
}

function getStoragePercent(user) {
  if (!user.quota) return 0;
  return Math.min(100, Math.round((user.storageUsed / user.quota) * 100));
}

function getInitials(name = "") {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "US"
  );
}

function formatDate(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function mapUser(row) {
  const name = row.full_name || row.username || row.email || "Unknown user";
  const status = row.status === "DISABLED" ? "Disabled" : "Active";

  return {
    id: row.id,
    name,
    email: row.email || "",
    role: row.role || "USER",
    status,
    storageUsed: Number(row.storage_used_bytes || 0),
    quota: Number(row.storage_quota_bytes || 50 * 1024 * 1024),
    lastActive: formatDate(row.last_login_at || row.updated_at),
    memberSince: formatDate(row.created_at),
    workspaceAccess: Number(row.workspace_count || 0),
    libraryAccess: Number(row.library_count || 0),
    avatarText: getInitials(name),
    department: row.username ? `@${row.username}` : "No username",
    raw: row,
  };
}

function UserAvatar({ user, large = false }) {
  return user.avatar ? (
    <img
      className={large ? "is-large" : ""}
      src={user.avatar}
      alt={user.name}
    />
  ) : (
    <span className={large ? "is-large" : ""}>{user.avatarText}</span>
  );
}

function DirectoryDropdown({ label, value, options, icon, onChange }) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label || label;

  return (
    <details className="user-management-page__directory-select">
      <summary aria-label={`${label}: ${selectedLabel}`}>
        <i className={icon} aria-hidden="true" />
        <span>{selectedLabel}</span>
        <i className="ti-angle-down" aria-hidden="true" />
      </summary>
      <div className="user-management-page__directory-options" role="listbox" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            role="option"
            aria-selected={value === option.value}
            className={value === option.value ? "is-selected" : ""}
            key={option.value}
            onClick={(event) => {
              onChange(option.value);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span>{option.label}</span>
            {value === option.value && <i className="ti-check" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </details>
  );
}

function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState("last-active");
  const [currentPage, setCurrentPage] = useState(1);
  const [roleDraft, setRoleDraft] = useState("USER");
  const currentAdminId = getStoredUser()?.id;

  useEffect(() => {
    async function loadUsers() {
      try {
        setIsLoading(true);
        setError("");
        const data = await getAdminUsers();
        const mappedUsers = (data || []).map(mapUser);
        setUsers(mappedUsers);
        setSelectedUserId(mappedUsers[0]?.id || null);
      } catch (err) {
        setError(err.response?.data?.message || "Could not load users.");
      } finally {
        setIsLoading(false);
      }
    }

    loadUsers();
  }, []);

  useEffect(() => {
    // Resetting pagination is intentional whenever the filter or sort changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1);
  }, [query, statusFilter, roleFilter, sortBy]);

  const filteredUsers = useMemo(() => {
    const matched = users.filter((user) => {
      const text =
        `${user.name} ${user.email} ${user.role} ${user.department}`.toLowerCase();
      const matchesSearch = text.includes(query.trim().toLowerCase());
      const matchesStatus =
        statusFilter === "all" || user.status.toLowerCase() === statusFilter;
      const matchesRole =
        roleFilter === "all" || user.role.toLowerCase() === roleFilter;

      return matchesSearch && matchesStatus && matchesRole;
    });

    return [...matched].sort((a, b) => {
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "storage") {
        return b.storageUsed - a.storageUsed;
      }
      const timeA = new Date(a.raw?.last_login_at || a.raw?.updated_at || 0).getTime();
      const timeB = new Date(b.raw?.last_login_at || b.raw?.updated_at || 0).getTime();
      return timeB - timeA;
    });
  }, [users, query, statusFilter, roleFilter, sortBy]);

  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE) || 1;
  const paginatedUsers = useMemo(() => {
    return filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  }, [filteredUsers, currentPage]);

  const selectedUser =
    users.find((user) => user.id === selectedUserId) || null;

  useEffect(() => {
    if (selectedUser) {
      // Keep the editor aligned with the newly selected directory row.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoleDraft(selectedUser.role);
    }
  }, [selectedUser]);

  const stats = useMemo(() => {
    const active = users.filter((user) => user.status === "Active").length;
    const disabled = users.filter((user) => user.status === "Disabled").length;
    const highStorage = users.filter(
      (user) => getStoragePercent(user) >= 80
    ).length;

    return {
      active,
      disabled,
      highStorage,
      totalUsers: users.length,
    };
  }, [users]);

  function openConfirmation(type, user) {
    setConfirmAction({ type, user });
  }

  function closeConfirmation() {
    setConfirmAction(null);
  }

  async function applyConfirmedAction() {
    if (!confirmAction) return;

    const { type, user } = confirmAction;

    const nextBackendStatus = type === "disable" ? "DISABLED" : "ACTIVE";

    try {
      const updated = await updateUserStatus(
        user.id,
        nextBackendStatus,
        `${type} from admin user management page.`,
      );

      setUsers((currentUsers) =>
        currentUsers.map((item) =>
          item.id === user.id ? mapUser({ ...item.raw, ...updated }) : item,
        ),
      );

      const actionText = type === "disable" ? "disabled" : "reactivated";
      setNotice(`${user.name} has been ${actionText}.`);
      closeConfirmation();
    } catch (err) {
      setNotice(err.response?.data?.message || "Could not update user status.");
    }
  }

  async function saveRole() {
    if (!selectedUser || roleDraft === selectedUser.role) return;

    try {
      const updated = await updateUserRole(
        selectedUser.id,
        roleDraft,
        "Role changed from admin user management page.",
      );
      setUsers((currentUsers) =>
        currentUsers.map((item) =>
          item.id === selectedUser.id
            ? mapUser({ ...item.raw, ...updated })
            : item,
        ),
      );
      setNotice(`${selectedUser.name}'s role is now ${roleDraft}.`);
    } catch (err) {
      setNotice(err.response?.data?.message || "Could not update user role.");
      setRoleDraft(selectedUser.role);
    }
  }

  function exportUsersCsv() {
    const rows = [
      ["Name", "Email", "Role", "Status", "Storage used", "Quota", "Workspaces", "Libraries"],
      ...filteredUsers.map((user) => [
        user.name,
        user.email,
        user.role,
        user.status,
        user.storageUsed,
        user.quota,
        user.workspaceAccess,
        user.libraryAccess,
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "admin-users.csv";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("User list exported.");
  }

  const confirmationContent = {
    disable: {
      title: "Disable user account?",
      message:
        "This user will lose access to libraries, workspaces, and collaboration features until reactivated.",
      button: "Disable account",
    },
    reactivate: {
      title: "Reactivate user account?",
      message:
        "This user will be able to sign in and continue using shared study resources.",
      button: "Reactivate account",
    },
  };

  const statCards = [
    {
      label: "Total users",
      value: stats.totalUsers,
      note: "All registered accounts",
      icon: "ti-user",
      tone: "neutral",
    },
    {
      label: "Active",
      value: stats.active,
      note: "Currently active",
      icon: "ti-check",
      tone: "success",
    },
    {
      label: "Disabled",
      value: stats.disabled,
      note: "Disabled accounts",
      icon: "ti-close",
      tone: "danger",
    },
    {
      label: "Storage alerts",
      value: stats.highStorage,
      note: "Above 80% quota",
      icon: "ti-alert",
      tone: "warning",
    },
  ];

  return (
    <section className="user-management-page">
      <main className="user-management-page__shell">
        <header className="user-management-page__page-header">
          <div>
            <span>User administration</span>
            <h1>Users</h1>
            <p>Manage accounts, access, roles and storage.</p>
          </div>

          <div className="user-management-page__header-actions">
            <button type="button" aria-label="Export users" onClick={exportUsersCsv}>
              <i className="ti-download"></i>
              <span>Export CSV</span>
            </button>
          </div>
        </header>

        {isLoading && (
          <div className="user-management-page__notice">Loading users...</div>
        )}
        {error && <div className="user-management-page__notice">{error}</div>}
        {notice && (
          <div className="user-management-page__notice" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}

        <section
          className="user-management-page__stats-grid"
          aria-label="User statistics"
        >
          {statCards.map((stat) => (
            <article key={stat.label}>
              <span
                className={`user-management-page__stat-icon is-${stat.tone}`}
              >
                <i className={stat.icon}></i>
              </span>
              <div>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
                <p>{stat.note}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="user-management-page__workspace">
          <section className="user-management-page__board">
            <div className="user-management-page__board-title">
              <h2>User directory</h2>
            </div>

            <div className="user-management-page__toolbar">
              <label className="user-management-page__search-box">
              <i className="ti-search"></i>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search users..."
              />
              </label>

              <div className="user-management-page__filter-row">
                {[
                  ["all", "All"],
                  ["active", "Active"],
                  ["disabled", "Disabled"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={statusFilter === value ? "active" : ""}
                    onClick={() => setStatusFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <DirectoryDropdown
                label="Role"
                value={roleFilter}
                icon="ti-id-badge"
                options={[
                  { value: "all", label: "All roles" },
                  { value: "user", label: "User" },
                  { value: "system_admin", label: "System admin" },
                ]}
                onChange={setRoleFilter}
              />

              <DirectoryDropdown
                label="Sort users"
                value={sortBy}
                icon="ti-exchange-vertical"
                options={[
                  { value: "last-active", label: "Sort: Last active" },
                  { value: "name", label: "Sort: Name" },
                  { value: "storage", label: "Sort: Storage" },
                ]}
                onChange={setSortBy}
              />
            </div>

          <div className="user-management-page__table-wrap">
            <table className="user-management-page__table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Storage</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((user) => {
                  const storagePercent = getStoragePercent(user);
                  return (
                      <tr
                        key={user.id}
                        className={
                          selectedUserId === user.id ? "is-selected" : ""
                        }
                        onClick={() => setSelectedUserId(user.id)}
                      >
                      <td>
                        <div className="user-management-page__identity">
                            <UserAvatar user={user} />
                          <div>
                            <strong>{user.name}</strong>
                            <p>{user.email}</p>
                            <small>{user.department}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                          <span className="user-management-page__role">
                            {user.role}
                          </span>
                      </td>
                      <td>
                          <span
                            className={`user-management-page__status user-management-page__status--${user.status.toLowerCase()}`}
                          >
                          {user.status}
                        </span>
                      </td>
                      <td>
                        <div className="user-management-page__quota">
                            <strong>{storagePercent}%</strong>
                            <div className="user-management-page__quota-bar">
                              <span
                                className={
                                  storagePercent >= 80 ? "danger" : ""
                                }
                                style={{ width: `${storagePercent}%` }}
                              ></span>
                            </div>
                            <small>
                              {formatStorage(user.storageUsed, user.quota)}
                            </small>
                          </div>
                        </td>
                        <td>{user.lastActive}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="user-management-page__empty">
                <i className="ti-user"></i>
                <h3>No users found</h3>
                <p>Try another keyword or clear the current filter.</p>
              </div>
            ) : (
              <footer className="user-management-page__table-footer">
                <span>
                  Showing {filteredUsers.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–
                  {Math.min(currentPage * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length} users
                </span>
                <div>
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <i className="ti-angle-left"></i>
                  </button>
                  <span className="user-management-page__page-info" style={{ margin: '0 8px', fontSize: '13px' }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <i className="ti-angle-right"></i>
                  </button>
                </div>
              </footer>
            )}
          </section>

          <aside className="user-management-page__detail-panel">
            {selectedUser ? (
              <>
                <div className="user-management-page__detail-heading">
                  <h2>User details</h2>
                  <button
                    type="button"
                    aria-label="Close user details"
                    onClick={() => setSelectedUserId(null)}
                  >
                    <i className="ti-close"></i>
                  </button>
                </div>

                <div className="user-management-page__profile">
                  <UserAvatar user={selectedUser} large />
                  <div>
                    <h3>{selectedUser.name}</h3>
                    <p>{selectedUser.email}</p>
                    <span>{selectedUser.department}</span>
                  </div>
                </div>

                <dl className="user-management-page__details-list">
                  <div>
                    <dt>Role</dt>
                    <dd>
                      <span className="user-management-page__role">
                        {selectedUser.role}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={`user-management-page__status user-management-page__status--${selectedUser.status.toLowerCase()}`}
                      >
                        {selectedUser.status}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Member since</dt>
                    <dd>{selectedUser.memberSince}</dd>
                  </div>
                  <div>
                    <dt>Last active</dt>
                    <dd>{selectedUser.lastActive}</dd>
                  </div>
                </dl>

                <section className="user-management-page__role-editor">
                  <h3>System role</h3>
                  <p>Controls access to platform administration features.</p>
                  <div>
                    <details
                      className="user-management-page__role-select"
                      onToggle={(event) => {
                        if (selectedUser.id === currentAdminId) {
                          event.currentTarget.removeAttribute("open");
                        }
                      }}
                    >
                      <summary
                        aria-label="Select system role"
                        aria-disabled={selectedUser.id === currentAdminId}
                      >
                        <span>{roleDraft === "SYSTEM_ADMIN" ? "System Admin" : "User"}</span>
                        <i className="ti-angle-down" aria-hidden="true" />
                      </summary>
                      <div className="user-management-page__role-options">
                        {[
                          { value: "USER", label: "User", description: "Standard workspace access" },
                          { value: "SYSTEM_ADMIN", label: "System Admin", description: "Full administration access" },
                        ].map((role) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={roleDraft === role.value}
                            className={roleDraft === role.value ? "is-selected" : ""}
                            key={role.value}
                            onClick={(event) => {
                              setRoleDraft(role.value);
                              event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                          >
                            <span><strong>{role.label}</strong><small>{role.description}</small></span>
                            {roleDraft === role.value && <i className="ti-check" aria-hidden="true" />}
                          </button>
                        ))}
                      </div>
                    </details>
                    <button
                      type="button"
                      className="user-management-page__save-role"
                      disabled={
                        selectedUser.id === currentAdminId ||
                        roleDraft === selectedUser.role
                      }
                      onClick={saveRole}
                    >
                      Save role
                    </button>
                  </div>
                  {selectedUser.id === currentAdminId && (
                    <small>You cannot change your own system role.</small>
                  )}
                </section>

                <section className="user-management-page__detail-storage">
                  <h3>Storage usage</h3>
                  <div>
                    <strong>{getStoragePercent(selectedUser)}%</strong>
                    <span>
                      {formatStorage(
                        selectedUser.storageUsed,
                        selectedUser.quota
                      )}
                    </span>
                  </div>
                  <div className="user-management-page__quota-bar">
                    <span
                      className={
                        getStoragePercent(selectedUser) >= 80 ? "danger" : ""
                      }
                      style={{
                        width: `${getStoragePercent(selectedUser)}%`,
                      }}
                    ></span>
                  </div>
                  <p>
                    {formatBytes(
                      Math.max(0, selectedUser.quota - selectedUser.storageUsed)
                    )}{" "}
                    remaining
                  </p>
                </section>

                <dl className="user-management-page__access-list">
                  <div>
                    <dt>Storage quota</dt>
                    <dd>{formatBytes(selectedUser.quota)}</dd>
                  </div>
                  <div>
                    <dt>Workspace access</dt>
                    <dd>{selectedUser.workspaceAccess} workspaces</dd>
                  </div>
                  <div>
                    <dt>Libraries access</dt>
                    <dd>{selectedUser.libraryAccess} libraries</dd>
                  </div>
                </dl>

                <div className="user-management-page__detail-actions">
                  <button
                    type="button"
                    className={
                      selectedUser.status === "Disabled"
                        ? "reactivate"
                        : "disable"
                    }
                    onClick={() =>
                      openConfirmation(
                        selectedUser.status === "Disabled"
                          ? "reactivate"
                          : "disable",
                        selectedUser
                      )
                    }
                    disabled={selectedUser.id === currentAdminId}
                  >
                    <i
                      className={
                        selectedUser.status === "Disabled"
                          ? "ti-check"
                          : "ti-user"
                      }
                    ></i>
                    {selectedUser.status === "Disabled"
                      ? "Reactivate account"
                      : selectedUser.id === currentAdminId
                        ? "Cannot disable your own account"
                        : "Disable account"}
                  </button>
                </div>
              </>
            ) : (
              <div className="user-management-page__detail-empty">
                <i className="ti-user"></i>
                <h2>Select a user</h2>
                <p>Choose a row to review account and storage details.</p>
              </div>
            )}
          </aside>
        </section>
      </main>


      {confirmAction && (
        <div
          className="user-management-page__modal-overlay"
          role="dialog"
          aria-modal="true"
        >
          <div className="user-management-page__confirm-modal">
            <div className="user-management-page__confirm-icon">
              <i className="ti-alert"></i>
            </div>
            <h2>{confirmationContent[confirmAction.type].title}</h2>
            <p>{confirmationContent[confirmAction.type].message}</p>
            <div className="user-management-page__confirm-user">
              <strong>{confirmAction.user.name}</strong>
              <span>{confirmAction.user.email}</span>
            </div>
            <div className="user-management-page__confirm-actions">
              <button type="button" onClick={closeConfirmation}>
                Cancel
              </button>
              <button type="button" onClick={applyConfirmedAction}>
                {confirmationContent[confirmAction.type].button}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default UserManagementPage;
