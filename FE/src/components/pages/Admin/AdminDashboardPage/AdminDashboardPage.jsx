import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Chart from "react-apexcharts";
import {
  getActivityLogs,
  getAdminDashboard,
  getAdminUsers,
  getModerationDocuments,
  getUsageStats,
  reviewDocument,
} from "../../../../utils/adminApi";
import "./AdminDashboardPage.css";

const STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
const AI_TOKEN_LIMIT = 120000;

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "AD";
}

function getDisplayName(user) {
  return repairTextEncoding(
    user?.full_name || user?.username || user?.email || "Unknown user",
  );
}

function repairTextEncoding(value) {
  const text = String(value || "");

  if (!/[ÃÂáºá»]/.test(text)) {
    return text;
  }

  try {
    const bytes = Uint8Array.from(
      Array.from(text).map((character) => character.charCodeAt(0)),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

function getLogTime(value) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString();
}

function getDocumentReason(document) {
  const reason = document.ai_reject_reason;
  if (!reason) return "Document needs admin review.";
  if (typeof reason === "string") return repairTextEncoding(reason);
  return repairTextEncoding(
    reason.reason || reason.error || "Document needs admin review.",
  );
}

function getQueueSeverity(status) {
  if (status === "FLAGGED" || status === "REJECTED") return "critical";
  return "warning";
}

function getUsagePercent(value, limit) {
  if (!limit) return 0;
  return Math.min(Math.round((Number(value || 0) / limit) * 100), 100);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatUsageDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(`${value}T00:00:00`),
  );
}

const CHART_COLORS = {
  orange: "#c05a25",
  gold: "#e2a72e",
  teal: "#287f7a",
  olive: "#63744d",
  muted: "#b6aa99",
  red: "#a92d25",
};

function getBaseChartOptions(categories = []) {
  return {
    chart: {
      background: "transparent",
      fontFamily: 'Arial, "Segoe UI", sans-serif',
      toolbar: { show: false },
      animations: { speed: 500 },
    },
    colors: [CHART_COLORS.orange, CHART_COLORS.teal],
    dataLabels: { enabled: false },
    grid: { borderColor: "rgba(113, 103, 91, 0.18)", strokeDashArray: 3 },
    legend: {
      position: "top",
      horizontalAlign: "left",
      fontSize: "11px",
      labels: { colors: "#71675b" },
      markers: { size: 5 },
    },
    stroke: { curve: "smooth", width: 3 },
    tooltip: { theme: "light" },
    xaxis: {
      categories,
      labels: { style: { colors: "#71675b", fontSize: "10px" } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { colors: "#71675b", fontSize: "10px" } } },
  };
}

function AdminDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [queue, setQueue] = useState([]);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [usage, setUsage] = useState({ quotaUsage: [], aiUsage: [] });
  const [selectedLog, setSelectedLog] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");

  async function loadDashboard() {
    try {
      setIsLoading(true);
      setError("");

      const [dashboardData, moderationData, userData, logData, usageData] =
        await Promise.all([
          getAdminDashboard(),
          getModerationDocuments(),
          getAdminUsers(),
          getActivityLogs(),
          getUsageStats(),
        ]);

      setStats(dashboardData);
      setQueue(moderationData || []);
      setUsers(userData || []);
      setLogs(logData || []);
      setSelectedLog((logData || [])[0] || null);
      setUsage({
        quotaUsage: usageData?.quotaUsage || [],
        aiUsage: usageData?.aiUsage || [],
      });
      setLastUpdatedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err.response?.data?.message || "Could not load admin dashboard.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Initial dashboard hydration is an intentional mount-time side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard();
  }, []);

  const visibleLogs = logs.slice(0, 5);

  const quotaRows = useMemo(
    () =>
      usage.quotaUsage
        .map((row) => {
          const used = Number(row.bytes_uploaded || 0) + Number(row.bytes_downloaded || 0);
          return {
            id: row.id,
            owner: getDisplayName(row.user),
            used,
            percent: getUsagePercent(used, STORAGE_LIMIT_BYTES),
          };
        })
        .sort((a, b) => b.used - a.used)
        .slice(0, 3),
    [usage.quotaUsage],
  );
  const aiRows = useMemo(
    () =>
      usage.aiUsage
        .map((row) => {
          const tokens = Number(row.tokens_consumed || 0);
          const percent = getUsagePercent(tokens, AI_TOKEN_LIMIT);
          return {
            id: row.id,
            owner: getDisplayName(row.user),
            tokens,
            requests: Number(row.chat_count || 0),
            risk: percent >= 100 ? "critical" : percent >= 80 ? "warning" : "normal",
          };
        })
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 3),
    [usage.aiUsage],
  );

  const activeUsers = users.filter((user) => user.status === "ACTIVE").length;
  const moderationQueueCount = queue.length;
  const avgQuotaUsage =
    quotaRows.length === 0
      ? 0
      : Math.round(quotaRows.reduce((sum, item) => sum + item.percent, 0) / quotaRows.length);
  const aiCriticalUsers = aiRows.filter((item) => item.risk === "critical").length;
  const totalAiTokens = stats?.totalTokensToday || 0;
  const criticalModerationCount = queue.filter(
    (item) => getQueueSeverity(item.status) === "critical",
  ).length;
  const attentionCount = moderationQueueCount + aiCriticalUsers;

  const usageTimeline = useMemo(() => {
    const byDate = new Map();
    const ensureDate = (date) => {
      if (!byDate.has(date)) byDate.set(date, { uploaded: 0, downloaded: 0, tokens: 0, chats: 0 });
      return byDate.get(date);
    };

    usage.quotaUsage.forEach((row) => {
      const point = ensureDate(row.usage_date);
      point.uploaded += Number(row.bytes_uploaded || 0) / 1024 / 1024;
      point.downloaded += Number(row.bytes_downloaded || 0) / 1024 / 1024;
    });
    usage.aiUsage.forEach((row) => {
      const point = ensureDate(row.usage_date);
      point.tokens += Number(row.tokens_consumed || 0);
      point.chats += Number(row.chat_count || 0);
    });

    return [...byDate.entries()]
      .filter(([date]) => date)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-7)
      .map(([date, values]) => ({ date: formatUsageDate(date), ...values }));
  }, [usage]);

  const chartData = useMemo(() => {
    const dates = usageTimeline.map((point) => point.date);
    const base = getBaseChartOptions(dates);
    const disabledUsers = Math.max(users.length - activeUsers, 0);

    return {
      storage: {
        options: {
          ...base,
          chart: { ...base.chart, type: "bar" },
          colors: [CHART_COLORS.gold, CHART_COLORS.orange],
          plotOptions: { bar: { columnWidth: "48%", borderRadius: 3 } },
          legend: { ...base.legend, show: true },
          yaxis: { ...base.yaxis, title: { text: "MB", style: { color: "#94887a" } } },
        },
        series: [
          { name: "Uploaded", data: usageTimeline.map((point) => Number(point.uploaded.toFixed(2))) },
          { name: "Downloaded", data: usageTimeline.map((point) => Number(point.downloaded.toFixed(2))) },
        ],
      },
      ai: {
        options: {
          ...base,
          chart: { ...base.chart, type: "line" },
          colors: [CHART_COLORS.orange, CHART_COLORS.teal],
          yaxis: [
            { ...base.yaxis, title: { text: "Tokens", style: { color: "#94887a" } } },
            { opposite: true, labels: { style: { colors: "#71675b", fontSize: "10px" } }, title: { text: "Chats", style: { color: "#94887a" } } },
          ],
        },
        series: [
          { name: "Tokens", data: usageTimeline.map((point) => point.tokens) },
          { name: "Chats", data: usageTimeline.map((point) => point.chats) },
        ],
      },
      users: {
        options: {
          chart: { ...base.chart, type: "donut" },
          colors: [CHART_COLORS.olive, CHART_COLORS.muted],
          labels: ["Active", "Disabled"],
          legend: { ...base.legend, position: "bottom" },
          stroke: { colors: ["transparent"], width: 3 },
          plotOptions: { pie: { donut: { size: "68%", labels: { show: true, total: { show: true, label: "Users", formatter: () => String(users.length) } } } } },
          tooltip: { theme: "light" },
        },
        series: [activeUsers, disabledUsers],
      },
      operations: {
        options: {
          ...getBaseChartOptions(["Documents", "Moderation", "Attention", "AI chats"]),
          chart: { ...base.chart, type: "bar" },
          colors: [CHART_COLORS.orange],
          legend: { show: false },
          plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "48%", distributed: true } },
          xaxis: { categories: ["Documents", "Moderation", "Attention", "AI chats"], labels: { style: { colors: "#71675b", fontSize: "10px" } } },
          yaxis: { labels: { style: { colors: "#71675b", fontSize: "11px", fontWeight: 700 } } },
        },
        series: [{ name: "Total", data: [stats?.totalDocuments || 0, moderationQueueCount, attentionCount, stats?.totalAiChatsToday || 0] }],
      },
    };
  }, [activeUsers, attentionCount, moderationQueueCount, stats, usageTimeline, users.length]);

  async function resolveModerationCase(documentId, action) {
    const decision = action === "Approved" ? "APPROVE" : "KEEP_REJECTED";

    try {
      await reviewDocument(documentId, decision, `${action} from admin dashboard.`);
      setQueue((current) => current.filter((item) => item.id !== documentId));
      setNotice(`${action} completed for selected document.`);
    } catch (err) {
      setNotice(err.response?.data?.message || "Could not save moderation decision.");
    }
  }

  return (
    <section className="admin-dashboard">
      <main className="admin-dashboard__inner">
        {isLoading && <div className="admin-dashboard__notice">Loading admin data...</div>}
        {error && <div className="admin-dashboard__notice">{error}</div>}
        {notice && (
          <div className="admin-dashboard__notice" role="status">
            <i className="ti-check" />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")}>Close</button>
          </div>
        )}

        <section className="admin-dashboard__chart-heading">
          <div>
            <span className="admin-dashboard__kicker">Operations console</span>
            <h1>System overview</h1>
            <p>Live visual summary of storage, AI activity, users and items that need attention.</p>
          </div>
          <div className="admin-dashboard__chart-refresh">
            <span>Updated {lastUpdatedAt || "not yet"}</span>
            <button type="button" onClick={loadDashboard} disabled={isLoading}>
              <i className="ti-reload" /> {isLoading ? "Refreshing" : "Refresh data"}
            </button>
          </div>
        </section>

        <section className="admin-dashboard__charts-grid" aria-label="Dashboard charts">
          <article className="admin-dashboard__chart-card">
            <header><div><span>Storage traffic</span><strong>{formatBytes((stats?.totalBytesUploadedToday || 0) + (stats?.totalBytesDownloadedToday || 0))}</strong></div><small>Last 7 recorded days</small></header>
            <Chart options={chartData.storage.options} series={chartData.storage.series} type="bar" height={260} />
          </article>
          <article className="admin-dashboard__chart-card admin-dashboard__chart-card--wide">
            <header><div><span>AI activity</span><strong>{totalAiTokens.toLocaleString()} tokens</strong></div><small>{stats?.totalAiChatsToday || 0} chats today</small></header>
            <Chart options={chartData.ai.options} series={chartData.ai.series} type="line" height={260} />
          </article>
          <article className="admin-dashboard__chart-card">
            <header><div><span>User status</span><strong>{stats?.totalUsers || users.length} accounts</strong></div><small>{activeUsers} active</small></header>
            <Chart options={chartData.users.options} series={chartData.users.series} type="donut" height={250} />
          </article>
          <article className="admin-dashboard__chart-card admin-dashboard__chart-card--wide">
            <header><div><span>Operational workload</span><strong>{attentionCount} need attention</strong></div><small>{criticalModerationCount} critical · {avgQuotaUsage}% average quota</small></header>
            <Chart options={chartData.operations.options} series={chartData.operations.series} type="bar" height={250} />
          </article>
        </section>

        <section className="admin-dashboard__content-grid">
          <div className="admin-dashboard__main-stack">
            <section className="admin-dashboard__panel">
              <div className="admin-dashboard__panel-header">
                <div>
                  <h2>Moderation queue</h2>
                  <p>Documents flagged by AI that need a decision.</p>
                </div>
                <button
                  type="button"
                  className="admin-dashboard__outline-btn"
                  onClick={() => navigate("/admin/moderation")}
                >
                  Open moderation
                </button>
              </div>

              <div className="admin-dashboard__queue-list">
                {queue.length === 0 ? (
                  <div className="admin-dashboard__empty-state">
                    <i className="ti-check-box" />
                    <h3>No pending cases</h3>
                    <p>All moderation cases have been handled.</p>
                  </div>
                ) : (
                  queue.map((item) => (
                    <article className="admin-dashboard__queue-item" key={item.id}>
                      <div className={`admin-dashboard__queue-icon ${getQueueSeverity(item.status) === "critical" ? "is-critical" : ""}`}>
                        <i className="ti-alert" />
                      </div>
                      <div>
                        <strong>{repairTextEncoding(item.title)}</strong>
                        <p>{getDocumentReason(item)}</p>
                        <span>Uploader: {getDisplayName(item.uploader)} · Status {item.status}</span>
                      </div>
                      <span className={`admin-dashboard__severity is-${getQueueSeverity(item.status)}`}>{getQueueSeverity(item.status)}</span>
                      <button type="button" onClick={() => resolveModerationCase(item.id, "Approved")}>Approve</button>
                      <button type="button" onClick={() => resolveModerationCase(item.id, "Removed")}>Remove</button>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="admin-dashboard__dual-grid">
              <div className="admin-dashboard__panel">
                <div className="admin-dashboard__panel-header compact">
                  <div>
                    <h2>Quota monitor</h2>
                    <p>Users close to storage limits.</p>
                  </div>
                </div>

                <div className="admin-dashboard__quota-list">
                  {quotaRows.length === 0 ? (
                    <div className="admin-dashboard__empty-state">No quota usage yet.</div>
                  ) : (
                    quotaRows.map((item) => (
                      <article className="admin-dashboard__quota-row" key={item.id}>
                        <div>
                          <strong>{item.owner}</strong>
                          <span>Daily quota usage</span>
                        </div>
                        <div className="admin-dashboard__quota-meter">
                          <div><span style={{ width: `${item.percent}%` }} /></div>
                          <small>{formatBytes(item.used)} / {formatBytes(STORAGE_LIMIT_BYTES)}</small>
                        </div>
                        <button type="button" onClick={() => navigate("/admin/usage")}>Review</button>
                      </article>
                    ))
                  )}
                </div>
              </div>

              <div className="admin-dashboard__panel">
                <div className="admin-dashboard__panel-header compact">
                  <div>
                    <h2>AI usage watch</h2>
                    <p>High request and token usage.</p>
                  </div>
                </div>

                <div className="admin-dashboard__ai-list">
                  {aiRows.length === 0 ? (
                    <div className="admin-dashboard__empty-state">No AI usage yet.</div>
                  ) : (
                    aiRows.map((item) => (
                      <article className="admin-dashboard__ai-row" key={item.id}>
                        <div className="admin-dashboard__avatar small">{getInitials(item.owner)}</div>
                        <div>
                          <strong>{item.owner}</strong>
                          <span>{item.tokens.toLocaleString()} tokens · {item.requests} requests</span>
                        </div>
                        <button className={`admin-dashboard__risk is-${item.risk}`} type="button" onClick={() => navigate("/admin/usage")}>
                          {item.risk}
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>

          <aside className="admin-dashboard__side-stack">
            <section className="admin-dashboard__panel admin-dashboard__users-panel">
              <div className="admin-dashboard__panel-header compact">
                <div>
                  <h2>Users</h2>
                  <p>Current account state.</p>
                </div>
              </div>
              {users.slice(0, 5).map((user) => {
                const name = getDisplayName(user);
                const status = String(user.status || "ACTIVE").toLowerCase();
                return (
                  <article className="admin-dashboard__user-row" key={user.id}>
                    <div className="admin-dashboard__avatar small">{getInitials(name)}</div>
                    <div>
                      <strong>{name}</strong>
                      <span>{user.email}</span>
                    </div>
                    <span className={`admin-dashboard__user-status is-${status}`}>{status}</span>
                  </article>
                );
              })}
            </section>

            <section className="admin-dashboard__panel admin-dashboard__logs-panel">
              <div className="admin-dashboard__panel-header compact">
                <div>
                  <h2>Recent logs</h2>
                  <p>{visibleLogs.length} entries shown</p>
                </div>
              </div>

              <div className="admin-dashboard__log-list">
                {visibleLogs.map((log) => (
                  <button
                    key={log.id}
                    type="button"
                    className={`admin-dashboard__log-item ${selectedLog?.id === log.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedLog(log)}
                  >
                    <span className="admin-dashboard__log-dot is-ai" />
                    <div>
                      <strong>{log.action_type}</strong>
                      <small>{getDisplayName(log.actor)} · {getLogTime(log.created_at)}</small>
                    </div>
                  </button>
                ))}
              </div>

              {selectedLog && (
                <div className="admin-dashboard__log-detail">
                  <span>Selected log</span>
                  <strong>{selectedLog.id}</strong>
                  <p>{selectedLog.action_type} on {selectedLog.entity_type}</p>
                </div>
              )}
            </section>
          </aside>
        </section>
      </main>
    </section>
  );
}

export default AdminDashboardPage;
