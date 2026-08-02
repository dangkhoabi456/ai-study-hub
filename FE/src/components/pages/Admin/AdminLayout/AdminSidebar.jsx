import { NavLink, useNavigate } from "react-router-dom";
import {
  LuChartPie,
  LuLayoutDashboard,
  LuListChecks,
  LuLogOut,
  LuSettings,
  LuUsers,
  LuX,
} from "react-icons/lu";
import { HiOutlineHome } from "react-icons/hi2";
import Logo from "../../../../assets/logo/Logo.jsx";
import api from "../../../../utils/api.js";
import { clearStoredSession } from "../../../../utils/authToken.js";

const ADMIN_MENU_ITEMS = [
  { icon: LuLayoutDashboard, label: "Dashboard", path: "/admin/dashboard" },
  { icon: LuUsers, label: "Users", path: "/admin/users" },
  { icon: LuListChecks, label: "Activity Logs", path: "/admin/logs" },
  { icon: LuChartPie, label: "Usage", path: "/admin/usage" },
  { icon: LuSettings, label: "Settings", path: "/admin/settings" },
];

function AdminSidebar({ isOpen, onClose }) {
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } catch (error) {
      console.error("Logout request failed:", error);
    } finally {
      clearStoredSession();
      onClose();
      navigate("/login", { replace: true });
    }
  }

  return (
    <>
      {isOpen && (
        <button
          type="button"
          className="sidebar_overlay"
          aria-label="Close admin sidebar"
          onClick={onClose}
        />
      )}

      <aside className={`sidebar ${isOpen ? "sidebar_open" : ""}`}>
        <div className="sidebar_top">
          <div className="sidebar_header">
            <Logo />
            <button
              type="button"
              className="close_btn"
              aria-label="Close admin sidebar"
              onClick={onClose}
            >
              <LuX aria-hidden="true" />
            </button>
          </div>

          <nav className="sidebar_nav">
            {ADMIN_MENU_ITEMS.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `sidebar_link ${isActive ? "active" : ""}`
                  }
                  key={item.label}
                  onClick={onClose}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="sidebar_bottom_actions">
          <NavLink
            to="/dashboard/home"
            className="admin_dashboard_btn"
            onClick={onClose}
          >
            <HiOutlineHome aria-hidden="true" />
            <span>User dashboard</span>
          </NavLink>

          <button type="button" className="logout_btn" onClick={handleLogout}>
            <LuLogOut aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

export default AdminSidebar;
