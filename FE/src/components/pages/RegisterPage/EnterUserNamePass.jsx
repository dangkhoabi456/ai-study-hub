import { useState } from "react";
import "./Register.css";
import FormInput from "../../common/FormInput/FormInput.jsx";

function EnterUserNamePass() {
  // 2. Tạo State để lưu trữ dữ liệu trong bộ nhớ
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    // Dry Run kiểm tra giá trị khi bấm Submit
    console.log("Dữ liệu chuẩn bị gửi đi:", { username, password });
  };

  return (
    <div className="register_page">
      <form className="register_form" onSubmit={handleSubmit}>
        <p className="register_title">Register</p>
        <div className="register_flex">
          <FormInput
            type="text"
            className="username_input"
            // 3. Liên kết State với Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username or gmail"
          />

          <FormInput
            type="password"
            placeholder="Password"
            className="password_input"
            // 3. Liên kết State với Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="register_submit" type="submit">Submit</button>

      </form>
    </div>
  );
}

export default EnterUserNamePass;
