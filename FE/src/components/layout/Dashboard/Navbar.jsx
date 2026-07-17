import { Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  HiOutlineBell,
  HiOutlinePlus,
  HiOutlineSquaresPlus,
} from "react-icons/hi2";
import { LuBookPlus, LuMenu } from "react-icons/lu";
import {
  getNotificationSettings,
  getNotifications,
  markAllNotificationsAsRead,
  mergeAppNotifications,
} from "../../../utils/notificationStore.js";
import { searchUsers } from "../../../utils/searchApi.js";
import { getMyLibraries } from "../../../utils/documentApi.js";
import { getMyWorkspaceNotifications, getWorkspaces } from "../../../utils/workspaceApi.js";
import { getMyProfile } from "../../../utils/profileApi.js";
import { getPublicLibraries } from "../../../utils/publicApi.js";
import defaultAvatar from "../../../assets/images/account.png";
import { getStoredUser } from "../../../utils/authToken.js";

function getStoredUserRole() {
  try {
    const user = getStoredUser();
    return String(user?.role || "").toUpperCase();
  } catch {
    return "";
  }
}

function saveRecentLibrary(library) {
  const currentRecentLibraries = JSON.parse(
    localStorage.getItem("aiStudyHubRecentLibraries") || "[]"
  );

  const recentLibrary = {
    id: library.id,
    name: library.name || library.libraryName || "Untitled Library",
    description: library.description || "",
    documents: Number(library.documents) || 0,
    icon: library.icon || "ti-archive",
    visitedAt: Date.now(),
  };

  const nextRecentLibraries = [
    recentLibrary,
    ...currentRecentLibraries.filter((item) => item.id !== library.id),
  ].slice(0, 2);

  localStorage.setItem(
    "aiStudyHubRecentLibraries",
    JSON.stringify(nextRecentLibraries)
  );
}

function saveRecentWorkspace(workspace) {
  const currentRecentWorkspaces = JSON.parse(
    localStorage.getItem("aiStudyHubRecentWorkspaces") || "[]"
  );

  const recentWorkspace = {
    id: workspace.id,
    name: workspace.name || "Untitled Workspace",
    documents: Number(workspace.documents) || 0,
    icon: workspace.icon || "ti-layout-grid2",
    visitedAt: Date.now(),
  };

  const nextRecentWorkspaces = [
    recentWorkspace,
    ...currentRecentWorkspaces.filter((item) => item.id !== workspace.id),
  ].slice(0, 3);

  localStorage.setItem(
    "aiStudyHubRecentWorkspaces",
    JSON.stringify(nextRecentWorkspaces)
  );
}

