import { useState } from "react";
import FormInput from "../../common/FormInput/FormInput.jsx";
import api from "../../../utils/api.js";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import "./LoginPage.css";


function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();

  const email = location.state?.email;

  const [formData, setFormData] = useState({
    otp: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [resetToken, setResetToken] = useState("");
  const isOtpVerified = Boolean(resetToken);

  if (!email) {
    return <Navigate to="/forgot-password" replace />;
  }

  const handleChange = (e) => {
    const nextValue =
      e.target.name === "otp"
        ? e.target.value.replace(/\D/g, "").slice(0, 6)
        : e.target.value;

    setFormData({
      ...formData,
      [e.target.name]: nextValue,
    });
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!formData.otp.trim()) {
      return setErrorMsg("Please enter OTP.");
    }

    try {
      setLoading(true);

      const response = await api.post("/auth/verify-reset-otp", {
        email,
        otp: formData.otp,
      });

      setResetToken(response.data.data.resetToken);
    } catch (error) {
      setErrorMsg(error.response?.data?.message || "Failed to verify OTP.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!formData.newPassword) {
      return setErrorMsg("Please enter new password.");
    }

    if (formData.newPassword !== formData.confirmPassword) {
      return setErrorMsg("Passwords do not match.");
    }

    try {
      setLoading(true);

      await api.post("/auth/reset-password", {
        email,
        resetToken,
        newPassword: formData.newPassword,
      });
      alert("Password changed successfully. Please log in again.");
      navigate("/login", { replace: true });
    } catch (error) {
      setErrorMsg(error.response?.data?.message || "Failed to change password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login_page">
      <form
        className="login_form"
        onSubmit={isOtpVerified ? handleResetPassword : handleVerifyOTP}
      >
        <p className="login_title">Reset Password</p>

        <p
          className="login_message"
          style={{ textAlign: "left", marginBottom: "15px" }}
        >
          {isOtpVerified ? (
            <>OTP verified. Please enter a new password for <b>{email}</b>.</>
          ) : (
            <>Enter the 6-digit OTP code sent to <b>{email}</b>.</>
          )}
        </p>
        <div className="login_flex">
          {!isOtpVerified ? (
            <FormInput
              type="text"
              name="otp"
              label="OTP"
              value={formData.otp}
              onChange={handleChange}
              required
            />
          ) : (
            <>
              <FormInput
                type="password"
                name="newPassword"
                label="New Password"
                value={formData.newPassword}
                onChange={handleChange}
                required
              />
              <FormInput
                type="password"
                name="confirmPassword"
                label="Confirm Password"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
              />
            </>
          )}
        </div>
        {isOtpVerified && (
          <p
            className="login_message"
            style={{ fontSize: "13px", color: "var(--text-secondary)", textAlign: "left" }}
          >
            New password must be at least 8 characters, including lowercase letters, numbers, and special
            characters.
          </p>
        )}
        {errorMsg && (
          <p style={{ color: "red", textAlign: "center", fontSize: "14px" }}>
            {errorMsg}
          </p>
        )}
        <button className="login_submit" type="submit" disabled={loading}>
          {loading
            ? "Processing..."
            : isOtpVerified
              ? "Change Password"
              : "Verify OTP"}
        </button>
        <p className="login_message" style={{ marginTop: "20px" }}>
          <span
            onClick={() => navigate("/login")}
            style={{
              color: "var(--accent-color)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Back to login
          </span>
        </p>
      </form>
    </div>
  );
}

export default ResetPassword;
