const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const requireAdmin = require("../middleware/requireAdmin");
const adminController = require("../controllers/adminController");

const router = express.Router();

router.use(authMiddleware);
router.use(requireAdmin);

router.get("/dashboard", adminController.getDashboardStats);

router.get("/users", adminController.getUsers);
router.patch("/users/:userId/status", adminController.updateUserStatus);
router.patch("/users/:userId/role", adminController.updateUserRole);

router.get("/usage", adminController.getUsage);
router.get("/logs", adminController.getActivityLogs);


module.exports = router;
