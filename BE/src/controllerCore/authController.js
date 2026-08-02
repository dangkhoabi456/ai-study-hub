const authService = require('../services/authService');
const { createMailTransporter } = require('../utils/mailerService');
const supabase = require('../config/supabase');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    buildPublicUser,
} = require("../utils/authHelpers");

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function getRefreshCookieOptions() {
    const isProduction = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        path: "/api/auth",
    };
}

function getCookie(req, name) {
    const cookies = String(req.headers.cookie || "").split(";");
    const prefix = `${name}=`;
    const cookie = cookies.map((value) => value.trim()).find((value) => value.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function setRefreshCookie(res, refreshToken, rememberMe = true) {
    const options = getRefreshCookieOptions();
    if (rememberMe) options.maxAge = REFRESH_COOKIE_MAX_AGE;
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, options);
}

function clearRefreshCookie(res) {
    res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOptions());
}

exports.googleLogin = async (req, res) => {
    try {
        const { token, rememberMe = false } = req.body;
        const result = await authService.verifyAndLoginGoogle(token);
        if (result.refreshToken) {
            const user = verifyRefreshToken(result.refreshToken);
            setRefreshCookie(
                res,
                signRefreshToken({ id: user.userId, session_id: user.session_id }, rememberMe),
                rememberMe,
            );
            delete result.refreshToken;
        }
        res.status(200).json({ status: 'success', data: result });
    } catch (error) {
        console.error("🔴 GOOGLE LOGIN BACKEND ERROR:", error);
        const errMsg = String(error?.message || "").toLowerCase();
        const isTokenError =
            errMsg.includes("token") ||
            errMsg.includes("invalid") ||
            errMsg.includes("jwt") ||
            errMsg.includes("audience") ||
            errMsg.includes("signature") ||
            errMsg.includes("segment") ||
            errMsg.includes("oauth");

        return res.status(isTokenError ? 401 : 400).json({
            status: 'error',
            message: isTokenError ? 'Invalid Google token.' : (error.message || 'Google authentication failed.')
        });
    }
};

exports.verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        // ======================================================
        // 1. CHUẨN HÓA EMAIL VÀ OTP
        // ======================================================
        const cleanEmail = email.toLowerCase().trim();
        const cleanOtp = String(otp || "").trim();


        // ======================================================
        // 2. KIỂM TRA TÀI KHOẢN CÓ ĐANG CHỜ COMPLETE PROFILE KHÔNG
        // ======================================================
        const { data: user, error: userError } = await supabase
            .from('profiles')
            .select('id, email, password_hash')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (userError) {
            throw userError;
        }

        if (!user || user.password_hash !== 'GOOGLE_SSO_NO_PASSWORD') {
            return res.status(400).json({
                status: 'error',
                message: 'Account is not pending profile completion.'
            });
        }

        // ======================================================
        // 3. CHECK IF OTP IS VALID AND NOT EXPIRED
        // ======================================================
        const { data: otpRecord, error } = await supabase
            .from('otp_tokens')
            .select('*')
            .eq('email', cleanEmail)
            .eq('otp_code', cleanOtp)
            .gte('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("🔴 Supabase query error:", error);
            throw error;
        }

        if (!otpRecord) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid or expired OTP code.'
            });
        }

        // ======================================================
        // 4. XÓA OTP SAU KHI DÙNG
        // ======================================================
        await supabase
            .from('otp_tokens')
            .delete()
            .eq('id', otpRecord.id);

        // ======================================================
        // 5. TẠO SETUP TOKEN SAU KHI OTP ĐÚNG
        // ======================================================
        const setupToken = jwt.sign(
            {
                email: cleanEmail,
                type: 'complete_setup'
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '15m'
            }
        );

        // ======================================================
        // 6. TRẢ SETUP TOKEN VỀ FRONTEND
        // ======================================================
        res.status(200).json({
            status: 'success',
            data: {
                email: cleanEmail,
                requiresSetup: true,
                setupToken: setupToken
            }
        });
    } catch (error) {
        console.error("🔴 Lỗi hệ thống verifyOTP:", error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error. Please try again.'
        });
    }
};
exports.checkUsername = async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ error: 'Missing username' });

        const { data: existingUser } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', username)
            .single();

        return res.status(200).json({ exists: !!existingUser });
    } catch (error) {
        res.status(500).json({ error: 'Database check failed' });
    }
};

