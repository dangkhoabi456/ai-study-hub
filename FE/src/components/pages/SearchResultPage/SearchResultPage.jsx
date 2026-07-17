import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { searchUsers } from "../../../utils/searchApi";
import { getWorkspaces } from "../../../utils/workspaceApi";
import { getMyLibraries } from "../../../utils/documentApi.js";
import { getPublicLibraries } from "../../../utils/publicApi.js";
import { getStoredUser } from "../../../utils/authToken.js";
import "./SearchResultPage.css";

const FILTERS = [
  { value: "all", label: "All", icon: "ti-search" },
  { value: "user", label: "Users", icon: "ti-user" },
  { value: "library", label: "Libraries", icon: "ti-archive" },
  { value: "workspace", label: "Workspaces", icon: "ti-layout-grid2" },
];

function getStoredUserRole() {
  try {
    const user = getStoredUser();
    return user?.role || "";
  } catch {
    return "";
  }
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function getUserName(user) {
  return user.full_name || user.username || user.email || "Unknown user";
}

function getInitials(value = "") {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "US"
  );
}

function SearchResultPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const activeFilter = searchParams.get("filter") || "all";
  const isLoggedIn = !!getStoredUser();
  const isGuest = getStoredUserRole() === "GUEST";
  const effectiveFilter = activeFilter;
  const [users, setUsers] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoggedIn) return;
    let isMounted = true;

    async function loadSearchData() {
      try {
        setIsLoading(true);
        setError("");

        const [matchedUsers, joinedWorkspaces, matchedLibraries] = await Promise.all([
          query.trim().length >= 2 ? searchUsers(query.trim()) : [],
          !isGuest ? getWorkspaces().catch(() => []) : [],
          isGuest 
            ? getPublicLibraries().catch(() => []) 
            : getMyLibraries().catch(() => []),
        ]);

        if (!isMounted) return;
        setUsers(matchedUsers || []);
        setWorkspaces(joinedWorkspaces || []);
        setLibraries(matchedLibraries || []);
      } catch (requestError) {
        if (!isMounted) return;
        setUsers([]);
        setWorkspaces([]);
        setLibraries([]);
        setError(
          requestError.response?.data?.message ||
          "Some search results could not be loaded.",
        );
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadSearchData();

    return () => {
      isMounted = false;
    };
  }, [isGuest, query]);

  const results = useMemo(() => {
    const keyword = normalize(query);
    if (!keyword) return [];

    const userResults = users.map((user) => ({
          id: user.id,
          type: "user",
          title: getUserName(user),
          subtitle: user.username ? `@${user.username}` : user.email,
          description: user.email || "User in AI Study Hub",
          badge: user.role || "USER",
          iconText: getInitials(getUserName(user)),
          data: user,
          to: `/dashboard/profile/${user.id}`,
          state: { from: `/dashboard/search?q=${query}` },
        }));

    const libraryResults = libraries
      .filter((library) =>
        normalize(
          `${library.name || library.libraryName || ""} ${library.description || ""}`,
        ).includes(keyword),
      )
      .map((library) => ({
        id: library.id,
        type: "library",
        title: library.name || library.libraryName || "Untitled Library",
        subtitle: `${Number(library.documents) || 0} documents`,
        description:
          library.description || "A saved collection in your study hub.",
        badge: library.visibility || "Library",
        icon: library.icon || "ti-archive",
        to: `/dashboard/libraries/${library.id}`,
        state: {
          library: isGuest
            ? { ...library, isPublicView: true, visibility: "public" }
            : library,
          from: `/dashboard/search?q=${query}`,
        },
      }));

    const workspaceResults = isGuest
      ? []
      : workspaces
      .filter((workspace) =>
        normalize(
          `${workspace.name} ${workspace.description} ${workspace.role}`,
        ).includes(keyword),
      )
      .map((workspace) => ({
        id: workspace.id,
        type: "workspace",
        title: workspace.name || "Untitled Workspace",
        subtitle: workspace.role
          ? `Joined as ${workspace.role}`
          : "Joined workspace",
        description:
          workspace.description ||
          "A collaborative workspace you have joined.",
        badge: workspace.visibility || "Workspace",
        icon: workspace.icon || "ti-layout-grid2",
        to: `/dashboard/workspaces/${workspace.id}`,
        state: { workspace, from: `/dashboard/search?q=${query}` },
      }));

    return [...userResults, ...libraryResults, ...workspaceResults];
  }, [isGuest, libraries, query, users, workspaces]);

  const filteredResults =
    effectiveFilter === "all"
      ? results
      : results.filter((result) => result.type === effectiveFilter);

  const resultCounts = useMemo(
    () =>
      results.reduce(
        (counts, result) => ({
          ...counts,
          [result.type]: counts[result.type] + 1,
        }),
        { all: results.length, user: 0, library: 0, workspace: 0 },
      ),
    [results],
  );

  function changeFilter(type) {
    const nextParams = new URLSearchParams(searchParams);
    if (type === "all") nextParams.delete("type");
    else nextParams.set("type", type);
    setSearchParams(nextParams);
  }

  const visibleFilters = isGuest
    ? FILTERS.filter((filter) => ["all", "user", "library"].includes(filter.value))
    : FILTERS;

  return (
    <main className="search-results-page">
      <header className="search-results-header">
        <span>Global search</span>
        <h1>
          Results for <strong>“{query}”</strong>
        </h1>
        <p>
          {isGuest
            ? "Guest search includes public libraries and visible user profiles."
            : "Find people in the system, your libraries, and workspaces you have joined."}
        </p>
      </header>

      <div className="search-results-layout">
        <aside className="search-filter-panel" aria-label="Filter search results">
          <h2>Filter by</h2>
          <nav>
            {visibleFilters.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={effectiveFilter === filter.value ? "active" : ""}
                onClick={() => changeFilter(filter.value)}
              >
                <i className={filter.icon} />
                <span>{filter.label}</span>
                <strong>{resultCounts[filter.value]}</strong>
              </button>
            ))}
          </nav>
        </aside>

        <section className="search-results-content">
          <div className="search-results-toolbar">
            <div>
              <strong>{filteredResults.length} results</strong>
              <span> matching your search</span>
            </div>
            <span className="search-query-chip">
              <i className="ti-search" />
              {query || "No search term"}
            </span>
          </div>

          {isLoading ? (
            <div className="search-results-state">
              <i className="ti-reload" />
              <h2>Searching the study hub...</h2>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="search-results-state">
              <i className="ti-search" />
              <h2>No matching results</h2>
              <p>Try a different keyword or select another filter.</p>
            </div>
          ) : (
            <div className="search-results-list">
              {filteredResults.map((result) => {
                const content = (
                  <>
                    <span
                      className={`search-result-icon is-${result.type}`}
                      aria-hidden="true"
                    >
                      {result.iconText || <i className={result.icon} />}
                    </span>
                    <div className="search-result-copy">
                      <div>
                        <h2>{result.title}</h2>
                        <span>{result.subtitle}</span>
                      </div>
                      <p>{result.description}</p>
                    </div>
                    <span className={`search-result-type is-${result.type}`}>
                      {result.badge}
                    </span>
                    {result.to && <i className="ti-angle-right" />}
                  </>
                );

                return result.to ? (
                  <Link
                    to={result.to}
                    state={result.state}
                    className="search-result-card"
                    key={`${result.type}-${result.id}`}
                  >
                    {content}
                  </Link>
                ) : (
                  <article
                    className="search-result-card is-user-card"
                    key={`${result.type}-${result.id}`}
                  >
                    {content}
                  </article>
                );
              })}
            </div>
          )}

          {error && <p className="search-results-warning">{error}</p>}
        </section>
      </div>
    </main>
  );
}

export default SearchResultPage;