function Navbar({
  onOpenSidebar,
  profilePath = "/dashboard/profile",
  searchPlaceholder = "Search library or workspace...",
}) {
  const navigate = useNavigate();
  const isLoggedIn = !!getStoredUser();
  const isGuest = getStoredUserRole() === "GUEST";
  const [searchValue, setSearchValue] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [matchedUsers, setMatchedUsers] = useState([]);
  const [profileAvatar, setProfileAvatar] = useState("");


  const [notifications, setNotifications] = useState(() => getNotifications());

  const [notificationSettings, setNotificationSettings] = useState(() =>
    getNotificationSettings()
  );

  useEffect(() => {
    function syncNotifications() {
      setNotifications(getNotifications());
      setNotificationSettings(getNotificationSettings());
    }

    window.addEventListener("aiStudyHubNotificationsChanged", syncNotifications);
    window.addEventListener(
      "aiStudyHubNotificationSettingsChanged",
      syncNotifications
    );
    window.addEventListener("storage", syncNotifications);

    return () => {
      window.removeEventListener(
        "aiStudyHubNotificationsChanged",
        syncNotifications
      );
      window.removeEventListener(
        "aiStudyHubNotificationSettingsChanged",
        syncNotifications
      );
      window.removeEventListener("storage", syncNotifications);
    };
  }, []);

  useEffect(() => {
    if (isGuest) return undefined;

    let isMounted = true;
    async function syncServerNotifications() {
      try {
        const serverNotifications = await getMyWorkspaceNotifications();
        if (isMounted) {
          setNotifications(mergeAppNotifications(serverNotifications || []));
        }
      } catch (error) {
        console.error("Failed to sync workspace notifications:", error);
      }
    }

    syncServerNotifications();
    const intervalId = window.setInterval(syncServerNotifications, 10000);
    window.addEventListener("focus", syncServerNotifications);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncServerNotifications);
    };
  }, [isGuest]);

  useEffect(() => {
    const keyword = searchValue.trim();

    if (keyword.length < 2) {
      return undefined;
    }

    let isCancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const users = await searchUsers(keyword);
        if (!isCancelled) setMatchedUsers(users || []);
      } catch {
        if (!isCancelled) setMatchedUsers([]);
      }
    }, 250);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchValue]);

  useEffect(() => {
    function syncProfileAvatar(event) {
      setProfileAvatar(event.detail?.avatar || "");
    }

    window.addEventListener("aiStudyHubProfileChanged", syncProfileAvatar);

    return () => {
      window.removeEventListener(
        "aiStudyHubProfileChanged",
        syncProfileAvatar
      );
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || isGuest) return;

    let isMounted = true;

    async function loadProfileAvatar() {
      try {
        const profile = await getMyProfile();
        if (!isMounted) return;

        const nextAvatar = profile?.avatar_url || "";
        setProfileAvatar(nextAvatar);
      } catch (error) {
        console.error("Failed to load profile avatar:", error);
      }
    }

    loadProfileAvatar();

    return () => {
      isMounted = false;
    };
  }, [isGuest]);

  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.isRead
  ).length;

  const [libraries, setLibraries] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let isMounted = true;
    
    async function loadSearchData() {
      try {
        if (isGuest) {
          const publicLibraries = await getPublicLibraries();
          if (isMounted) {
            setLibraries(publicLibraries || []);
            setWorkspaces([]);
          }
          return;
        }

        const [libs, wspaces] = await Promise.all([
          getMyLibraries(),
          getWorkspaces()
        ]);
        if (isMounted) {
          setLibraries(libs || []);
          setWorkspaces(wspaces || []);
        }
      } catch (err) {
        console.error("Failed to load search data:", err);
      }
    }
    loadSearchData();

    return () => {
      isMounted = false;
    };
  }, [isGuest]);

  const searchResults = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();

    if (keyword === "") {
      return [];
    }

    const matchedLibraries = libraries
      .filter((library) => {
        const libraryName = library.name || library.libraryName || "";
        const libraryDescription = library.description || "";

        return (
          libraryName.toLowerCase().includes(keyword) ||
          libraryDescription.toLowerCase().includes(keyword)
        );
      })
      .map((library) => ({
        id: library.id,
        type: "library",
        title: library.name || library.libraryName || "Untitled Library",
        description: library.description || `${Number(library.documents) || 0} documents`,
        icon: library.icon || "ti-archive",
        data: library,
      }));

    const matchedWorkspaces = workspaces
      .filter((workspace) => {
        const workspaceName = workspace.name || "";
        const workspaceDescription = workspace.description || "";

        return (
          workspaceName.toLowerCase().includes(keyword) ||
          workspaceDescription.toLowerCase().includes(keyword)
        );
      })
      .map((workspace) => ({
        id: workspace.id,
        type: "workspace",
        title: workspace.name || "Untitled Workspace",
        description: workspace.description || `${Number(workspace.documents) || 0} documents`,
        icon: workspace.icon || "ti-layout-grid2",
        data: workspace,
      }));

    const userResults = (keyword.length >= 2 ? matchedUsers : []).map((user) => ({
      id: user.id,
      type: "user",
      title: user.full_name || user.username || user.email || "Unknown user",
      description: user.username ? `@${user.username}` : user.email,
      icon: "ti-user",
      data: user,
    }));

    return [...userResults, ...matchedLibraries, ...matchedWorkspaces].slice(
      0,
      8,
    );
  }, [searchValue, libraries, workspaces, matchedUsers]);

  function handleOpenSearchResult(result) {
    if (result.type === "library") {
      if (!isGuest) {
        saveRecentLibrary(result.data);
      }

      navigate(`/dashboard/libraries/${result.id}`, {
        state: {
          library: isGuest
            ? { ...result.data, isPublicView: true, visibility: "public" }
            : result.data,
          from: window.location.pathname,
        },
      });
    }

    if (result.type === "workspace" && !isGuest) {
      saveRecentWorkspace(result.data);
      navigate(`/dashboard/workspaces/${result.id}`, {
        state: {
          workspace: result.data,
          from: window.location.pathname,
        },
      });
    }

    if (result.type === "user") {
      navigate(`/dashboard/profile/${result.id}`);
    }

    setSearchValue("");
    setIsSearchFocused(false);
  }

  function handleSearchSubmit(e) {
    e.preventDefault();

    const keyword = searchValue.trim();
    if (!keyword) return;

    if (isGuest) {
      navigate(`/dashboard/search?q=${encodeURIComponent(keyword)}`);
    } else {
      navigate(`/dashboard/search?q=${encodeURIComponent(keyword)}`);
    }
    setIsSearchFocused(false);
  }

  const shouldShowSearchPanel = isSearchFocused && searchValue.trim() !== "";
  const avatarImage = profileAvatar || defaultAvatar;

  return (
    <header className="top_navbar">
      <div className="nav_left">
        <button
          type="button"
          className="menu_btn"
          aria-label="Open sidebar"
          onClick={onOpenSidebar}
          onMouseEnter={onOpenSidebar}
          onFocus={onOpenSidebar}
        >
          <LuMenu aria-hidden="true" />
        </button>
      </div>

      <form className="search_box" onSubmit={handleSearchSubmit}>
        <input
          type="text"
          value={searchValue}
          placeholder={searchPlaceholder}
          onChange={(e) => setSearchValue(e.target.value)}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
        />

        {shouldShowSearchPanel && (
          <div className="global_search_panel">
            {searchResults.length === 0 ? (
              <div className="global_search_empty">
                <i className="ti-search"></i>
                <p>No user, library or workspace found.</p>
              </div>
            ) : (
              searchResults.map((result) => (
                <button
                  type="button"
                  className="global_search_item"
                  key={`${result.type}-${result.id}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleOpenSearchResult(result)}
                >
                  <div className="global_search_icon">
                    <i className={result.icon}></i>
                  </div>

                  <div>
                    <strong>{result.title}</strong>
                    <p>{result.description}</p>
                  </div>

                  <span>{result.type}</span>
                </button>
              ))
            )}
            <button
              type="submit"
              className="global_search_view_all"
              onMouseDown={(e) => e.preventDefault()}
            >
              <i className="ti-search" />
              View all results for “{searchValue.trim()}”
            </button>
          </div>
        )}
      </form>

      <div className="nav_actions">
        {isGuest ? (
          <div className="guest_auth_actions">
            <Link to="/login" className="guest_auth_link">
              Log in
            </Link>
            <Link to="/register" className="guest_auth_link primary">
              Sign up
            </Link>
          </div>
        ) : (
          <>
            <div className="create_dropdown">
              <button type="button" className="create_dropdown_btn">
                <HiOutlinePlus aria-hidden="true" />
              </button>

              <div className="create_dropdown_menu">
                <Link to="/dashboard/create-library">
                  <LuBookPlus aria-hidden="true" />
                  Create library
                </Link>

                <Link
                  to="/dashboard/import-library"
                  state={{ from: "/dashboard/home" }}
                >
                  <i className="ti-import"></i>
                  Import library
                </Link>

                <Link to="/dashboard/create-workspace">
                  <HiOutlineSquaresPlus aria-hidden="true" />
                  Create workspace
                </Link>
              </div>
            </div>

            <div className="notification_dropdown">
              <button type="button" className="notification_btn">
                <HiOutlineBell aria-hidden="true" />
                {notificationSettings.showBadge &&
                  unreadNotificationCount > 0 && (
                    <span className="notification_badge">
                      {unreadNotificationCount}
                    </span>
                  )}
              </button>

              <div className="notification_panel">
                <div className="notification_header">
                  <div>
                    <strong>Notifications</strong>
                    <p>Recent workspace activity</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      markAllNotificationsAsRead();
                      setNotifications(getNotifications());
                    }}
                  >
                    Mark all read
                  </button>
                </div>

                <div className="notification_list">
                  {!notificationSettings.enabled ? (
                    <div className="notification_empty">
                      <i className="ti-bell"></i>
                      <p>Notifications are turned off.</p>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="notification_empty">
                      <i className="ti-bell"></i>
                      <p>No notifications yet.</p>
                    </div>
                  ) : (
                    notifications.map((notification) => (
                      <button
                        type="button"
                        key={notification.id}
                        className={`notification_item ${
                          notification.isRead ? "" : "unread"
                        }`}
                        onClick={() => {
                          if (notification.link) {
                            navigate(notification.link);
                          }
                        }}
                      >
                        <div className="notification_icon">
                          <i className={notification.icon}></i>
                        </div>

                        <div>
                          <strong>{notification.title}</strong>
                          <p>{notification.message}</p>
                          <span>{notification.createdAt}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <button type="button" className="notification_view_all">
                  View all notifications
                </button>
              </div>
            </div>

          </>
        )}

        {!isGuest && (
          <Link
            to={profilePath}
            className="profile_avatar"
            aria-label="Go to personal profile"
            style={{ backgroundImage: `url(${avatarImage})` }}
          />
        )}
      </div>
    </header>
  );
}

export default Navbar;
