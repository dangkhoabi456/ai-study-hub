import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LuActivity,
  LuBell,
  LuCheck,
  LuClock3,
  LuMail,
  LuShieldCheck,
} from "react-icons/lu";
import { getActivityLogs } from "../../../../utils/adminApi.js";
import { getStoredUser } from "../../../../utils/authToken.js";
import { getMyProfile } from "../../../../utils/profileApi.js";
import defaultAvatar from "../../../../assets/images/account.png";
import "./AdminProfilePage.css";

function displayName(user) {
  return user?.full_name || user?.fullName || user?.username || user?.email || "System administrator";
}

function formatAction(value = "") {
  return String(value)
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTime(value) {
  if (!value) return "Timestamp unavailable";
  return new Date(value).toLocaleString();
}

function AdminProfilePage() {
  const storedUser = useMemo(() => getStoredUser() || {}, []);
  const [profile, setProfile] = useState(storedUser);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [emailAlerts, setEmailAlerts] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadAdminProfile() {
      try {
        setIsLoading(true);
        setError("");
        const [profileData, logData] = await Promise.all([
          getMyProfile().catch(() => null),
          getActivityLogs(),
        ]);
        if (!isMounted) return;
        setProfile({ ...storedUser, ...(profileData || {}) });
        setLogs(logData || []);
      } catch (loadError) {
        if (!isMounted) return;
        setError(loadError.response?.data?.message || "Could not load all administrator details.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadAdminProfile();
    return () => { isMounted = false; };
  }, [storedUser]);

  const currentUserId = String(profile?.id || profile?._id || profile?.user_id || "");
  const ownLogs = logs.filter((log) => {
    const actorId = log.user_id || log.actor_id || log.actor?.id;
    return currentUserId && String(actorId || "") === currentUserId;
  });
  const recentLogs = (ownLogs.length ? ownLogs : logs).slice(0, 5);
  const role = profile?.role || profile?.system_role || "SYSTEM_ADMIN";
  const roleLabel = formatAction(role) || "System Admin";
  return (
    <section className="admin-profile-page">
      <header className="admin-profile-page__heading">
        <div>
          <span>Admin account</span>
          <h1>Profile &amp; security</h1>
          <p>Manage your administrator identity, access and operational preferences.</p>
        </div>
      </header>

      {isLoading && <div className="admin-profile-page__notice">Loading administrator profile...</div>}
      {error && <div className="admin-profile-page__notice is-error">{error}</div>}

      <section className="admin-profile-page__identity-card">
        <div className="admin-profile-page__identity-main">
          <img src={profile?.avatar_url || profile?.avatar || defaultAvatar} alt="Administrator avatar" />
          <div>
            <div className="admin-profile-page__identity-badges">
              <span><LuShieldCheck /> {roleLabel}</span>
              <span className="is-active"><i /> Active</span>
            </div>
            <h2>{displayName(profile)}</h2>
            <p><LuMail /> {profile?.email || "No email available"}</p>
          </div>
        </div>
        <div className="admin-profile-page__identity-meta">
          <span>Administrator ID</span>
          <strong>{currentUserId || "Not available"}</strong>
          <small><LuClock3 /> Current administrative session</small>
        </div>
      </section>

      <div className="admin-profile-page__layout">
        <main>
          <section className="admin-profile-page__card">
            <header><div><LuActivity /><span><h2>Recent admin activity</h2><p>Your latest recorded administrative actions.</p></span></div><Link to="/admin/logs">See all</Link></header>
            <div className="admin-profile-page__activity-list">
              {recentLogs.length ? recentLogs.map((log) => (
                <article key={log.id}>
                  <span><LuCheck /></span>
                  <div><strong>{formatAction(log.action_type || "Admin action")}</strong><p>{formatAction(log.entity_type || "System")} · {log.entity_id || "No entity ID"}</p></div>
                  <time>{formatTime(log.created_at)}</time>
                </article>
              )) : <div className="admin-profile-page__empty">No administrator activity has been recorded yet.</div>}
            </div>
          </section>
        </main>

        <aside>
          <section className="admin-profile-page__card admin-profile-page__access-card">
            <header><div><LuShieldCheck /><span><h2>Admin access</h2><p>Current role and permissions.</p></span></div></header>
            <strong className="admin-profile-page__role">{roleLabel}</strong>
            <ul>
              <li><LuCheck /> Manage user accounts</li>
              <li><LuCheck /> View usage and audit logs</li>
              <li><LuCheck /> Access system settings</li>
            </ul>
          </section>

          <section className="admin-profile-page__card">
            <header><div><LuBell /><span><h2>Preferences</h2><p>Administrative notifications.</p></span></div></header>
            <label className="admin-profile-page__toggle-row">
              <span><strong>Email alerts</strong><small>Security and account updates</small></span>
              <input type="checkbox" checked={emailAlerts} onChange={(event) => setEmailAlerts(event.target.checked)} />
              <i aria-hidden="true" />
            </label>
          </section>
        </aside>
      </div>
    </section>
  );
}

export default AdminProfilePage;
