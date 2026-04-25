const express = require("express");
const router = express.Router();
const timetableCtrl = require("../controllers/timetableController");
const { authMiddleware, requireRole } = require("../middleware/auth");

// Admin routes
router.post("/", authMiddleware, requireRole("admin"), timetableCtrl.createTimetable);
router.get("/", authMiddleware, requireRole("admin"), timetableCtrl.listTimetable);
router.put("/:id", authMiddleware, requireRole("admin"), timetableCtrl.updateTimetable);
router.delete("/:id", authMiddleware, requireRole("admin"), timetableCtrl.deleteTimetable);
router.get("/classes", authMiddleware, requireRole("admin"), timetableCtrl.getClassNames);
router.get("/teachers", authMiddleware, requireRole("admin"), timetableCtrl.getTeachers);

// Teacher routes
router.get("/duties", authMiddleware, requireRole("teacher"), timetableCtrl.getMyDuties);

// Student routes
router.get("/my-class", authMiddleware, requireRole("student"), timetableCtrl.getMyClassTimetable);

module.exports = router;