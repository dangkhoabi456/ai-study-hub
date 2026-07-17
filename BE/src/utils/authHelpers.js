const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const GOOGLE_SSO_NO_PASSWORD = "GOOGLE_SSO_NO_PASSWORD";
const OTP_EXPIRY_MINUTES = 10;
const ACCESS_TOKEN_EXPIRY = "30m";
const SETUP_TOKEN_EXPIRY = "15m";
const PASSWORD_RESET_TOKEN_EXPIRY = "15m";

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured on the backend.");
  }
  return process.env.JWT_SECRET;
}

function normalizeEmail(email) {
  if (typeof email !== "string") {
    throw new Error("Email không hợp lệ");
  }
  const cleanEmail = email.trim().toLowerCase();
  const emailRegex = /^(?!.*\.\.)[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?!(?:.*\.)?-)[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i;
  if (!emailRegex.test(cleanEmail)) {
    throw new Error("Email không hợp lệ");
  }
  return cleanEmail;
}

function normalizeUsername(username) {
  if (typeof username !== "string") {
    throw new Error("Username không hợp lệ");
  }
  return username.trim();
}

function validateUsername(username) {
  const cleanUsername = normalizeUsername(username);
  if (
    !/^[A-Za-z0-9_][A-Za-z0-9_.]{1,28}[A-Za-z0-9_]$/.test(cleanUsername) ||
    cleanUsername.includes("..")
  ) {
    return {
      valid: false,
      message:
        "Username phải từ 3-30 ký tự, chỉ chứa chữ cái, số, dấu gạch dưới hoặc dấu chấm.",
    };
  }
  return { valid: true, username: cleanUsername };
}
function validatePassword(password) {
  if (typeof password !== "string" || password.trim() === "") {
    return {
      valid: false,
      message: "Mật khẩu là thông tin bắt buộc.",
    };
  }
  const passwordRegex = /^(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,}$/;
  if (!passwordRegex.test(password)) {
    return {
      valid: false,
      message:
        "Mật khẩu cần >= 8 ký tự, có ít nhất 1 chữ thường, 1 số, 1 ký tự đặc biệt và không chứa khoảng trắng.",
    };
  }
  return { valid: true };
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

function signAccessToken(user) {
  if (!user?.id || !user?.session_id) {
    throw new Error("A user id and session id are required to issue an access token.");
  }

  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role || "USER",
      status: user.status || "ACTIVE",  
      session_id: user.session_id
    },
    getJwtSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  );
}

function signSetupToken(email) {
  const normalizedEmail = normalizeEmail(email);
  return jwt.sign(
    {
      email: normalizedEmail,
      type: "complete_setup",
    },
    getJwtSecret(),
    { expiresIn: SETUP_TOKEN_EXPIRY },
  );
}

function signPasswordResetToken(email) {
  const normalizedEmail = normalizeEmail(email);
  return jwt.sign(
    {
      email: normalizedEmail,
      type: "password_reset",
    },
    getJwtSecret(),
    { expiresIn: PASSWORD_RESET_TOKEN_EXPIRY },
  );
}

function buildPublicUser(user) {
  if (!user) return null;

  return{
    id: user.id,
    email: user.email,
    username: user.username,
    full_name: user.full_name,
    role: user.role || "USER",
    status: user.status || "ACTIVE",
    };
}

function verifySetupToken(setupToken, expectedEmail) {
    if (!setupToken) {
        throw new Error('Phiên xác minh OTP không hợp lệ hoặc đã hết hạn.');
    }
    const payload = jwt.verify(setupToken, getJwtSecret());

    if (payload.type !== 'complete_setup' || payload.email !== normalizeEmail(expectedEmail)) {
        throw new Error('Phiên xác minh OTP không hợp lệ hoặc đã hết hạn.');
    }
    return payload;
}

function verifyPasswordResetToken(resetToken, expectedEmail) {
  if (!resetToken) {
    throw new Error("Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.");
  }

  const payload = jwt.verify(resetToken, getJwtSecret());

  if (payload.type !== "password_reset" || payload.email !== normalizeEmail(expectedEmail)) {
    throw new Error("Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.");
  }

  return payload;
}

module.exports = {
    GOOGLE_SSO_NO_PASSWORD,
    OTP_EXPIRY_MINUTES,
    normalizeEmail,
    normalizeUsername,
    validateUsername,
    validatePassword,
    generateOtp,
    getOtpExpiryDate,
    hashPassword,
    signAccessToken,
    signSetupToken,
    signPasswordResetToken,
    verifySetupToken,
    verifyPasswordResetToken,
    buildPublicUser,
};
