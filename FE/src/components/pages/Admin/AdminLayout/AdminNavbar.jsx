import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LuMenu,
  LuSearch,
} from "react-icons/lu";
import { getStoredUser } from "../../../../utils/authToken.js";
import { getMyProfile } from "../../../../utils/profileApi.js";
import defaultAvatar from "../../../../assets/images/account.png";

const PAGE_LABELS = {
  dashboard: "System overview",
  users: "User management",
  logs: "Activity logs",
  usage: "Usage analytics",
  settings: "Settings",
  profile: "Profile & security",
};

function AdminNavbar({ onOpenSidebar }) {
  const location = useLocation();
  const navigate = useNavigate();
  const searchInputRef = useRef(null);
  const [searchValue, setSearchValue] = useState("");
  const [avatar, setAvatar] = useState("");

  const storedUser = useMemo(() => getStoredUser() || {}, []);
  const currentSegment = location.pathname.split("/").filter(Boolean).at(-1) || "dashboard";
  const currentPage = PAGE_LABELS[currentSegment] || "Administration";

  useEffect(() => {
    let mounted = true;
    getMyProfile().catch(() => null).then((profile) => {
      if (!mounted) return;
      setAvatar(profile?.avatar_url || storedUser?.avatar_url || "");
    });
    return () => { mounted = false; };
  }, [storedUser]);

  useEffect(() => {
    function focusAdminSearch(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusAdminSearch);
    return () => window.removeEventListener("keydown", focusAdminSearch);
  }, []);

  function handleSearch(event) {
    event.preventDefault();
    const query = searchValue.trim();
    if (!query) return;
    navigate(`/admin/users?search=${encodeURIComponent(query)}`);
  }

  return (
    <header className="admin_command_bar">
      <div className="admin_command_bar__left">
        <button type="button" className="admin_command_bar__menu" onClick={onOpenSidebar} aria-label="Open admin navigation">
          <LuMenu />
        </button>
        <div className="admin_command_bar__context">
          <strong>Admin console</strong>
          <span><Link to="/admin/dashboard">Admin</Link><i>/</i>{currentPage}</span>
        </div>
      </div>

      <form className="admin_command_bar__search" onSubmit={handleSearch} role="search">
        <LuSearch aria-hidden="true" />
        <input
          ref={searchInputRef}
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search across the admin console..."
          aria-label="Search administration data"
        />
        <kbd>Ctrl K</kbd>
      </form>

      <div className="admin_command_bar__right">
        <div className="admin_command_bar__health" title="All monitored services are operational">
          <i />
          <span>Operational</span>
        </div>

        <Link
          to="/admin/profile"
          className="admin_command_bar__profile"
          aria-label="Open admin profile"
        >
          <img src={avatar || defaultAvatar} alt="" />
          <span>ADMIN</span>
        </Link>
      </div>
    </header>
  );
}

export default AdminNavbar;
