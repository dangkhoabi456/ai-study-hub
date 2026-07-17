// ======================================================
// 1. IMPORT THƯ VIỆN VÀ FILE CẤU HÌNH
// ======================================================

// Dùng để verify Google token khi user đăng nhập bằng Google
const { OAuth2Client } = require('google-auth-library');

// Supabase client để query database
const supabase = require('../config/supabase');

// Nodemailer để gửi OTP qua email
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Import các helper bảo mật dùng chung
const {
    GOOGLE_SSO_NO_PASSWORD,
    OTP_EXPIRY_MINUTES,
    normalizeEmail,
    generateOtp,
    getOtpExpiryDate,
    signAccessToken,
    buildPublicUser,
} = require('../utils/authHelpers');


// ======================================================
// 2. KHỞI TẠO GOOGLE OAUTH CLIENT
// ======================================================

// GOOGLE_CLIENT_ID nằm trong file .env
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


// ======================================================
// 3. TẠO MAIL TRANSPORTER ĐỂ GỬI OTP
// ======================================================

// Hàm này tạo transporter dựa trên thông tin email trong .env
// Ví dụ dùng Mailtrap hoặc Gmail SMTP
function createMailTransporter() {
    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT, 10) || 2525,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
}


// ======================================================
// 4. TẠO USERNAME TẠM CHO USER ĐĂNG NHẬP GOOGLE LẦN ĐẦU
// ======================================================

// Khi user vừa đăng nhập Google nhưng chưa nhập username/password,
// database vẫn cần username không null.
// Vì vậy tạo username tạm dạng pending_xxxxx.
function buildTemporaryUsername(googleId) {
    return `pending_${googleId.substring(0, 8)}_${Date.now().toString().slice(-6)}`;
}


// ======================================================
// 5. XÓA OTP CŨ VÀ LƯU OTP MỚI
// ======================================================

// Mỗi email chỉ nên có 1 OTP đang dùng.
// Nếu không xóa OTP cũ, user có thể có nhiều OTP còn hạn trong database.
async function replaceOtpForEmail(email, otpCode, expiresAt) {
    // Xóa toàn bộ OTP cũ của email này
    await supabase
        .from('otp_tokens')
        .delete()
        .eq('email', email);

    // Insert OTP mới
    const { error } = await supabase
        .from('otp_tokens')
        .insert([{
            email,
            otp_code: otpCode,
            expires_at: expiresAt.toISOString()
        }]);

    // Nếu Supabase insert lỗi thì dừng luôn
    if (error) {
        throw error;
    }
}


// ======================================================
// 6. HÀM CHÍNH: VERIFY GOOGLE TOKEN VÀ LOGIN/REGISTER GOOGLE
// ======================================================

exports.verifyAndLoginGoogle = async (googleToken) => {
    // --------------------------------------------------
    // 6.1. Verify Google token
    // --------------------------------------------------
    // Backend kiểm tra token Google thật hay giả.
    const ticket = await client.verifyIdToken({
        idToken: googleToken,
        audience: process.env.GOOGLE_CLIENT_ID,
    });

    // Lấy thông tin user từ Google token
    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;

    // Chuẩn hóa email: trim + lowercase + validate format
    const cleanEmail = normalizeEmail(email);


    // --------------------------------------------------
    // 6.2. Kiểm tra user đã tồn tại trong bảng profiles chưa
    // --------------------------------------------------
    let { data: user, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', cleanEmail)
        .maybeSingle();

    if (fetchError) {
        throw fetchError;
    }


    // --------------------------------------------------
    // 6.3. Xác định trạng thái tài khoản
    // --------------------------------------------------
    let requiresSetup = false;
    let isResume = false;

    // Nếu chưa có user trong database:
    // tạo account tạm với email, username tạm, password_hash tạm.
    if (!user) {
        const { data: newUser, error: insertError } = await supabase
            .from('profiles')
            .insert([{
                email: cleanEmail,
                username: buildTemporaryUsername(googleId),
                full_name: name || null,
                password_hash: GOOGLE_SSO_NO_PASSWORD,
                role: "USER",
                status: "ACTIVE",
            }])
            .select()
            .single();

        if (insertError) {
            throw insertError;
        }

        user = newUser;

        // Account mới nên bắt buộc đi qua OTP + complete profile
        requiresSetup = true;
        isResume = false;
    }

    // Nếu user đã tồn tại nhưng password_hash vẫn là GOOGLE_SSO_NO_PASSWORD:
    // nghĩa là user đã nhập Google/OTP trước đó nhưng chưa hoàn tất username/password.
    else if (user.password_hash === GOOGLE_SSO_NO_PASSWORD) {
        requiresSetup = true;
        isResume = true;
    }


    // --------------------------------------------------
    // 6.4. Nếu user chưa hoàn tất setup thì gửi OTP
    // --------------------------------------------------
    if (requiresSetup) {
        // Tạo OTP an toàn bằng crypto.randomInt thông qua helper
        const otpCode = generateOtp();

        // Tạo hạn dùng OTP, mặc định 10 phút
        const expiresAt = getOtpExpiryDate();

        // Xóa OTP cũ và lưu OTP mới
        await replaceOtpForEmail(cleanEmail, otpCode, expiresAt);

        // Tạo mail transporter
        const transporter = createMailTransporter();

        // Gửi OTP qua email
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: cleanEmail,
            subject: 'AI StudyHub - Your Verification Code',
            text: `Mã xác thực của bạn là: ${otpCode}. Mã sẽ hết hạn sau ${OTP_EXPIRY_MINUTES} phút.`
        });

        // Trả về cho frontend biết cần nhập OTP
        return {
            email: cleanEmail,
            requiresOTP: true,
            isResume
        };
    }


    // --------------------------------------------------
    // 6.5. Nếu user đã hoàn tất setup thì cấp accessToken
    // --------------------------------------------------
    if(user.status === "DISABLED") {
        throw new Error("Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.");
    }
    const currentSessionId = crypto.randomUUID();
    const { error: sessionError } = await supabase
        .from('profiles')
        .update({
            session_id: currentSessionId,
            last_login_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

    if (sessionError) throw sessionError;

    user.session_id = currentSessionId;
    const accessToken = signAccessToken(user);

    // Trả về thông tin login thành công
    return {
        user: buildPublicUser(user),
        accessToken,
        requiresSetup: false,
        requiresOTP: false
    };
};