exports.completeSetup = async (req, res) => {
    try {
        const { email, username, password, setupToken } = req.body;

        // ======================================================
        // 1. CHUẨN HÓA EMAIL
        // ======================================================
        const cleanEmail = email.toLowerCase().trim();
        const cleanUsername = username.trim();

        // ======================================================
        // 2. KIỂM TRA SETUP TOKEN
        // ======================================================
        // Token này chỉ có sau khi user nhập OTP đúng.
        // Nếu không có token này thì không cho complete profile.
        let payload;

        try {
            payload = jwt.verify(setupToken, process.env.JWT_SECRET);
        } catch (tokenError) {
            return res.status(401).json({
                status: "error",
                message: "OTP verification session is invalid or has expired."
            });
        }

        if (payload.type !== "complete_setup" || payload.email !== cleanEmail) {
            return res.status(401).json({
                status: "error",
                message: "OTP verification session is invalid or has expired."
            });
        }

        // ======================================================
        // 3. KIỂM TRA USERNAME
        // ======================================================
        if (!cleanUsername || cleanUsername.length < 3) {
            return res.status(400).json({
                status: "error",
                message: "Username must be at least 3 characters long."
            });
        }

        const { data: existingUser, error: existingError } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', cleanUsername)
            .neq('email', cleanEmail)
            .maybeSingle();

        if (existingError) {
            throw existingError;
        }

        if (existingUser) {
            return res.status(400).json({
                status: 'error',
                message: 'Username is already taken.'
            });
        }

        // ======================================================
        // 4. CHECK PASSWORD
        // ======================================================
        if (!password || password.trim() === "") {
            return res.status(400).json({
                status: 'error',
                message: 'Password is required.'
            });
        }

        const regex = /^(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,}$/;

        if (!regex.test(password)) {
            return res.status(400).json({
                status: 'error',
                message: 'Password does not meet security requirements.'
            });
        }

        // ======================================================
        // 5. HASH PASSWORD
        // ======================================================
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // ======================================================
        // 6. UPDATE PROFILE
        // ======================================================
        // Chỉ update account đang có password_hash = GOOGLE_SSO_NO_PASSWORD.
        // Như vậy account đã setup rồi sẽ không bị ghi đè.
        const { data: updatedUser, error: updateError } = await supabase
            .from('profiles')
            .update({
                username: cleanUsername,
                password_hash: passwordHash
            })
            .eq('email', cleanEmail)
            .eq('password_hash', 'GOOGLE_SSO_NO_PASSWORD')
            .select('id, email, username, full_name, role, status')
            .maybeSingle();

        if (updateError) {
            throw updateError;
        }

        if (!updatedUser) {
            return res.status(400).json({
                status: "error",
                message: "Unable to complete profile setup. Account may have already been configured."
            });
        }

        // ======================================================
        // 7. CREATE ACCESS TOKEN FOR DASHBOARD ENTRY
        // ======================================================
        const currentSessionId = crypto.randomUUID();
        updatedUser.session_id = currentSessionId;

        const { error: sessionError } = await supabase
            .from("profiles")
            .update({
                session_id: currentSessionId,
                last_login_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("id", updatedUser.id);

        if (sessionError) throw sessionError;

        const accessToken = signAccessToken(updatedUser);
        setRefreshCookie(res, signRefreshToken(updatedUser));

        res.status(200).json({
            status: 'success',
            message: 'Update successful',
            data: {
                accessToken,
                user: buildPublicUser(updatedUser),
            }
        });
    } catch (error) {
        console.error("🔴 Lỗi completeSetup:", error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

exports.login = async (req, res) => {
    try {
        const { username, password, rememberMe = false } = req.body;

        // 1. Phân giải truy vấn: Tìm kiếm linh hoạt theo Username HOẶC Email
        const { data: user, error } = await supabase
            .from('profiles')
            .select('*')
            .or(`username.eq.${username},email.eq.${username}`)
            .maybeSingle();

        if (error) throw error;

        // Trạng thái: Không tìm thấy con trỏ user
        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Account does not exist.' });
        }

        // Status: Block account that has not set up password (only completed half of Google login)
        if (user.password_hash === 'GOOGLE_SSO_NO_PASSWORD') {
            return res.status(401).json({
                status: 'error',
                message: 'Password setup for this account is incomplete. Please sign in with Google.' });
        }
        if (user.status === "DISABLED") {
            return res.status(403).json({
                status: "error",
                message: "Your account has been disabled. Please contact an administrator."
            });
        }

        // 2. Password matching check
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({
                status: 'error',
                code: 'WRONG_PASSWORD',
                message: 'Incorrect password. Please check your password or choose Forgot Password to reset.'
            });
        }

        // 3. Tạo session_id ngẫu nhiên
        const currentSessionId = crypto.randomUUID();

        // 4. Gán session_id vào object user để đưa vào payload của Token
        user.session_id = currentSessionId;

        // 5. Cấp phát Token
        const accessToken = signAccessToken(user);

        const { error: sessionError } = await supabase
            .from("profiles")
            .update({
                last_login_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                session_id: currentSessionId
            })
            .eq("id", user.id);

        if (sessionError) throw sessionError;

        setRefreshCookie(res, signRefreshToken(user, rememberMe), rememberMe);

        res.status(200).json({
            status: "success",
            data:{
                accessToken,
                user: buildPublicUser(user),
            },
        });
    } catch (error) {
        console.error("🔴 Lỗi hệ thống Login:", error);
        res.status(500).json({ status: 'error', message: 'Internal server error. Please try again.' });
    }
};

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const cleanEmail = email.toLowerCase().trim();

        // 1. Truy xuất con trỏ User trong bộ nhớ DB
        const { data: user } = await supabase
            .from('profiles')
            .select('id, email, password_hash')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'This email is not registered in our system.' });
        }
        if (user.password_hash === 'GOOGLE_SSO_NO_PASSWORD') {
            return res.status(400).json({ status: 'error', message: 'This account signs in with Google. Password cannot be changed.' });
        }

        // 2. Issue OTP to otp_tokens table
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes

        await supabase.from('otp_tokens').insert([{
            email: cleanEmail,
            otp_code: otpCode,
            expires_at: expiresAt.toISOString()
        }]);

        // 3. Send password recovery OTP email
        const transporter = createMailTransporter();

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: cleanEmail,
            subject: 'AI StudyHub - Password Reset Code',
            text: `Your password reset code is: ${otpCode}. The code expires in 10 minutes.`
        });

        res.status(200).json({
            status: 'success',
            code: 'OTP_SENT',
            message: 'OTP code has been sent to your email. Valid for 10 minutes.'
        });
    } catch (error) {
        console.error("🔴 Lỗi forgotPassword:", error);
        res.status(500).json({ status: 'error', message: 'Internal server error. Please try again.' });
    }
};

