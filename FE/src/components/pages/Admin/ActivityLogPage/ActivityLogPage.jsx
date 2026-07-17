import { useEffect, useMemo, useState } from "react";
import { getActivityLogs } from "../../../../utils/adminApi";
import "./ActivityLogPage.css";

function LogFilterDropdown({ label, value, options, icon, onChange }) {
  return (
    <details className="activity-log-page__filter-select">
      <summary aria-label={`${label}: ${value}`}>
        <i className={icon} aria-hidden="true" />
        <span>{value}</span>
        <i className="ti-angle-down" aria-hidden="true" />
      </summary>
      <div className="activity-log-page__filter-options" role="listbox" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            role="option"
            aria-selected={value === option}
            className={value === option ? "is-selected" : ""}
            key={option}
            onClick={(event) => {
              onChange(option);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span>{option}</span>
            {value === option && <i className="ti-check" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </details>
  );
}

function getDisplayName(user) {
  return user?.full_name || user?.username || user?.email || "Unknown user";
}

function getInitials(name = "") {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "AL"
  );
}

function getActionType(action = "") {
  const normalizedAction = action.toUpperCase();

  if (
    normalizedAction.includes("DISABLE") ||
    normalizedAction.includes("SECURITY") ||
    normalizedAction.includes("POLICY") ||
    normalizedAction.includes("PERMISSION")
  ) {
    return "security";
  }
  if (
    normalizedAction.includes("DELETE") ||
    normalizedAction.includes("REJECT")
  ) {
    return "danger";
  }
  if (normalizedAction.includes("QUOTA")) return "quota";
  if (
    normalizedAction.includes("CREATE") ||
    normalizedAction.includes("UPLOAD") ||
    normalizedAction.includes("INVITE")
  ) {
    return "create";
  }
  if (
    normalizedAction.includes("DOCUMENT") ||
    normalizedAction.includes("COMMENT")
  ) {
    return "document";
  }
  return "info";
}

function getActionLabel(action = "") {
  return action
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapLog(row) {
  const actorName = getDisplayName(row.actor);
  const createdAt = row.created_at ? new Date(row.created_at) : null;
  const entityType = row.entity_type || "System";
  const normalizedEntityType = entityType.toLowerCase();
  const entityId = row.entity_id || "N/A";
  const action = row.action_type || "UNKNOWN_ACTION";

  const isDocument = normalizedEntityType.includes("document");
  const isWorkspace = normalizedEntityType.includes("workspace");
  const isLibrary = normalizedEntityType.includes("library");

  return {
    id: row.id || `LOG-${entityId}`,
    user: row.actor?.email || row.actor?.username || row.user_id || "unknown",
    userName: actorName,
    avatar: getInitials(actorName),
    action,
    actionLabel: getActionLabel(action),
    actionType: getActionType(action),
    document: isDocument ? entityId : "N/A",
    documentId: isDocument ? entityId : "N/A",
    workspace: isWorkspace || isLibrary ? entityId : entityType,
    workspaceId: isWorkspace || isLibrary ? entityId : "SYS",
    entityType,
    ipAddress: row.ip_address || "N/A",
    device: row.device || "Backend API",
    date: createdAt ? createdAt.toISOString().slice(0, 10) : "",
    time: createdAt ? createdAt.toLocaleTimeString() : "",
    result: row.risk_level || "Info",
    details:
      row.details ||
      `${getActionLabel(action)} on ${entityType} ${entityId}.`,
  };
}

function formatDate(dateString) {
  if (!dateString) return "No date";
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getEventIcon(type) {
  return (
    {
      create: "ti-upload",
      info: "ti-info",
      document: "ti-file",
      danger: "ti-trash",
      security: "ti-shield",
      quota: "ti-reload",
    }[type] || "ti-info"
  );
}

function ActivityLogPage() {
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [userFilter, setUserFilter] = useState("All users");
  const [actionFilter, setActionFilter] = useState("All actions");
  const [workspaceFilter, setWorkspaceFilter] = useState("All scopes");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedLog, setSelectedLog] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    // Resetting pagination is intentional whenever the filter result set changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1);
  }, [searchTerm, userFilter, actionFilter, workspaceFilter, startDate, endDate]);

  useEffect(() => {
    async function loadLogs() {
      try {
        setIsLoading(true);
        setError("");
        const data = await getActivityLogs();
        const mappedLogs = (data || []).map(mapLog);

        setLogs(mappedLogs);
        setSelectedLog(mappedLogs[0] || null);
      } catch (err) {
        setError(
          err.response?.data?.message || "Could not load activity logs.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadLogs();
  }, []);

  const actionFilters = useMemo(
    () => ["All actions", ...new Set(logs.map((log) => log.action))],
    [logs],
  );

  const uniqueUsers = useMemo(
    () => ["All users", ...new Set(logs.map((log) => log.user))],
    [logs],
  );

  const uniqueWorkspaces = useMemo(
    () => ["All scopes", ...new Set(logs.map((log) => log.workspace))],
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return logs.filter((log) => {
      const matchesKeyword =
        !keyword ||
        [
          log.id,
          log.user,
          log.userName,
          log.action,
          log.actionLabel,
          log.document,
          log.documentId,
          log.workspace,
          log.workspaceId,
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const matchesUser =
        userFilter === "All users" || log.user === userFilter;
      const matchesAction =
        actionFilter === "All actions" || log.action === actionFilter;
      const matchesWorkspace =
        workspaceFilter === "All scopes" ||
        log.workspace === workspaceFilter;

      const logDate = log.date ? new Date(`${log.date}T00:00:00`) : null;
      const fromDate = startDate ? new Date(`${startDate}T00:00:00`) : null;
      const toDate = endDate ? new Date(`${endDate}T23:59:59`) : null;
      const matchesDate =
        (!fromDate || !logDate || logDate >= fromDate) &&
        (!toDate || !logDate || logDate <= toDate);

      return (
        matchesKeyword &&
        matchesUser &&
        matchesAction &&
        matchesWorkspace &&
        matchesDate
      );
    });
  }, [
    logs,
    searchTerm,
    userFilter,
    actionFilter,
    workspaceFilter,
    startDate,
    endDate,
  ]);

  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE) || 1;
  const paginatedLogs = useMemo(() => {
    return filteredLogs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  }, [filteredLogs, currentPage]);

  const stats = useMemo(
    () => ({
      total: filteredLogs.length,
      security: filteredLogs.filter((log) =>
        ["security", "danger"].includes(log.actionType),
      ).length,
      document: filteredLogs.filter((log) =>
        log.entityType.toLowerCase().includes("document"),
      ).length,
      workspace: new Set(filteredLogs.map((log) => log.workspace)).size,
    }),
    [filteredLogs],
  );

  function resetFilters() {
    setSearchTerm("");
    setUserFilter("All users");
    setActionFilter("All actions");
    setWorkspaceFilter("All scopes");
    setStartDate("");
    setEndDate("");
    setNotice("Filters reset.");
  }

  function exportCsv() {
    const rows = [
      ["Log ID", "User", "Action", "Resource", "Scope", "Date", "Time", "Risk"],
      ...filteredLogs.map((log) => [
        log.id,
        log.user,
        log.action,
        log.document,
        log.workspace,
        log.date,
        log.time,
        log.result,
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
    link.download = "activity-log.csv";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Activity log exported.");
  }

  async function copyEventId() {
    if (!selectedLog) return;
    await navigator.clipboard.writeText(String(selectedLog.id));
    setNotice(`${selectedLog.id} copied.`);
  }

  const statCards = [
    ["Total events", stats.total, "All recorded events", "ti-list", "neutral"],
    [
      "Security events",
      stats.security,
      "Policy and security actions",
      "ti-shield",
      "danger",
    ],
    [
      "Document actions",
      stats.document,
      "Uploads, edits and deletes",
      "ti-file",
      "orange",
    ],
    [
      "Active scopes",
      stats.workspace,
      "Workspaces and libraries",
      "ti-user",
      "green",
    ],
  ];

  return (
    <section className="activity-log-page">
      <main className="activity-log-page__content">
        <header className="activity-log-page__page-header">
          <div>
            <span>Admin audit trail</span>
            <h1>Activity logs</h1>
            <p>Trace system events, user actions and security changes.</p>
          </div>
          <div className="activity-log-page__header-actions">
            <button type="button" onClick={resetFilters}>
              <i className="ti-reload" /> Reset filters
            </button>
            <button type="button" onClick={exportCsv}>
              <i className="ti-download" /> Export CSV
            </button>
          </div>
        </header>

        {isLoading && (
          <div className="activity-log-page__notice">
            Loading activity logs...
          </div>
        )}
        {error && <div className="activity-log-page__notice">{error}</div>}
        {notice && (
          <div className="activity-log-page__notice" role="status">
            <i className="ti-check" />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}

        <section className="activity-log-page__stats-grid">
          {statCards.map(([label, value, note, icon, tone]) => (
            <article key={label}>
              <span className={`activity-log-page__stat-icon is-${tone}`}>
                <i className={icon} />
              </span>
              <div>
                <span>{label}</span>
                <strong>{value}</strong>
                <p>{note}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="activity-log-page__workspace">
          <div className="activity-log-page__main-column">
            <section className="activity-log-page__filter-bar">
              <label className="activity-log-page__search">
                <i className="ti-search" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search logs..."
                />
              </label>

              <LogFilterDropdown
                label="Filter by user"
                value={userFilter}
                options={uniqueUsers}
                icon="ti-user"
                onChange={setUserFilter}
              />

              <LogFilterDropdown
                label="Filter by action"
                value={actionFilter}
                options={actionFilters}
                icon="ti-bolt"
                onChange={setActionFilter}
              />

              <LogFilterDropdown
                label="Filter by scope"
                value={workspaceFilter}
                options={uniqueWorkspaces}
                icon="ti-layers"
                onChange={setWorkspaceFilter}
              />

              <div className="activity-log-page__date-range">
                <label>
                  <span>From</span>
                  <span className="activity-log-page__date-input">
                    <i className="ti-calendar" />
                    <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                  </span>
                </label>
                <i className="ti-arrow-right" aria-hidden="true" />
                <label>
                  <span>To</span>
                  <span className="activity-log-page__date-input">
                    <i className="ti-calendar" />
                    <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                  </span>
                </label>
              </div>
            </section>

            <section className="activity-log-page__table-card">
              <header>
                <h2>Audit records</h2>
              </header>
              <div className="activity-log-page__table-wrapper">
                <table className="activity-log-page__table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Actor</th>
                      <th>Resource</th>
                      <th>Scope</th>
                      <th>Timestamp</th>
                      <th>Risk</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLogs.map((log) => (
                      <tr
                        key={log.id}
                        className={
                          selectedLog?.id === log.id ? "is-selected" : ""
                        }
                        onClick={() => setSelectedLog(log)}
                      >
                        <td>
                          <div className="activity-log-page__event">
                            <span className={`is-${log.actionType}`}>
                              <i className={getEventIcon(log.actionType)} />
                            </span>
                            <div>
                              <strong>{log.actionLabel}</strong>
                              <small>{log.id}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="activity-log-page__actor">
                            <span>{log.avatar}</span>
                            <div>
                              <strong>{log.userName}</strong>
                              <small>{log.user}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="activity-log-page__entity">
                            <strong>{log.document}</strong>
                            <small>{log.documentId}</small>
                          </div>
                        </td>
                        <td>
                          <div className="activity-log-page__entity">
                            <strong>{log.workspace}</strong>
                            <small>{log.workspaceId}</small>
                          </div>
                        </td>
                        <td>
                          <div className="activity-log-page__entity">
                            <strong>{formatDate(log.date)}</strong>
                            <small>{log.time}</small>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`activity-log-page__risk is-${String(
                              log.result,
                            ).toLowerCase()}`}
                          >
                            {log.result}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="activity-log-page__more"
                            aria-label={`View ${log.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedLog(log);
                            }}
                          >
                            <i className="ti-more-alt" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredLogs.length === 0 ? (
                <div className="activity-log-page__empty">
                  <i className="ti-search" />
                  <h3>No logs match these filters</h3>
                  <p>Adjust the filters or reset the form.</p>
                </div>
              ) : (
                <footer className="activity-log-page__table-footer">
                  <span>
                    Showing {filteredLogs.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–
                    {Math.min(currentPage * PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length} events
                  </span>
                  <div>
                    <button
                      type="button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      <i className="ti-angle-left" />
                    </button>
                    <span className="activity-log-page__page-info" style={{ margin: '0 8px', fontSize: '13px' }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <i className="ti-angle-right" />
                    </button>
                  </div>
                </footer>
              )}
            </section>
          </div>

          <aside className="activity-log-page__details-panel">
            {selectedLog ? (
              <>
                <div className="activity-log-page__details-title">
                  <h2>Event details</h2>
                  <button
                    type="button"
                    onClick={() => setSelectedLog(null)}
                    aria-label="Close details"
                  >
                    <i className="ti-close" />
                  </button>
                </div>

                <div className="activity-log-page__event-summary">
                  <span className={`is-${selectedLog.actionType}`}>
                    <i className={getEventIcon(selectedLog.actionType)} />
                  </span>
                  <div>
                    <h3>{selectedLog.actionLabel}</h3>
                    <p>{selectedLog.id}</p>
                  </div>
                </div>

                <dl className="activity-log-page__metadata">
                  <div>
                    <dt>
                      <i className="ti-user" /> Actor
                    </dt>
                    <dd>
                      <strong>{selectedLog.userName}</strong>
                      <span>{selectedLog.user}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <i className="ti-file" /> Resource
                    </dt>
                    <dd>{selectedLog.document}</dd>
                  </div>
                  <div>
                    <dt>
                      <i className="ti-location-pin" /> Scope
                    </dt>
                    <dd>{selectedLog.workspace}</dd>
                  </div>
                  <div>
                    <dt>
                      <i className="ti-desktop" /> Device
                    </dt>
                    <dd>{selectedLog.device}</dd>
                  </div>
                  <div>
                    <dt>
                      <i className="ti-world" /> IP address
                    </dt>
                    <dd>{selectedLog.ipAddress}</dd>
                  </div>
                  <div>
                    <dt>
                      <i className="ti-time" /> Timestamp
                    </dt>
                    <dd>
                      {formatDate(selectedLog.date)} {selectedLog.time}
                    </dd>
                  </div>
                </dl>

                <section className="activity-log-page__description">
                  <h3>Description</h3>
                  <p>{selectedLog.details}</p>
                </section>

                <div className="activity-log-page__detail-actions">
                  <button type="button" onClick={copyEventId}>
                    <i className="ti-layers" /> Copy event ID
                  </button>
                </div>
              </>
            ) : (
              <div className="activity-log-page__empty compact">
                <i className="ti-layout-list-thumb" />
                <h3>Select an event</h3>
                <p>Choose an audit record to inspect its metadata.</p>
              </div>
            )}
          </aside>
        </section>
      </main>
    </section>
  );
}

export default ActivityLogPage;
