import { useEffect, useMemo, useState } from "react";
import { getModerationDocuments, reviewDocument } from "../../../../utils/adminApi";
import "./AIContentModerationPage.css";

const FILTERS = ["All", "Pending review", "Flagged", "Rejected", "Retry"];
const PAGE_SIZE = 10;

function FilterDropdown({ label, value, options, icon, onChange }) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label || label;

  return (
    <details className="ai-moderation-page__filter-select">
      <summary aria-label={`${label}: ${selectedLabel}`}>
        <i className={icon} aria-hidden="true" />
        <span>{selectedLabel}</span>
        <i className="ti-angle-down" aria-hidden="true" />
      </summary>
      <div className="ai-moderation-page__filter-options" role="listbox" aria-label={label}>
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

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "No date";
  return new Date(value).toLocaleString();
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
      .toUpperCase() || "U"
  );
}

function getReason(document) {
  const reason = document.ai_reject_reason;
  if (!reason) return "No AI reason was stored for this document.";
  if (typeof reason === "string") return reason;
  return reason.reason || reason.error || JSON.stringify(reason);
}

function getSuspiciousContent(document) {
  const reason = document.ai_reject_reason;
  if (reason?.suspicious_text?.length) return reason.suspicious_text.join("\n");
  return document.admin_review_reason || "No suspicious text excerpt was stored.";
}

function getStatusLabel(status) {
  if (status === "APPROVED") return "Approved";
  if (status === "FLAGGED") return "Flagged";
  if (status === "REJECTED") return "Rejected";
  if (status === "PENDING_RETRY") return "Retry";
  return "Pending review";
}

function getSeverity(status) {
  if (status === "FLAGGED" || status === "REJECTED") return "High";
  return "Medium";
}

function getSeverityClass(severity) {
  return severity.toLowerCase();
}