exports.verifyResetPasswordOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const cleanEmail = email.toLowerCase().trim();
        const cleanOtp = String(otp || "").trim();

        const { data: user, error: userError } = await supabase
            .from("profiles")
            .select("id, email, password_hash")
            .eq("email", cleanEmail)
            .maybeSingle();

        if (userError) throw userError;

        if (!user || user.password_hash === "GOOGLE_SSO_NO_PASSWORD") {
            return res.status(400).json({
                status: "error",
                message: "Invalid recovery information or account does not support password reset."
            });
        }

        const { data: otpRecord, error: otpError } = await supabase
            .from("otp_tokens")
            .select("*")
            .eq("email", cleanEmail)
            .eq("otp_code", cleanOtp)
            .gte("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (otpError) throw otpError;

        if (!otpRecord) {
            return res.status(400).json({
                status: "error",
                message: "Invalid or expired OTP code."
            });
        }

        await supabase
            .from("otp_tokens")
            .delete()
            .eq("id", otpRecord.id);

        const { signPasswordResetToken } = require("../utils/authHelpers");
        const resetToken = signPasswordResetToken(cleanEmail);

        return res.status(200).json({
            status: "success",
            message: "OTP verification successful.",
            data: {
                email: cleanEmail,
                resetToken
            }
        });
    } catch (error) {
        console.error("🔴 Lỗi verifyResetPasswordOTP:", error);
        return res.status(500).json({
            status: "error",
            message: 'Internal server error. Please try again.'
        });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { email, resetToken, newPassword } = req.body;

        const cleanEmail = email.toLowerCase().trim();

        const { verifyPasswordResetToken } = require("../utils/authHelpers");

        try {
            verifyPasswordResetToken(resetToken, cleanEmail);
        } catch {
            return res.status(401).json({
                status: "error",
                message: "Password reset session is invalid or has expired."
            });
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,}$/;
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({
                status: "error",
                message: "Password must be >= 8 characters, contain at least 1 lowercase letter, 1 number, 1 special character, and no spaces."
            });
        }

        const { data: user, error: userError } = await supabase
            .from("profiles")
            .select("id, email, password_hash")
            .eq("email", cleanEmail)
            .maybeSingle();

        if (userError) throw userError;

        if (!user || user.password_hash === "GOOGLE_SSO_NO_PASSWORD") {
            return res.status(400).json({
                status: "error",
                message: "Invalid recovery information or account does not support password reset."
            });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);

        const { error: updateError } = await supabase
            .from("profiles")
            .update({ password_hash: passwordHash })
            .eq("id", user.id);

        if (updateError) throw updateError;

        res.status(200).json({
            status: "success",
            message: "Password reset successful. Please sign in again."
        });
    } catch (error) {
        console.error("🔴 Lỗi resetPassword:", error);
        res.status(500).json({
            status: "error",
            message: 'Internal server error. Please try again.'
        });
    }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        status: "error",
        message: "Current password and new password are required.",
      });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        status: "error",
        message: "New password must contain at least 8 characters, one lowercase letter, one number, and one special character.",
      });
    }

    const { data: user, error } = await supabase
      .from("profiles")
      .select("id, password_hash")
      .eq("id", req.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!user || user.password_hash === "GOOGLE_SSO_NO_PASSWORD") {
      return res.status(400).json({
        status: "error",
        message: "This account does not have a password to change.",
      });
    }

    const currentPasswordMatches = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );
    if (!currentPasswordMatches) {
      return res.status(400).json({
        status: "error",
        code: "WRONG_PASSWORD",
        message: "Current password is incorrect.",
      });
    }

    const reusesCurrentPassword = await bcrypt.compare(
      newPassword,
      user.password_hash,
    );
    if (reusesCurrentPassword) {
      return res.status(400).json({
        status: "error",
        message: "New password must be different from the current password.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq("id", req.user.id);

    if (updateError) throw updateError;

    return res.status(200).json({
      status: "success",
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({
      status: "error",
      message: "Unable to change password. Please try again.",
    });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const { password, confirmation } = req.body || {};

    if (confirmation !== "DELETE") {
      return res.status(400).json({
        status: "error",
        message: 'Type "DELETE" to confirm account deletion.',
      });
    }

    const { data: user, error } = await supabase
      .from("profiles")
      .select("id, password_hash")
      .eq("id", req.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(404).json({ status: "error", message: "Account not found." });
    }

    if (user.password_hash !== "GOOGLE_SSO_NO_PASSWORD") {
      if (!password) {
        return res.status(400).json({
          status: "error",
          message: "Current password is required.",
        });
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatches) {
        return res.status(400).json({
          status: "error",
          code: "WRONG_PASSWORD",
          message: "Current password is incorrect.",
        });
      }
    }

    const { error: deleteError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", req.user.id);

    if (deleteError) throw deleteError;

    clearRefreshCookie(res);
    return res.status(200).json({
      status: "success",
      message: "Account deleted successfully.",
    });
  } catch (error) {
    console.error("Delete account error:", error);
    return res.status(500).json({
      status: "error",
      message: "Unable to delete the account. Related data may need to be removed first.",
    });
  }
};

exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim() === "") {
      return res.status(200).json({ status: "success", data: [] });
    }

    const keyword = `%${q.trim()}%`;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, full_name, date_of_birth, is_dob_public, email")
      .or(`username.ilike.${keyword},full_name.ilike.${keyword}`)
      .eq("status", "ACTIVE")
      .limit(20);

    if (error) throw error;

    return res.status(200).json({ status: "success", data: data || [] });
  } catch (error) {
    console.error("Lỗi searchUsers:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
};

exports.getUserProfileById = async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra đề phòng trường hợp frontend truyền nhầm chuỗi "undefined"
    if (!id || id === "undefined") {
      return res.status(400).json({ status: "error", message: "Invalid user ID." });
    }

    // 1. Get user account info from profiles table
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, bio, date_of_birth, is_dob_public, avatar_url")
      .eq("id", id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return res.status(404).json({ status: "error", message: "User not found in system." });
    }

    // 2. Get list of public libraries (is_public = true) for user
    const { data: libraries, error: libError } = await supabase
      .from("libraries")
      .select("id, name, description, created_at")
      .eq("user_id", id)
      .eq("share_on_profile", true)
      .eq("is_public", true);

    if (libError) {
      console.warn("Unable to load personal libraries, skipping:", libError);
    }

    // Return sync data structure for Frontend
    return res.status(200).json({
      status: "success",
      data: {
        profile,
        libraries: libraries || []
      }
    });

  } catch (error) {
    console.error("System error in getUserProfileById:", error);
    return res.status(500).json({ status: "error", message: "Internal server error.", error: error.message });
  }
};

exports.refresh = async (req, res) => {
  try {
    const token = getCookie(req, REFRESH_COOKIE_NAME);
    if (!token) {
      return res.status(401).json({
        status: "error",
        code: "REFRESH_TOKEN_MISSING",
        message: "Refresh session is missing.",
      });
    }

    const payload = verifyRefreshToken(token);
    const { data: user, error } = await supabase
      .from("profiles")
      .select("id, email, username, full_name, role, status, session_id")
      .eq("id", payload.userId)
      .maybeSingle();

    if (error) throw error;

    if (
      !user ||
      user.status === "DISABLED" ||
      !user.session_id ||
      user.session_id !== payload.session_id
    ) {
      clearRefreshCookie(res);
      return res.status(401).json({
        status: "error",
        code: "SESSION_EXPIRED",
        message: "The refresh session is no longer valid.",
      });
    }

    const accessToken = signAccessToken(user);
    setRefreshCookie(
      res,
      signRefreshToken(user, payload.rememberMe),
      payload.rememberMe,
    );

    return res.status(200).json({
      status: "success",
      data: {
        accessToken,
        user: buildPublicUser(user),
      },
    });
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({
      status: "error",
      code: "REFRESH_TOKEN_INVALID",
      message: "Refresh session has expired or is invalid.",
    });
  }
};

exports.logout = async (req, res) => {
  try {
    const token = getCookie(req, REFRESH_COOKIE_NAME);

    if (token) {
      try {
        const payload = verifyRefreshToken(token);
        await supabase
          .from("profiles")
          .update({ session_id: null, updated_at: new Date().toISOString() })
          .eq("id", payload.userId)
          .eq("session_id", payload.session_id);
      } catch {
        // An invalid/expired cookie still needs to be removed.
      }
    }
  } finally {
    clearRefreshCookie(res);
  }

  return res.status(200).json({
    status: "success",
    message: "Logged out successfully.",
  });
};
