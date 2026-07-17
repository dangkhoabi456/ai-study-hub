import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google"; // Thêm import GoogleOAuthProvider
import api from "../../../utils/api.js";
import { useNavigate } from "react-router-dom";
import "./Register.css";

// Khai báo trực tiếp Client ID tại đây
const GOOGLE_CLIENT_ID = "816282057609-4clrdj4f4mp1jh72m40ffaf04fne6vhe.apps.googleusercontent.com";

function Register() {
  const navigate = useNavigate();

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const googleToken = credentialResponse.credential;
      const res = await api.post("/auth/google", { token: googleToken });

      if (res.data.data.requiresOTP) {
        navigate('/verify-otp', { state: { email: res.data.data.email } });
      } else {
        localStorage.setItem("accessToken", res.data.data.accessToken);
        alert("Login Successful!");
        navigate('/dashboard');
      }
    } catch (error) {
      console.error("Backend registration error:", error);
      alert("Registration failed.");
    }
  };

  return (
    <div className="register_page">
      <div className="register_card">
        <p className="register_title">Register</p>
        <p className="register_message">
          Sign up instantly using your Google account to secure and access your profile.
        </p>
        <div className="account_link_container">
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
            {/* Bọc Provider quanh nút GoogleLogin */}
            <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
              <GoogleLogin onSuccess={handleGoogleSuccess} onError={() => console.log("Google Auth Error")} />
            </GoogleOAuthProvider>
          </div>
        </div>
        <p className="register_signin">
          Already have an account?
          <span
            onClick={() => navigate('/login')}
            style={{ color: 'var(--accent-color)', cursor: 'pointer', textDecoration: 'underline', marginLeft: '5px', fontWeight: '500' }}
          >
            Sign in
          </span>
        </p>
      </div>
    </div>
  );
}

export default Register;
