const express = require("express");
const multer = require("multer");
const path = require("path");
const { rateLimit } = require("express-rate-limit");

const authMiddleware = require("../middleware/authMiddleware");

const {
    listMyDocuments,
    uploadDocuments,
    downloadDocument,
    deleteDocument,
    createLibrary,
    listMyLibraries,
    updateLibrary,
    getLibrary,
    deleteLibrary,
    suggestTagsForFile,
} = require("../controllers/documentController");

const router = express.Router();

const allowedMimeTypes = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
]);
const allowedExtensions = new Set([".pdf", ".docx", ".txt"]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 10,
    },
    fileFilter: (req, file, cb) => {
        const extension = path.extname(file.originalname || "").toLowerCase();

        if (
            !allowedMimeTypes.has(file.mimetype) ||
            !allowedExtensions.has(extension)
        ) {
            return cb(new Error("Only PDF, DOCX, and TXT files are allowed."));
        }

        cb(null, true);
    },
});

const suggestTagsLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user.id),
    message: {
        status: "error",
        message: "Too many AI tag requests. Please wait a minute and try again.",
    },
});

function uploadSingleDocument(req, res, next) {
    upload.single("file")(req, res, (error) => {
        if (!error) return next();

        const status = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
            ? 413
            : 400;

        return res.status(status).json({
            status: "error",
            message: error.message,
        });
    });
}

router.get("/", authMiddleware, listMyDocuments);

router.post(
    "/upload",
    authMiddleware,
    upload.array("files", 10),
    uploadDocuments
);

router.post(
    "/suggest-tags",
    authMiddleware,
    suggestTagsLimiter,
    uploadSingleDocument,
    suggestTagsForFile,
);

router.get("/libraries", authMiddleware, listMyLibraries);
router.get("/libraries/:libraryId", authMiddleware, getLibrary);
router.post("/libraries", authMiddleware, createLibrary);
router.put("/libraries/:id", authMiddleware, updateLibrary);
router.delete("/libraries/:id", authMiddleware, deleteLibrary);

router.get("/:documentId/download", authMiddleware, downloadDocument);

router.delete("/:documentId", authMiddleware, deleteDocument);

module.exports = router;
