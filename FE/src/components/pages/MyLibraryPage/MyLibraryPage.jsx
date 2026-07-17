import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LuChevronLeft,
  LuChevronRight,
  LuBookPlus,
  LuLibraryBig,
} from "react-icons/lu";
import { getPublicLibraries } from "../../../utils/publicApi";
import { getMyLibraries } from "../../../utils/documentApi";
import { getStoredUser } from "../../../utils/authToken";
import "./MyLibraryPage.css";
import "../../../assets/icons/themify-icons-font/themify-icons/themify-icons.css";

function getLibraryName(library) {
  return library.name || library.libraryName || "Untitled Library";
}

function getStoredUserRole() {
  try {
    const user = getStoredUser();
    return String(user?.role || "").toUpperCase();
  } catch {
    return "";
  }
}

function notifyGuestRegistrationRequired() {
  alert(
    "Please register or log in with an account to create libraries and workspaces.",
  );
}

function MyLibraryPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const [libraries, setLibraries] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const isLoggedIn = !!getStoredUser();
  const isGuest = getStoredUserRole() === "GUEST";

  useEffect(() => {
    if (!isLoggedIn) return;
    let isMounted = true;

    async function loadLibraries() {
      try {
        setIsLoading(true);
        const data = isGuest ? await getPublicLibraries() : await getMyLibraries();
        if (isMounted) {
          setLibraries(data || []);
        }
      } catch (error) {
        console.error("Cannot load libraries:", error);
        if (isMounted) {
          setLibraries([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadLibraries();

    return () => {
      isMounted = false;
    };
  }, [isGuest]);

  const ITEMS_PER_PAGE = 6;
  const totalPages = Math.ceil(libraries.length / ITEMS_PER_PAGE);
  const safeCurrentPage = Math.min(currentPage, totalPages || 1);

  const paginatedLibraries = libraries.slice(
    (safeCurrentPage - 1) * ITEMS_PER_PAGE,
    safeCurrentPage * ITEMS_PER_PAGE,
  );

  const totalDocuments = libraries.reduce(
    (total, library) => total + (Number(library.documents) || 0),
    0,
  );
  const visibleLibraries = libraries.filter(
    (library) => library.visibility === "public" || library.profileVisible,
  ).length;
  const latestLibrary = libraries[0];
  const libraryStats = {
    totalDocuments,
    visibleLibraries,
    latestLibraryName: latestLibrary
      ? getLibraryName(latestLibrary)
      : "No library yet",
  };

  return (
    <main className="my_library_page">
      <section className="library_content">
        <header className="my_library_hero">
          <div className="my_library_hero_left">
            <span className="library_overline">
              {isGuest ? "Public library catalog" : "Library command center"}
            </span>

            <h1>
              {isGuest
                ? "Public academic collections"
                : "My academic collections"}
            </h1>

            <p>
              {isGuest
                ? "Browse public study libraries and their shared files. Register to create your own private collections."
                : "Keep your research folders, course documents and study material in one organized place."}
            </p>

            <div className="library_header_actions">
              {isGuest ? (
                <>
                  <button
                    type="button"
                    onClick={notifyGuestRegistrationRequired}
                    className="create_library_btn"
                  >
                    <LuBookPlus aria-hidden="true" />
                    Create library
                  </button>

                  <button
                    type="button"
                    onClick={notifyGuestRegistrationRequired}
                    className="my_library_import_btn"
                  >
                    <i className="ti-import"></i>
                    Import library
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/dashboard/create-library"
                    state={{ from: "/dashboard/libraries" }}
                    className="create_library_btn"
                  >
                    <LuBookPlus aria-hidden="true" />
                    Create library
                  </Link>

                  <Link
                    to="/dashboard/import-library"
                    state={{ from: "/dashboard/libraries" }}
                    className="my_library_import_btn"
                  >
                    <i className="ti-import"></i>
                    Import library
                  </Link>
                </>
              )}
            </div>
          </div>

          <aside className="my_library_hero_card" aria-label="Library overview">
            <div className="hero_card_icon">
              <LuLibraryBig aria-hidden="true" />
            </div>

            <div>
              <span>
                {isGuest ? "Newest public collection" : "Latest collection"}
              </span>
              <strong>{libraryStats.latestLibraryName}</strong>
            </div>

            <p>
              {isGuest
                ? "Open a public library to view shared files."
                : "Open a library to manage files, folders, tags, visibility and storage."}
            </p>
          </aside>
        </header>

        <section className="library_stats_grid" aria-label="Library statistics">
          <article>
            <span>{isGuest ? "Public libraries" : "Total libraries"}</span>
            <strong>{libraries.length}</strong>
          </article>

          <article>
            <span>Total documents</span>
            <strong>{libraryStats.totalDocuments}</strong>
          </article>

          <article>
            <span>{isGuest ? "Open access" : "Visible libraries"}</span>
            <strong>{libraryStats.visibleLibraries}</strong>
          </article>
        </section>

        <section className="library_board_header">
          <div>
            <h2>{isGuest ? "Public library board" : "Your library board"}</h2>
            <p>
              {isLoading
                ? "Loading public libraries..."
                : libraries.length === 0
                  ? "Create your first library to start collecting documents."
                  : `${libraries.length} libraries available in your study hub.`}
            </p>
          </div>

          {libraries.length > 0 && (
            <span className="library_page_count">
              Page {safeCurrentPage} of {totalPages}
            </span>
          )}
        </section>

        {isLoading ? (
          <section className="empty_library_state">
            <div className="empty_library_icon">
              <i className="ti-reload animate-spin"></i>
            </div>

            <h2>Loading libraries</h2>

            <p>Please wait while StudyHub loads the study collections.</p>
          </section>
        ) : libraries.length === 0 ? (
          <section className="empty_library_state">
            <div className="empty_library_icon">
              <LuLibraryBig aria-hidden="true" />
            </div>

            <h2>{isGuest ? "No public libraries yet" : "No libraries yet"}</h2>

            <p>
              {isGuest
                ? "Public libraries will appear here when users share study materials."
                : "Create a library to group documents by subject, project or research topic."}
            </p>

            {isGuest ? (
              <button
                type="button"
                onClick={notifyGuestRegistrationRequired}
                className="empty_library_action"
              >
                <LuBookPlus aria-hidden="true" />
                Create first library
              </button>
            ) : (
              <Link
                to="/dashboard/create-library"
                state={{ from: "/dashboard/libraries" }}
                className="empty_library_action"
              >
                <LuBookPlus aria-hidden="true" />
                Create first library
              </Link>
            )}
          </section>
        ) : (
          <section className="collection_grid">
            {paginatedLibraries.map((library, index) => {
              const libraryName = getLibraryName(library);
              const documentCount = Number(library.documents) || 0;

              return (
                <Link
                  to={`/dashboard/libraries/${library.id}`}
                  state={{
                    library: isGuest
                      ? { ...library, isPublicView: true, visibility: "public" }
                      : library,
                    from: "/dashboard/libraries",
                  }}
                  className="collection_card collection_card_link"
                  key={library.id}
                >
                  <div className="collection_top">
                    <div
                      className={`collection_icon ${
                        library.highlight ? "highlight" : ""
                      }`}
                    >
                      <LuLibraryBig aria-hidden="true" />
                    </div>

                    <span className="collection_index">
                      {String(
                        (safeCurrentPage - 1) * ITEMS_PER_PAGE + index + 1,
                      ).padStart(2, "0")}
                    </span>
                  </div>

                  <div className="collection_body">
                    <h3>{libraryName}</h3>
                    <p>
                      {documentCount}{" "}
                      {documentCount === 1 ? "document" : "documents"}
                    </p>
                  </div>

                  <div className="collection_footer">
                    <span>{library.updatedAt || "Updated just now"}</span>
                    <span className="collection_arrow" aria-hidden="true">
                      <i className="ti-arrow-right"></i>
                    </span>
                  </div>
                </Link>
              );
            })}
          </section>
        )}

        {totalPages > 1 && (
          <nav className="library_pagination" aria-label="Library pagination">
            <button
              type="button"
              disabled={safeCurrentPage === 1}
              onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
              aria-label="Previous page"
            >
              <LuChevronLeft aria-hidden="true" />
            </button>

            {Array.from({ length: totalPages }, (_, index) => index + 1).map(
              (page) => (
                <button
                  type="button"
                  key={page}
                  className={safeCurrentPage === page ? "active" : ""}
                  onClick={() => setCurrentPage(page)}
                  aria-label={`Go to page ${page}`}
                >
                  {page}
                </button>
              ),
            )}

            <button
              type="button"
              disabled={safeCurrentPage === totalPages}
              onClick={() =>
                setCurrentPage((page) => Math.min(page + 1, totalPages))
              }
              aria-label="Next page"
            >
              <LuChevronRight aria-hidden="true" />
            </button>
          </nav>
        )}
      </section>
    </main>
  );
}

export default MyLibraryPage;
