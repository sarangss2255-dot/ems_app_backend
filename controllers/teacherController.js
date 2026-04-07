const Classroom = require("../models/classroom");
const User = require("../models/user");
const Attendance = require("../models/Attendance");
const CheatingIncident = require("../models/CheatingIncident");
const { generateSeating } = require("../utils/seating");

async function myHall(req, res) {
  try {
    if (!req.user.assignedClassroom) return res.status(404).json({ error: "No assigned classroom" });

    const classroom = await Classroom.findById(req.user.assignedClassroom).lean();
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const students = await User.find({
      role: "student",
      className:
        Array.isArray(classroom.classesAllowed) && classroom.classesAllowed.length
          ? { $in: classroom.classesAllowed }
          : { $exists: true, $ne: null }
    })
      .sort({ className: 1, rollNumber: 1 })
      .lean();

    const result = generateSeating(classroom, students);
    return res.json({ classroom: classroom.name, seating: result.seating, antiCheat: result.report });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function markAttendance(req, res) {
  try {
    const { studentId, status } = req.body;
    if (!studentId || !["present", "absent"].includes(status)) {
      return res.status(400).json({ error: "studentId and status (present/absent) required" });
    }
    if (!req.user.assignedClassroom) return res.status(400).json({ error: "Teacher has no classroom assigned" });

    await Attendance.create({
      classroom: req.user.assignedClassroom,
      teacher: req.user._id,
      student: studentId,
      status
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function reportIncident(req, res) {
  try {
    const { studentId, severity, notes } = req.body;
    if (!studentId) return res.status(400).json({ error: "studentId required" });
    if (!req.user.assignedClassroom) return res.status(400).json({ error: "Teacher has no classroom assigned" });

    const incident = await CheatingIncident.create({
      classroom: req.user.assignedClassroom,
      teacher: req.user._id,
      student: studentId,
      severity: Number(severity || 1),
      notes: notes || ""
    });
    return res.json({ ok: true, id: incident._id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { myHall, markAttendance, reportIncident };
