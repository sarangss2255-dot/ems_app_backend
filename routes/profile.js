const express = require("express");
const router = express.Router();
const profileController = require("../controllers/profileController");
const { authMiddleware, requireRole } = require("../middleware/auth");

// Profile routes (authenticated)
router.get("/profile", authMiddleware, profileController.getProfile);
router.put("/profile", authMiddleware, profileController.updateProfile);
router.post("/change-password", authMiddleware, profileController.changePassword);

// Settings routes
router.get("/settings", profileController.getSettings);
router.put("/settings", authMiddleware, requireRole("admin"), profileController.updateSettings);

// Terms and conditions (public)
router.get("/terms", profileController.getTerms);

module.exports = router;