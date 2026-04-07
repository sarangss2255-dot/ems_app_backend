const express = require("express");
const router = express.Router();
const teacherCtrl = require("../controllers/teacherController");
const { authMiddleware, requireRole } = require("../middleware/auth");

router.get("/myhall", authMiddleware, requireRole("teacher"), teacherCtrl.myHall);
router.post("/attendance", authMiddleware, requireRole("teacher"), teacherCtrl.markAttendance);
router.post("/incidents", authMiddleware, requireRole("teacher"), teacherCtrl.reportIncident);

module.exports = router;