function AIContentModerationPage() {
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [severityFilter, setSeverityFilter] = useState("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    async function loadInitialCases() {
      try {
        setIsLoading(true);
        setError("");
        const data = await getModerationDocuments();
        setCases(data || []);
        setSelectedCaseId((data || [])[0]?.id || null);
      } catch (err) {
        setError(
          err.response?.data?.message || "Could not load moderation queue.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialCases();
  }, []);

  const selectedCase =
    cases.find((item) => item.id === selectedCaseId) || null;

  const filteredCases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return cases.filter((item) => {
      const uploaderName = getDisplayName(item.uploader);
      const matchesQuery =
        !normalizedQuery ||
        item.title?.toLowerCase().includes(normalizedQuery) ||
        uploaderName.toLowerCase().includes(normalizedQuery) ||
        item.uploader?.email?.toLowerCase().includes(normalizedQuery) ||
        item.status?.toLowerCase().includes(normalizedQuery);

      const statusLabel = getStatusLabel(item.status);
      const matchesStatus =
        statusFilter === "All" || statusLabel === statusFilter;
      const matchesSeverity =
        severityFilter === "All" || getSeverity(item.status) === severityFilter;

      return matchesQuery && matchesStatus && matchesSeverity;
    });
  }, [cases, query, statusFilter, severityFilter]);

  useEffect(() => {
    // Resetting pagination is intentional whenever the filter result set changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1);
  }, [query, statusFilter, severityFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCases.length / PAGE_SIZE));
  const paginatedCases = useMemo(
    () =>
      filteredCases.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE,
      ),
    [currentPage, filteredCases],
  );

  const stats = useMemo(() => {
    const flagged = cases.filter((item) => item.status === "FLAGGED").length;
    const pending = cases.filter((item) => item.status !== "APPROVED").length;
    const rejected = cases.filter((item) => item.status === "REJECTED").length;
    const highRisk = cases.filter((item) => getSeverity(item.status) === "High").length;

    return [
      { label: "Flagged files", value: flagged, note: "Require admin action" },
      { label: "Pending review", value: pending, note: "Waiting for decision" },
      { label: "High risk", value: highRisk, note: "Prioritize these first" },
      { label: "Rejected files", value: rejected, note: "Awaiting final review" },
    ];
  }, [cases]);

  async function updateCaseStatus(id, nextStatus) {
    const decision = nextStatus === "Approved" ? "APPROVE" : "KEEP_REJECTED";

    try {
      await reviewDocument(id, decision, `${nextStatus} from admin moderation page.`);
      setCases((currentCases) => currentCases.filter((item) => item.id !== id));
      setSelectedCaseId((currentId) => {
        if (currentId !== id) return currentId;
        return cases.find((item) => item.id !== id)?.id || null;
      });
      setNotice(`Case ${id} marked as ${nextStatus.toLowerCase()}.`);
    } catch (err) {
      setNotice(err.response?.data?.message || "Could not save moderation decision.");
    }
  }

  function resetFilters() {
    setQuery("");
    setStatusFilter("All");
    setSeverityFilter("All");
  }

  return (
    <section className="ai-moderation-page">
      <header className="ai-moderation-page__page-header">
        <div>
          <h1>AI Moderation</h1>
          <p>Review AI-detected issues and decide on the right action to keep the study space safe.</p>
        </div>

      </header>

      {isLoading && <div className="ai-moderation-page__notice">Loading moderation queue...</div>}
      {error && <div className="ai-moderation-page__notice">{error}</div>}
      {notice && (
        <div className="ai-moderation-page__notice">
          <i className="ti-check"></i>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      <section className="ai-moderation-page__toolbar" aria-label="Moderation filters">
        <label className="ai-moderation-page__search-box">
          <i className="ti-search" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documents, uploaders, IDs..."
          />
        </label>

        <FilterDropdown
          label="Risk level"
          value={severityFilter}
          icon="ti-alert"
          options={[
            { value: "All", label: "All risk levels" },
            { value: "High", label: "High risk" },
            { value: "Medium", label: "Medium risk" },
          ]}
          onChange={setSeverityFilter}
        />

        <FilterDropdown
          label="Status"
          value={statusFilter}
          icon="ti-filter"
          options={FILTERS.map((filter) => ({
            value: filter,
            label: filter === "All" ? "All statuses" : filter,
          }))}
          onChange={setStatusFilter}
        />

        <button
          type="button"
          className="ai-moderation-page__reset-btn"
          onClick={resetFilters}
        >
          Reset
        </button>
      </section>

      <div className="ai-moderation-page__stats-grid">
        {stats.map((item, index) => (
          <article key={item.label} className="ai-moderation-page__stat-card">
            <span className={`ai-moderation-page__stat-icon is-${index + 1}`}>
              <i className={["ti-files", "ti-time", "ti-shield", "ti-stats-up"][index]} />
            </span>
            <div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.note}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="ai-moderation-page__workbench">
        <main className="ai-moderation-page__queue-card">
          <div className="ai-moderation-page__queue-header">
            <h2>Moderation queue</h2>
            <span>{filteredCases.length} items</span>
          </div>

          <div className="ai-moderation-page__table-head" aria-hidden="true">
            <span className="ai-moderation-page__checkbox-spacer" />
            <span>Document</span>
            <span>Uploader &amp; Date</span>
            <span>Risk level</span>
            <span>Status</span>
            <span />
          </div>

          <div className="ai-moderation-page__case-list">
            {filteredCases.length > 0 ? (
              paginatedCases.map((item) => {
                const severity = getSeverity(item.status);
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`ai-moderation-page__case-row ${
                      selectedCase?.id === item.id ? "is-selected" : ""
                    }`}
                    onClick={() =>
                    setSelectedCaseId((currentId) =>
                        currentId === item.id ? null : item.id,
                    )
                  }
                  >
                    <span className="ai-moderation-page__checkbox">
                    {selectedCase?.id === item.id && <i className="ti-check" />}
                  </span>

                  <span className="ai-moderation-page__file-icon">
                      <i className="ti-file" />
                    </span>

                    <span className="ai-moderation-page__case-main">
                      <strong>{item.title}</strong>
                      <small>{item.id}</small>
                    </span>

                    <span className="ai-moderation-page__uploader-cell">
                      <strong>{getDisplayName(item.uploader)}</strong>
                      <small>{formatDate(item.created_at)}</small>
                    </span>

                    <span className={`ai-moderation-page__severity ${getSeverityClass(severity)}`}>
                      {severity}
                    </span>

                    <span className={`ai-moderation-page__status-pill is-${getStatusLabel(item.status).toLowerCase().replaceAll(" ", "-")}`}>
                      {getStatusLabel(item.status)}
                    </span>
  
                  <i className="ti-angle-right ai-moderation-page__row-arrow" />
                </button>
                );
              })
            ) : (
              <div className="ai-moderation-page__empty-state">
                <i className="ti-shield"></i>
                <h3>No cases match your filters</h3>
                <p>Try another keyword, status or severity level.</p>
              </div>
            )}
          </div>

          <footer className="ai-moderation-page__queue-footer">
            <span>
              Showing {filteredCases.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–
              {Math.min(currentPage * PAGE_SIZE, filteredCases.length)} of{" "}
              {filteredCases.length} items
            </span>
            <div>
              <button
                type="button"
                aria-label="Previous page"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                <i className="ti-angle-left" />
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button
                type="button"
                aria-label="Next page"
                disabled={currentPage === totalPages}
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
              >
                <i className="ti-angle-right" />
              </button>
            </div>
          </footer>
        </main>

        <aside className="ai-moderation-page__detail-panel">
          {selectedCase ? (
            <>
              <div className="ai-moderation-page__selected-label">
                <strong>Selected case</strong>
                <span>{selectedCase.id}</span>
              </div>

              <div className="ai-moderation-page__detail-top">
                <span className="ai-moderation-page__file-icon">
                  <i className="ti-file" />
                </span>
                <div className="ai-moderation-page__detail-title">
                  <h2>{selectedCase.title}</h2>
                </div>
                <span className={`ai-moderation-page__severity ${getSeverityClass(getSeverity(selectedCase.status))}`}>
                  {getSeverity(selectedCase.status)}
                </span>
              </div>

              <section className="ai-moderation-page__reason-card">
                <h3>AI reason</h3>
                <p>{getReason(selectedCase)}</p>
              </section>

              <section className="ai-moderation-page__reason-card warning">
                <h3>Suspicious content</h3>
                <p>{getSuspiciousContent(selectedCase)}</p>
              </section>

              <section className="ai-moderation-page__metadata-card">
                <h3>Uploader</h3>
                <div className="ai-moderation-page__uploader-card">
                  <span>{getInitials(getDisplayName(selectedCase.uploader))}</span>
                  <div>
                    <strong>{getDisplayName(selectedCase.uploader)}</strong>
                    <p>{selectedCase.uploader?.email || "No email"}</p>
                    <small>{selectedCase.uploader?.username || "No username"}</small>
                  </div>
                </div>
              </section>

              <section className="ai-moderation-page__metadata-card">
                <h3>Document metadata</h3>
                <div className="ai-moderation-page__meta-grid">
                  <div>
                    <span>Type</span>
                    <strong>{selectedCase.title?.split(".").pop()?.toUpperCase() || "File"}</strong>
                  </div>
                  <div>
                    <span>Size</span>
                    <strong>{formatBytes(selectedCase.file_size_bytes)}</strong>
                  </div>
                  <div>
                    <span>Public</span>
                    <strong>{selectedCase.is_public ? "Yes" : "No"}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{selectedCase.status}</strong>
                  </div>
                  <div>
                    <span>Uploaded</span>
                    <strong>{formatDate(selectedCase.created_at)}</strong>
                  </div>
                </div>
              </section>

              <div className="ai-moderation-page__decision-bar">
                <button
                  type="button"
                  className="approve"
                  onClick={() => updateCaseStatus(selectedCase.id, "Approved")}
                >
                  <i className="ti-check" />
                  Approve
                </button>
                <button
                  type="button"
                  className="quarantine"
                  onClick={() => updateCaseStatus(selectedCase.id, "Rejected")}
                >
                  <i className="ti-lock" />
                  Keep rejected
                </button>
              </div>
            </>
          ) : (
            <div className="ai-moderation-page__empty-state">
              <i className="ti-panel"></i>
              <h3>Select a case</h3>
              <p>Choose a flagged document to inspect details.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

export default AIContentModerationPage;
