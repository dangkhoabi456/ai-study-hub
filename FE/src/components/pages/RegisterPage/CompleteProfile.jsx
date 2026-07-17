import { useState, useEffect } from "react";
import FormInput from "../../common/FormInput/FormInput.jsx";
import api from "../../../utils/api.js";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import "./Register.css";

function CompleteProfile() {
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({ username: "", password: "" });
  const [profileBio, setProfileBio] = useState("");
  const [createdUser, setCreatedUser] = useState(null);
  const [showBioPopup, setShowBioPopup] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [bioErrorMsg, setBioErrorMsg] = useState("");
  const [isSavingBio, setIsSavingBio] = useState(false);

  const email = location.state?.email;
  const setupToken = location.state?.setupToken;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const bioWordCount = profileBio.trim()
    ? profileBio.trim().split(/\s+/).length
    : 0;

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (formData.username.trim() !== "") {
        try {
          const res = await api.get(
            `/auth/check-username?username=${encodeURIComponent(formData.username)}`,
          );
          if (res.data.exists) {
            setUsernameStatus("❌ This username is already taken.");
          } else {
            setUsernameStatus("✅ Username is available.");
          }
        } catch {
          console.error("Failed to check username");
        }
      } else {
        setUsernameStatus("");
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [formData.username]);

  if (!email || !setupToken) {
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!formData.username) return setErrorMsg("Username is required!");
    if (usernameStatus.includes("❌"))
      return setErrorMsg("Please choose a different Username.");
    if (!formData.password) return setErrorMsg("Password is required!");

    try {
      const response = await api.post("/auth/complete-setup", {
        email: email,
        username: formData.username,
        password: formData.password,
        setupToken: setupToken,
      });

      const accessToken = response.data.data.accessToken;
      const user = response.data.data.user;

      localStorage.setItem("accessToken", accessToken);

      if (user) {
        localStorage.setItem("user", JSON.stringify(user));
      }

      setCreatedUser(user || null);
      setShowBioPopup(true);
    } catch (error) {
      setErrorMsg(error.response?.data?.message || "Update failed.");
    }
  };

  const handleSaveBio = async (e) => {
    e.preventDefault();

    const trimmedBio = profileBio.trim();
    setBioErrorMsg("");

    if (!trimmedBio) {
      setBioErrorMsg("Please enter a bio description before continuing.");
      return;
    }

    if (bioWordCount > 350) {
      setBioErrorMsg("Bio description cannot exceed 350 words.");
      return;
    }

    setIsSavingBio(true);

    let nextUser = createdUser || {};

    try {
      const response = await api.patch("/users/profile-bio", {
        bio: trimmedBio,
      });

      nextUser = {
        ...nextUser,
        ...(response.data?.data || {}),
        bio: trimmedBio,
      };
    } catch (error) {
      console.warn("Failed to save bio on server, saving temporarily to localStorage:", error);
      nextUser = {
        ...nextUser,
        bio: trimmedBio,
      };
    }

    localStorage.setItem("user", JSON.stringify(nextUser));
    localStorage.setItem("aiStudyHubProfileBio", trimmedBio);
    setIsSavingBio(false);
    navigate("/dashboard/profile", { replace: true });
  };

  return (
    <div className="register_page">
      <form className="register_card" onSubmit={handleSubmit}>
        <p className="register_title">Complete Profile</p>

        <FormInput
          type="text"
          name="username"
          value={formData.username}
          onChange={handleChange}
          label="Username *"
          required
        />
        <span
          style={{
            fontSize: "13px",
            color: usernameStatus.includes("✅") ? "green" : "red",
            display: "block",
            marginTop: "-15px",
          }}
        >
          {usernameStatus}
        </span>

        <p
          className="register_message"
          style={{ fontSize: "13px", color: "var(--text-secondary)" }}
        >
          Password must be &gt;= 8 characters, with 1 lowercase letter, 1 number, and 1 special character.
        </p>

        <FormInput
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          label="Password *"
          required
        />

        {errorMsg && (
          <p
            style={{
              color: "red",
              textAlign: "center",
              fontSize: "14px",
              margin: "0",
            }}
          >
            {errorMsg}
          </p>
        )}

        <button className="register_submit" type="submit">
          Complete
        </button>
      </form>

      {showBioPopup && (
        <div className="register_bio_overlay" role="dialog" aria-modal="true">
          <form className="register_bio_modal" onSubmit={handleSaveBio}>
            <p className="register_title">Describe Yourself</p>
            <p className="register_message">
              Please write a short introduction about yourself, your learning goals, and fields
              of interest. This will be displayed on your profile page.
            </p>

            <textarea
              value={profileBio}
              onChange={(e) => setProfileBio(e.target.value)}
              placeholder="Example: I am studying React, like AI, and want to build better self-study habits..."
              autoFocus
            />

            <div className="register_bio_footer">
              <span className={bioWordCount > 350 ? "over_limit" : ""}>
                {bioWordCount} / 350 words
              </span>

              <button
                className="register_submit"
                type="submit"
                disabled={isSavingBio}
              >
                {isSavingBio ? "Saving..." : "Save Description"}
              </button>
            </div>

            {bioErrorMsg && <p className="register_bio_error">{bioErrorMsg}</p>}
          </form>
        </div>
      )}
    </div>
  );
}

export default CompleteProfile;
