const Classroom = require("../models/classroom");
const User = require("../models/user");
const Attendance = require("../models/Attendance");
const CheatingIncident = require("../models/CheatingIncident");
const { generateSeating, findStudentSeat, normalizeStoredSeating } = require("../utils/seating");

async function mySeat(req, res) {
  try {
    const student = req.user;
    const classroom = await Classroom.findOne({ classesAllowed: student.className });
    if (!classroom) return res.status(404).json({ error: "No classroom found for your class" });

    const seating = await ensureSeating(classroom);
    const seat = findStudentSeat(seating, student._id);
    if (!seat) return res.status(404).json({ error: "Seat not assigned" });

    return res.json({
      classroom: classroom.name,
      seat,
      seating,
      seatingGeneratedAt: classroom.seatingGeneratedAt,
      seatingVersion: classroom.seatingVersion || 0,
      lastSeatingAction: classroom.lastSeatingAction || ""
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function ensureSeating(classroom) {
  if (Array.isArray(classroom.seatingPlan) && classroom.seatingPlan.length) {
    return normalizeStoredSeating(classroom.seatingPlan);
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
  const result = generateSeating(classroom, students, { metrics });
  classroom.seatingPlan = result.seating;
  classroom.antiCheatReport = result.report;
  classroom.seatingGeneratedAt = new Date();
  classroom.seatingVersion = Number(classroom.seatingVersion || 0) + 1;
  classroom.lastSeatingAction = "generated-for-student";
  await classroom.save();
  return normalizeStoredSeating(classroom.seatingPlan);
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

module.exports = { mySeat };
