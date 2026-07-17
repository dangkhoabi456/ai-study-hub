import { useState } from "react";
import FormInput from "../../common/FormInput/FormInput.jsx";
import api from "../../../utils/api.js";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setNotice(null);
    
    try {
      await api.post("/auth/forgot-password", { email });
      navigate("/reset-password", { state: { email } });
    } catch (error) {
      setNotice({
        type: "error",
        title: "Failed to send OTP",
        message: error.response?.data?.message || "System error. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login_page">
      <form className="login_form" onSubmit={handleSubmit}>
        <p className="login_title">Forgot Password</p>
        <p className="login_message" style={{textAlign: "left", marginBottom: "15px"}}>
          Enter your registered email. The system will send a 6-digit OTP code to verify.
        </p>

        {notice && (
          <div className={`login_notice ${notice.type}`} role="alert">
            <strong>{notice.title}</strong>
            <span>{notice.message}</span>
          </div>
        )}
        
        <div className="login_flex">
          <FormInput
            type="email"
            label="Registered Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <button className="login_submit" type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send OTP"}
        </button>

        <p className="login_message" style={{marginTop: "20px"}}>
          <span onClick={() => navigate('/login')} style={{ color: 'var(--accent-color)', cursor: 'pointer', textDecoration: 'underline' }}>
            Back to Login
          </span>
        </p>
      </form>
    </div>
  );
}

export default ForgotPassword;
