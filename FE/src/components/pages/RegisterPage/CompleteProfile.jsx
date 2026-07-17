import { useState, useEffect } from "react";
import FormInput from "../../common/FormInput/FormInput.jsx";
import api from "../../../utils/api.js";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import "./Register.css";

function CompleteProfile() {
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({ username: "", password: "" });
  const [usernameStatus, setUsernameStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const email = location.state?.email;
  const setupToken = location.state?.setupToken;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  useEffect(() => {
    if (!email || !setupToken) return undefined;

    const delayDebounceFn = setTimeout(async () => {
      if (formData.username.trim() !== "") {
        try {
          const res = await api.get(
            `/auth/check-username?username=${encodeURIComponent(formData.username)}`,
          );
          if (res.data.exists) {
            setUsernameStatus("❌ Username này đã tồn tại.");
          } else {
            setUsernameStatus("✅ Username hợp lệ.");
          }
        } catch {
          console.error("Lỗi kiểm tra username");
        }
      } else {
        setUsernameStatus("");
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [email, formData.username, setupToken]);

  if (!email || !setupToken) {
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!formData.username) return setErrorMsg("Username là bắt buộc!");
    if (usernameStatus.includes("❌"))
      return setErrorMsg("Vui lòng chọn Username khác.");
    if (!formData.password) return setErrorMsg("Mật khẩu là bắt buộc!");

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
        localStorage.setItem(
          "aiStudyHubProfileName",
          user.username || user.full_name || user.email || "User",
        );
      }

      navigate("/dashboard/home", { replace: true });
    } catch (error) {
      setErrorMsg(error.response?.data?.message || "Lỗi cập nhật.");
    }
  };

  return (
    <div className="register_page">
      <form className="register_card" onSubmit={handleSubmit}>
        <p className="register_title">Hoàn tất hồ sơ</p>

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
          Mật khẩu cần &gt;= 8 ký tự, 1 chữ thường, 1 số, 1 ký tự đặc biệt.
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
          Hoàn tất
        </button>
      </form>
    </div>
  );
}

export default CompleteProfile;
