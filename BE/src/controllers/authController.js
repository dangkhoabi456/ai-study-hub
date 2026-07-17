const authService = require('../services/authService');
const supabase = require('../config/supabase');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const {
    signAccessToken,
    buildPublicUser,
} = require("../utils/authHelpers");

exports.googleLogin = async (req, res) => {
    try {
        const { token } = req.body;
        const result = await authService.verifyAndLoginGoogle(token);
        res.status(200).json({ status: 'success', data: result });
    } catch (error) {
        // THÊM DÒNG NÀY ĐỂ BIẾT LỖI TẠI ĐÂU:
        console.error("🔴 LỖI BACKEND GOOGLE LOGIN:", error);
        res.status(401).json({ status: 'error', message: 'Token Google không hợp lệ', error: error.message });
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

        console.log(`[DRY RUN] Đang kiểm tra: Email="${cleanEmail}", OTP="${cleanOtp}"`);

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
                message: 'Tài khoản không ở trạng thái chờ hoàn tất hồ sơ.'
            });
        }

        // ======================================================
        // 3. KIỂM TRA OTP CÓ ĐÚNG VÀ CÒN HẠN KHÔNG
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
            console.error("🔴 Lỗi truy vấn Supabase:", error);
            throw error;
        }

        console.log(`[DRY RUN] Record tìm thấy:`, otpRecord);

        if (!otpRecord) {
            return res.status(400).json({
                status: 'error',
                message: 'Mã OTP không hợp lệ hoặc đã hết hạn.'
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
            message: error.message
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
                message: "Phiên xác minh OTP không hợp lệ hoặc đã hết hạn."
            });
        }

        if (payload.type !== "complete_setup" || payload.email !== cleanEmail) {
            return res.status(401).json({
                status: "error",
                message: "Phiên xác minh OTP không hợp lệ hoặc đã hết hạn."
            });
        }

        // ======================================================
        // 3. KIỂM TRA USERNAME
        // ======================================================
        if (!cleanUsername || cleanUsername.length < 3) {
            return res.status(400).json({
                status: "error",
                message: "Username phải có ít nhất 3 ký tự."
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
                message: 'Username đã được sử dụng.'
            });
        }

        // ======================================================
        // 4. KIỂM TRA PASSWORD
        // ======================================================
        if (!password || password.trim() === "") {
            return res.status(400).json({
                status: 'error',
                message: 'Mật khẩu là thông tin bắt buộc.'
            });
        }

        const regex = /^(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,}$/;

        if (!regex.test(password)) {
            return res.status(400).json({
                status: 'error',
                message: 'Mật khẩu không đạt yêu cầu bảo mật.'
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
                message: "Không thể hoàn tất hồ sơ. Tài khoản có thể đã được thiết lập trước đó."
            });
        }

        // ======================================================
        // 7. TẠO ACCESS TOKEN ĐỂ FRONTEND VÀO DASHBOARD
        // ======================================================
        const currentSessionId = crypto.randomUUID();
        const { error: sessionError } = await supabase
            .from('profiles')
            .update({
                session_id: currentSessionId,
                last_login_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', updatedUser.id);

        if (sessionError) throw sessionError;

        updatedUser.session_id = currentSessionId;
        const accessToken = signAccessToken(updatedUser);

        res.status(200).json({
            status: 'success',
            message: 'Cập nhật thành công',
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
        const { username, password } = req.body;

        // 1. Phân giải truy vấn: Tìm kiếm linh hoạt theo Username HOẶC Email
        const { data: user, error } = await supabase
            .from('profiles')
            .select('*')
            .or(`username.eq.${username},email.eq.${username}`)
            .maybeSingle();

        if (error) throw error;

        // Trạng thái: Không tìm thấy con trỏ user
        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Tài khoản không tồn tại.' });
        }

        // Trạng thái: Chặn tài khoản chưa setup pass (chỉ mới login Google 1 nửa)
        if (user.password_hash === 'GOOGLE_SSO_NO_PASSWORD') {
            return res.status(401).json({ 
                status: 'error', 
                message: 'Tài khoản này chưa hoàn tất thiết lập mật khẩu. Vui lòng đăng nhập qua Google.' });
        }
        if (user.status === "DISABLED") {
            return res.status(403).json({
                status: "error",
                message: "Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên."
            });
        }

        // 2. Phân tích vùng nhớ Password
        // Nạp chuỗi thô (password) và chuỗi hash từ DB (user.password_hash) vào thuật toán bcrypt
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ status: 'error', message: 'Mật khẩu không chính xác.' });
        }

        // 3. Tạo session_id ngẫu nhiên
        const currentSessionId = crypto.randomUUID();
        
        // 4. Gán session_id vào object user để đưa vào payload của Token
        user.session_id = currentSessionId;

        // 5. Cấp phát Token
        const accessToken = signAccessToken(user);

        await supabase
            .from("profiles")
            .update({
                last_login_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                session_id: currentSessionId
            })
            .eq("id", user.id);
            
        res.status(200).json({
            status: "success",
            data:{
                accessToken,
                user: buildPublicUser(user),
            },
        });
    } catch (error) {
        console.error("🔴 Lỗi hệ thống Login:", error);
        res.status(500).json({ status: 'error', message: error.message });
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
            return res.status(404).json({ status: 'error', message: 'Email này chưa được đăng ký trong hệ thống.' });
        }
        if (user.password_hash === 'GOOGLE_SSO_NO_PASSWORD') {
            return res.status(400).json({ status: 'error', message: 'Tài khoản này đăng nhập bằng Google. Không thể đổi mật khẩu.' });
        }

        // 2. Cấp phát OTP vào bảng otp_tokens
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60000); // 10 phút

        await supabase.from('otp_tokens').insert([{
            email: cleanEmail,
            otp_code: otpCode,
            expires_at: expiresAt.toISOString()
        }]);

        // 3. Khởi tạo cấu trúc gửi Mail (Tái sử dụng config hiện có)
        const transporter = require('nodemailer').createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT) || 2525,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: cleanEmail,
            subject: 'AI StudyHub - Password Reset Code',
            text: `Mã OTP khôi phục mật khẩu của bạn là: ${otpCode}. Mã hết hạn sau 10 phút.`
        });

        res.status(200).json({ status: 'success', message: 'Mã OTP đã được gửi đến email.' });
    } catch (error) {
        console.error("🔴 Lỗi forgotPassword:", error);
        res.status(500).json({ status: 'error', message: error.message });
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
                message: "Thông tin khôi phục không hợp lệ hoặc tài khoản không hỗ trợ đặt lại mật khẩu."
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
                message: "Mã OTP không hợp lệ hoặc đã hết hạn."
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
            message: "Xác minh OTP thành công.",
            data: {
                email: cleanEmail,
                resetToken
            }
        });
    } catch (error) {
        console.error("🔴 Lỗi verifyResetPasswordOTP:", error);
        return res.status(500).json({
            status: "error",
            message: error.message
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
                message: "Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn."
            });
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,}$/;
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({
                status: "error",
                message: "Mật khẩu cần >= 8 ký tự, có ít nhất 1 chữ thường, 1 số, 1 ký tự đặc biệt và không chứa khoảng trắng."
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
                message: "Thông tin khôi phục không hợp lệ hoặc tài khoản không hỗ trợ đặt lại mật khẩu."
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
            message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại."
        });
    } catch (error) {
        console.error("🔴 Lỗi resetPassword:", error);
        res.status(500).json({
            status: "error",
            message: error.message
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
      return res.status(400).json({ status: "error", message: "ID người dùng không hợp lệ." });
    }

    // 1. Lấy thông tin tài khoản người dùng từ bảng profiles
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, date_of_birth, is_dob_public")
      .eq("id", id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (profileError) throw profileError;
    
    if (!profile) {
      return res.status(404).json({ status: "error", message: "Không tìm thấy người dùng này trong hệ thống." });
    }

    // 2. Lấy danh sách thư viện được cấu hình công khai (is_public = true) của user đó
    const { data: libraries, error: libError } = await supabase
      .from("libraries")
      .select("id, name, description, created_at")
      .eq("user_id", id)
      .eq("share_on_profile", true)
      .eq("is_public", true);

    if (libError) {
      console.warn("Không thể tải danh sách libraries cá nhân, bỏ qua lỗi này:", libError);
    }

    // Trả về cấu trúc dữ liệu đồng bộ cho Frontend nhận diện
    return res.status(200).json({
      status: "success",
      data: {
        profile,
        libraries: libraries || []
      }
    });

  } catch (error) {
    console.error("Lỗi hệ thống tại getUserProfileById:", error);
    return res.status(500).json({ status: "error", message: "Lỗi xử lý server nội bộ.", error: error.message });
  }
};

exports.logout = async (req, res) => {
  return res.status(200).json({
    status: "success",
    message: "Logged out successfully.",
  });
};
