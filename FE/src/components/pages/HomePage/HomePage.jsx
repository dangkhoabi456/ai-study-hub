import { useEffect, useMemo, useState } from "react";
import "./HomePage.css";
import "../../../assets/icons/themify-icons-font/themify-icons/themify-icons.css";
import { Link } from "react-router-dom";
import { HiOutlineSquaresPlus } from "react-icons/hi2";
import { LuBookPlus, LuLibraryBig } from "react-icons/lu";
import studyHubLogo from "../../../assets/images/StudyHubLogo.svg";
import studyHubWhiteLogo from "../../../assets/images/StudyHubWhiteLogo.svg";
import { useTheme } from "../../../context/ThemeContext.jsx";
import { getMyLibraries } from "../../../utils/documentApi.js";
import { getMyProfile } from "../../../utils/profileApi.js";
import { getAiSummary } from "../../../utils/aiApi.js";
import { getPublicLibraries } from "../../../utils/publicApi.js";

import { getStoredUser } from "../../../utils/authToken.js";
import { getUserStoredItem } from "../../../utils/userStorage.js";

function getItemId(item) {
  return item?.id || item?._id || item?.libraryId || item?.workspaceId || "";
}

function getRecentTimestamp(item) {
  const values = [
    item?.visitedAt,
    item?.lastAccessedAt,
    item?.lastOpenedAt,
    item?.updatedAt,
    item?.updated_at,
    item?.createdAt,
    item?.created_at,
  ];

  for (const value of values) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }

    const parsedValue = Date.parse(value);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return 0;
}
    
function getStoredUserRole() {
  try {
    const user = getStoredUser();
    return String(user?.role || "").toUpperCase();
  } catch {
    return "";
  }
}

function getStoredJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function getUserStoredJson(key) {
  try {
    return JSON.parse(getUserStoredItem(key) || "null");
  } catch {
    return null;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function getLibraryName(library) {
  return library?.name || library?.libraryName || "Untitled Library";
}

function HomePage() {
  const { theme } = useTheme();
  const isGuest = getStoredUserRole() === "GUEST";
  const [profileName, setProfileName] = useState("User");
  const [libraries, setLibraries] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [latestChatDocument, setLatestChatDocument] = useState(null);
  const [latestStudyCard, setLatestStudyCard] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      try {
        if (isGuest) {
          const publicLibraries = await getPublicLibraries();
          if (!isMounted) return;

          setLibraries(Array.isArray(publicLibraries) ? publicLibraries : []);
          return;
        }

        const libraryData = await getMyLibraries();

        if (!isMounted) return;

        setLibraries(Array.isArray(libraryData) ? libraryData : []);
      } catch (error) {
        console.error("Cannot load dashboard data:", error);

        if (!isMounted) return;

        setLibraries([]);
      }
    }

    loadDashboardData();

    return () => {
      isMounted = false;
    };
  }, [isGuest]);

  useEffect(() => {
    if (isGuest) {
      setAiSummary(null);
      setLatestChatDocument(null);
      setLatestStudyCard(null);
      return;
    }

    let isMounted = true;

    async function loadAiOverview() {
      try {
        const summary = await getAiSummary();
        if (!isMounted) return;

        setAiSummary(summary);
      } catch (error) {
        console.error("Cannot load AI summary:", error);
      }
    }

    const refreshLatestChatDocument = (event) => {
      setLatestChatDocument(
        event?.detail || getUserStoredJson("aiStudyHubLastChatDocument"),
      );
    };

    refreshLatestChatDocument();
    setLatestStudyCard(getStoredJson("aiStudyHubLastStudyCard"));
    loadAiOverview();
    window.addEventListener(
      "aiStudyHubLastChatDocumentChanged",
      refreshLatestChatDocument,
    );

    return () => {
      isMounted = false;
      window.removeEventListener(
        "aiStudyHubLastChatDocumentChanged",
        refreshLatestChatDocument,
      );
    };
  }, [isGuest]);

  useEffect(() => {
    if (isGuest) {
      setProfileName("Guest");
      return;
    }

    let isMounted = true;

    async function loadProfileName() {
      try {
        const profile = await getMyProfile();
        if (!isMounted) return;

        setProfileName(profile?.username || profile?.full_name || profile?.email || "User");
      } catch (error) {
        console.error("Cannot load profile name:", error);
      }
    }

    loadProfileName();

    return () => {
      isMounted = false;
    };
  }, [isGuest]);

  const recentLibraries = useMemo(
    () =>
      [...libraries]
            .sort((a, b) => getRecentTimestamp(b) - getRecentTimestamp(a))
            .slice(0, 2),
    [libraries]
  );


  const totalDocuments = useMemo(() => {
    return libraries.reduce(
      (total, library) => total + Number(library.documents || 0),
      0
    );
  }, [libraries]);

  const stats = useMemo(
    () =>
      isGuest
        ? [
            {
              title: "Public libraries",
              value: libraries.length,
              detail: "Open collections",
              icon: LuLibraryBig,
            },
            {
              title: "Public documents",
              value: totalDocuments,
              detail: "Shared for reading",
              icon: "ti-files",
            },
            {
              title: "Access mode",
              value: "Public",
              detail: "Guest browsing only",
              icon: "ti-unlock",
            },
          ]
        : [
            {
              title: "Libraries",
              value: libraries.length,
              detail: "Saved collections",
              icon: LuLibraryBig,
            },
            {
              title: "Documents",
              value: totalDocuments,
              detail: "Across all libraries",
              icon: "ti-files",
            },
          ],
    [isGuest, libraries.length, totalDocuments],
  );

  const latestLibrary = recentLibraries[0];
  const latestLibraryId = getItemId(latestLibrary);
  const latestChatLibrary = libraries.find(
    (library) => String(getItemId(library)) === String(latestChatDocument?.libraryId),
  );
  const latestStudyLibrary = libraries.find(
    (library) => String(getItemId(library)) === String(latestStudyCard?.libraryId),
  );
  const studyTotalCards = Number(latestStudyCard?.totalCards || 0);
  const studyDoneCards = Number(latestStudyCard?.studiedCards || 0);
  const studyProgress = studyTotalCards
    ? Math.min(Math.round((studyDoneCards / studyTotalCards) * 100), 100)
    : 0;

  return (
    <main className="home_page">
      <section className="home_shell">
        <section className="home_intro_grid" aria-label="Home overview">
          <div className="home_command_panel">
            <div className="home_brand_row">
              <img
                src={theme === "white" ? studyHubWhiteLogo : studyHubLogo}
                className={theme === "white" ? "home_brand_logo_light" : ""}
                alt="Study Hub"
              />
            </div>

            <div className="home_headline_block">
              <span className="home_label">
                {isGuest ? "Public library access" : "Study command center"}
              </span>
              <h1>
                {isGuest ? (
                  "Explore public libraries"
                ) : (
                  <>
                    Welcome back,
                    <span>{profileName}</span>
                  </>
                )}
              </h1>
              <p>
                {isGuest
                  ? "Search and read public study collections shared by the community. Log in when you want to create libraries or use AI tools."
                  : "Continue from your latest materials, manage study spaces and start new work without leaving the dashboard."}
              </p>
            </div>

            <div className="home_primary_actions">
  {isGuest ? (
    <>
      <Link
        to="/dashboard/libraries"
        className="home_btn home_btn_primary"
      >
        <i className="ti-search"></i>
        Browse public libraries
      </Link>

      <Link
        to="/dashboard/search?type=library"
        className="home_btn home_btn_secondary"
      >
        <i className="ti-archive"></i>
        Search library
      </Link>

      <Link
        to="/login"
        className="home_btn home_btn_secondary"
      >
        <i className="ti-user"></i>
        Log in
      </Link>
    </>
  ) : (
    <>
      <Link
        to="/dashboard/create-library"
        state={{ from: "/dashboard/home" }}
        className="home_btn home_btn_primary"
      >
        <HiOutlineSquaresPlus className="home_create_workspace_icon" aria-hidden="true" />
        Create library
      </Link>

      <Link
        to="/dashboard/create-library"
        state={{ from: "/dashboard/home" }}
        className="home_btn home_btn_secondary"
      >
        <LuBookPlus aria-hidden="true" />
        Create library
      </Link>

      <Link
        to="/dashboard/import-library"
        state={{ from: "/dashboard/home" }}
        className="home_btn home_btn_secondary"
      >
        <i className="ti-import"></i>
        Import library
      </Link>
    </>
  )}
</div>
          </div>

          <aside className="home_focus_panel" aria-label="Recent activity preview">
            <div className="focus_panel_header">
              <span className="home_label">Today</span>
              <strong>Focus board</strong>
            </div>

            <div className="focus_card focus_card_dark">
              <div className="focus_card_icon" aria-hidden="true">
                <LuLibraryBig />
              </div>
              <span>{isGuest ? "Newest public library" : "Recent library"}</span>
              <h2>
                {latestLibrary?.name ||
                  latestLibrary?.libraryName ||
                  "No library opened yet"}
              </h2>
              <p>
                {latestLibrary
                  ? `${latestLibrary.documents || 0}${isGuest ? " public" : ""} documents`
                  : isGuest
                    ? "Public libraries will appear here once available."
                    : "Open a library once to place it here."}
              </p>
              {latestLibrary && (
                <Link
                  to={
                    latestLibraryId
                      ? `/dashboard/libraries/${latestLibraryId}`
                      : "/dashboard/libraries"
                  }
                  state={{
                    library: {
                      ...latestLibrary,
                      isOwned: !isGuest,
                      isPublicView: isGuest,
                    },
                  }}
                >
                  Open library
                </Link>
              )}
            </div>

            {!isGuest ? (
              <div className="focus_card focus_card_light">
                <span>Recent library</span>
                <h2>{latestLibrary?.name || "No library opened yet"}</h2>
              </div>
            ) : (
              <div className="focus_card focus_card_light">
                <span>Guest mode</span>
                <h2>Public libraries only</h2>
                <p>You can search public collections and open shared files.</p>
                <Link
                  to="/dashboard/search?type=library"
                >
                  Search library
                </Link>
              </div>
            )}
          </aside>
        </section>

        <section className="home_stats_strip" aria-label="Account summary">
          {stats.map((stat) => {
            const StatIcon = stat.icon;

            return (
              <article className="home_stat_item" key={stat.title}>
                <div className="home_stat_icon">
                  {typeof StatIcon === "string" ? (
                    <i className={StatIcon}></i>
                  ) : (
                    <StatIcon aria-hidden="true" />
                  )}
                </div>
                <div>
                  <strong>{stat.value}</strong>
                  <span>{stat.title}</span>
                  <p>{stat.detail}</p>
                </div>
              </article>
            );
          })}
        </section>

        {isGuest ? (
          <section className="home_body_grid">
            <section className="home_main_stack">
              <div className="home_section_header">
                <div>
                  <span className="home_label">Public materials</span>
                  <h2>Libraries you can open as guest</h2>
                </div>

                <Link to="/dashboard/libraries" className="home_text_link">
                  View all libraries
                  <i className="ti-arrow-right"></i>
                </Link>
              </div>

              <div className="recent_library_grid">
                {recentLibraries.length === 0 ? (
                  <div className="home_empty_state home_empty_large">
                    <div className="home_empty_icon">
                      <LuLibraryBig aria-hidden="true" />
                    </div>
                    <h3>No public libraries yet</h3>
                    <p>Public study libraries will appear here when users share collections.</p>
                  </div>
                ) : (
                  recentLibraries.map((library, index) => {
                    const libraryId = getItemId(library);

                    return (
                      <article className="recent_library_card" key={libraryId || index}>
                        <div className="library_card_header">
                          <div className="library_icon_cluster">
                            <LuLibraryBig aria-hidden="true" />
                          </div>
                          <span>{index === 0 ? "Newest" : "Public"}</span>
                        </div>

                        <div className="library_card_body">
                          <h3>{getLibraryName(library)}</h3>
                        </div>

                        <div className="library_card_footer">
                          <span>{library.documents || 0} docs</span>
                          <Link
                            to={
                              libraryId
                                ? `/dashboard/libraries/${libraryId}`
                                : "/dashboard/libraries"
                            }
                            state={{
                              library: { ...library, isPublicView: true, visibility: "public" },
                              from: "/dashboard/home",
                            }}
                          >
                            Open
                          </Link>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            <aside className="home_side_stack">
              <div className="home_section_header compact_header">
                <div>
                  <span className="home_label">Guest limits</span>
                  <h2>Read-only access</h2>
                </div>
              </div>

              <div className="home_empty_state home_empty_compact">
                <div className="home_empty_icon">
                  <i className="ti-lock"></i>
                </div>
                <h3>Public browsing mode</h3>
                <p>Guest accounts can search public libraries and view shared documents. Creating libraries, AI chat and flashcards require login.</p>
                <Link to="/register">Create account</Link>
              </div>
            </aside>
          </section>
        ) : (
        <section className="home_body_grid">
          <section className="home_main_stack">
            <div className="home_section_header">
              <div>
                <span className="home_label">AI activity</span>
                <h2>Your AI study status</h2>
              </div>

            </div>

            <div className="ai_overview_grid">
              <article className="ai_overview_card ai_token_card">
                <div className="ai_overview_icon">
                  <i className="ti-bolt"></i>
                </div>

                <div className="ai_overview_body">
                  <span>AI chats remaining today</span>
                  <strong>
                    {isGuest
                      ? "0"
                      : formatNumber(aiSummary?.chatsRemaining ?? 0)}
                  </strong>
                  <p>
                    {isGuest
                      ? "Sign in to use AI chat."
                      : `${formatNumber(aiSummary?.chatsUsed ?? 0)} of ${formatNumber(aiSummary?.chatLimit ?? 50)} AI chats used`}
                  </p>
                </div>
              </article>

              <article className="ai_overview_card">
                <div className="ai_overview_icon">
                  <i className="ti-file"></i>
                </div>

                <div className="ai_overview_body">
                  <span>Latest AI chat file</span>
                  <strong>
                    {latestChatDocument?.title || "No file used yet"}
                  </strong>
                  <p>
                    {latestChatDocument
                      ? `Library: ${latestChatLibrary?.name || "No library"}`
                      : "Ask AI about a document to show it here."}
                  </p>
                </div>

                {latestChatDocument?.libraryId && (
                  <Link
                    to={`/dashboard/libraries/${latestChatDocument.libraryId}`}
                    className="home_open_btn"
                  >
                    Open
                  </Link>
                )}
              </article>
            </div>
          </section>

          <aside className="home_side_stack">
            <div className="home_section_header compact_header">
              <div>
                <span className="home_label">Study card</span>
                <h2>Latest progress</h2>
              </div>

            </div>

            {latestStudyCard ? (
              <article className="study_progress_card">
                <div className="study_progress_top">
                  <div className="workspace_icon">
                    <i className="ti-layers"></i>
                  </div>
                  <span>{studyProgress}%</span>
                </div>

                <h3>{latestStudyCard.title || "Untitled card set"}</h3>
                <p>
                  {studyDoneCards} of {studyTotalCards} cards reviewed
                </p>

                <div className="study_progress_meter" aria-hidden="true">
                  <span style={{ width: `${studyProgress}%` }} />
                </div>

                <dl className="study_progress_meta">
                  <div>
                    <dt>Study set</dt>
                    <dd>{latestStudyCard?.title || "Flashcards"}</dd>
                  </div>
                  <div>
                    <dt>Library</dt>
                    <dd>{latestStudyLibrary?.name || "No library"}</dd>
                  </div>
                </dl>

                <Link to="/dashboard/flashcards" className="home_open_btn">
                  Continue
                </Link>
              </article>
            ) : (
              <div className="home_empty_state home_empty_compact">
                <div className="home_empty_icon">
                  <i className="ti-layers"></i>
                </div>
                <h3>No study card yet</h3>
                <p>Generate flashcards from an approved document to track your latest progress.</p>
                {!isGuest && <Link to="/dashboard/flashcards">Create flashcards</Link>}
              </div>
            )}
          </aside>
        </section>
        )}

        {/* <section className="home_action_grid" aria-label="Quick actions">
          {quickActions.map((action) => (
            <Link
              to={action.to}
              state={action.to.includes("create") ? { from: "/dashboard/home" } : undefined}
              className={
                action.primary
                  ? "quick_action_card quick_action_card_primary"
                  : "quick_action_card"
              }
              key={action.title}
            >
              <i className={action.icon}></i>
              <div>
                <h3>{action.title}</h3>
                <p>{action.description}</p>
              </div>
              <span className="quick_action_arrow">
                <i className="ti-arrow-right"></i>
              </span>
            </Link>
          ))}
        </section> */}
      </section>
    </main>
  );
}

export default HomePage;
