// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
if (process.env.TRUST_PROXY) {
    const configuredTrustProxy = Number(process.env.TRUST_PROXY);
    app.set(
        'trust proxy',
        Number.isFinite(configuredTrustProxy)
            ? configuredTrustProxy
            : process.env.TRUST_PROXY,
    );
}

// Import routes
const authRoutes = require('./src/routes/authRoutes');
const documentRoutes = require('./src/routes/documentRoutes');
const aiRoutes = require('./src/routes/aiRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const publicRoutes = require('./src/routes/publicRoutes');
const profileRoutes = require('./src/routes/profileRoutes');

// ─── 1. Security headers (helmet) ─────────────────────────────────────────────
app.use(helmet({
    // Allow cross-origin embedding of Supabase signed-URL documents
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ─── 2. CORS ──────────────────────────────────────────────────────────────────
const rawFrontendUrl = process.env.FRONTEND_URL || '';
const sanitizedFrontendUrl = rawFrontendUrl.replace(/\/+$/, '');

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
];

if (sanitizedFrontendUrl) {
    allowedOrigins.push(sanitizedFrontendUrl);
    allowedOrigins.push(`${sanitizedFrontendUrl}/`);
}
String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .forEach((origin) => allowedOrigins.push(origin));

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));

// ─── 3. Body parsing ──────────────────────────────────────────────────────────
app.use(express.json());

// ─── 4. Rate limiters ─────────────────────────────────────────────────────────

// General API limiter. Override intentionally through the environment when
// production traffic requires a different threshold.
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Math.max(1, Number(process.env.GENERAL_RATE_LIMIT_MAX) || 200),
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests. Please try again later.' },
});

// Strict limiter for OTP and auth flows – 10 requests per 15 minutes per IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many authentication attempts. Please wait 15 minutes and try again.' },
});

app.use('/api', generalLimiter);

// Apply strict limiter to OTP / sensitive auth endpoints
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth/verify-reset-otp', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/google', authLimiter);

// ─── 5. Mount routes ──────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/profile', profileRoutes);

// Health check
app.get('/', (req, res) => {
    res.send('AI StudyHub Backend is running.');
});

// ─── 6. Start server ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'production' || require.main === module) {
    app.listen(PORT, () => {
        console.log(`[🚀 Server] Listening at http://localhost:${PORT}`);
    });
}

module.exports = app;

