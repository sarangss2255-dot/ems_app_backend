const Classroom = require("../models/classroom");
const User = require("../models/user");
const Attendance = require("../models/Attendance");
const CheatingIncident = require("../models/CheatingIncident");
const { generateSeating, moveStudent, normalizeStoredSeating } = require("../utils/seating");
const { getAppSettings } = require("../config/appSettings");

async function myHall(req, res) {
  try {
    if (!req.user.assignedClassroom) return res.status(404).json({ error: "No assigned classroom" });

    const classroom = await Classroom.findById(req.user.assignedClassroom);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const prepared = await ensureClassroomSeating(classroom);
    return res.json(prepared);
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
    const { studentId, severity, notes, row, bench, seat } = req.body;
    if (!studentId) return res.status(400).json({ error: "studentId required" });
    if (!req.user.assignedClassroom) return res.status(400).json({ error: "Teacher has no classroom assigned" });

    const classroom = await Classroom.findById(req.user.assignedClassroom);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    if (!Array.isArray(classroom.seatingPlan) || !classroom.seatingPlan.length) {
      await ensureClassroomSeating(classroom);
    }

    const incident = await CheatingIncident.create({
      classroom: req.user.assignedClassroom,
      teacher: req.user._id,
      student: studentId,
      severity: Number(severity || 1),
      notes: notes || ""
    });

    let relocation = null;
    if (row && bench && seat) {
      const moved = moveStudent(classroom.seatingPlan, studentId, { row, bench, seat });
      classroom.seatingPlan = moved.seating;
      classroom.seatingGeneratedAt = new Date();
      classroom.seatingVersion = Number(classroom.seatingVersion || 0) + 1;
      classroom.lastSeatingAction = "teacher-relocation-after-incident";
      await classroom.save();
      relocation = {
        from: moved.from,
        to: moved.to,
        swappedStudent: moved.swappedStudent
      };
    }

    return res.json({
      ok: true,
      id: incident._id,
      relocation,
      adminVisible: true
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function ensureClassroomSeating(classroom) {
  if (Array.isArray(classroom.seatingPlan) && classroom.seatingPlan.length) {
    return {
      classroom: classroom.name,
      seating: normalizeStoredSeating(classroom.seatingPlan),
      antiCheat: classroom.antiCheatReport || null,
      seatingGeneratedAt: classroom.seatingGeneratedAt,
      seatingVersion: classroom.seatingVersion || 0,
      lastSeatingAction: classroom.lastSeatingAction || ""
    };
  }

  const students = await User.find({
    role: "student",
    className:
      Array.isArray(classroom.classesAllowed) && classroom.classesAllowed.length
        ? { $in: classroom.classesAllowed }
        : { $exists: true, $ne: null }
  })
    .sort({ className: 1, rollNumber: 1 })
    .lean();

  const metrics = await buildStudentMetrics(students.map((s) => s._id));
  const result = generateSeating(classroom, students, {
    metrics,
    seatingStrategy: getAppSettings().seatingStrategy
  });
  classroom.seatingPlan = result.seating;
  classroom.antiCheatReport = result.report;
  classroom.seatingGeneratedAt = new Date();
  classroom.seatingVersion = Number(classroom.seatingVersion || 0) + 1;
  classroom.lastSeatingAction = "generated-for-teacher";
  await classroom.save();

  return {
    classroom: classroom.name,
    seating: normalizeStoredSeating(classroom.seatingPlan),
    antiCheat: classroom.antiCheatReport,
    seatingGeneratedAt: classroom.seatingGeneratedAt,
    seatingVersion: classroom.seatingVersion,
    lastSeatingAction: classroom.lastSeatingAction
  };
}

async function buildStudentMetrics(studentIds) {
  if (!studentIds.length) return { absencesByStudentId: {}, incidentsByStudentId: {} };
  const [absencesRaw, incidentsRaw] = await Promise.all([
    Attendance.aggregate([
      { $match: { student: { $in: studentIds }, status: "absent" } },
      { $group: { _id: "$student", count: { $sum: 1 } } }
    ]),
    CheatingIncident.aggregate([
      { $match: { student: { $in: studentIds } } },
      { $group: { _id: "$student", severityTotal: { $sum: "$severity" } } }
    ])
  ]);

  const absencesByStudentId = {};
  for (const item of absencesRaw) absencesByStudentId[String(item._id)] = item.count;
  const incidentsByStudentId = {};
  for (const item of incidentsRaw) incidentsByStudentId[String(item._id)] = item.severityTotal;
  return { absencesByStudentId, incidentsByStudentId };
}

module.exports = { markAttendance, myHall, reportIncident };
