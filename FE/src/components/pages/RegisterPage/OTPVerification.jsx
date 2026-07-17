import { useState } from "react";
import FormInput from "../../common/FormInput/FormInput.jsx";
import api from "../../../utils/api.js";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import "./Register.css";

function OTPVerification() {
  const navigate = useNavigate();
  const location = useLocation();
  const [otp, setOtp] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Trích xuất email từ History State
  const email = location.state?.email;

  // Nếu người dùng truy cập trực tiếp bằng URL /verify-otp mà không qua form, đẩy về login
  if (!email) {
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post("/auth/verify-otp", { email, otp });
      if (res.data.data.requiresSetup) {
        // Tiếp tục truyền email sang trang hoàn tất hồ sơ
        navigate('/complete-profile',{
          state: {
            email: res.data.data.email,
            setupToken: res.data.data.setupToken
          }
        });
      }
    } catch (error) {
      setErrorMsg(error.response?.data?.message || "Invalid OTP.");
    }
  };

  return (
    <div className="register_page">
      <form className="register_form" onSubmit={handleSubmit} style={{ backgroundColor: 'var(--bg-card)', padding: '30px', borderRadius: '15px' }}>
        <p className="register_title">Email Verification</p>
        <p className="register_message">Please enter the 6-digit code sent to <b>{email}</b></p>
        <FormInput
          type="text"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="Enter OTP Code"
        />
        {errorMsg && <p style={{ color: "var(--danger-color)", fontSize: "14px" }}>{errorMsg}</p>}
        <button className="register_submit" style={{ width: '100%', padding: '10px', backgroundColor: 'var(--button-bg)', color: 'var(--button-text)' }} type="submit">Verify OTP</button>
      </form>
    </div>
  );
}

export default OTPVerification;
