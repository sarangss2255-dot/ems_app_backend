const bcrypt = require("bcryptjs");
const Classroom = require("../models/classroom");
const User = require("../models/user");
const Attendance = require("../models/Attendance");
const CheatingIncident = require("../models/CheatingIncident");
const { generateSeating } = require("../utils/seating");

async function createClassroom(req, res) {
  try {
    const payload = sanitizeClassroomPayload(req.body);
    const exists = await Classroom.findOne({ name: payload.name }).lean();
    if (exists) return res.status(400).json({ error: "Classroom name already exists" });

    const classroom = await Classroom.create(payload);
    return res.json({ ok: true, id: classroom._id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function listClassrooms(req, res) {
  try {
    const list = await Classroom.find().sort({ createdAt: -1 }).lean();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getClassroomById(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id).lean();
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    return res.json(classroom);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function updateClassroom(req, res) {
  try {
    const payload = sanitizeClassroomPayload(req.body);
    const updated = await Classroom.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true
    }).lean();
    if (!updated) return res.status(404).json({ error: "Classroom not found" });
    return res.json({ ok: true, classroom: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function deleteClassroom(req, res) {
  try {
    const deleted = await Classroom.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: "Classroom not found" });
    await User.updateMany({ assignedClassroom: deleted._id }, { $set: { assignedClassroom: null } });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function generateSeatingForClassroom(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id).lean();
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

    const metrics = await buildStudentMetrics(students.map((s) => s._id));
    const result = generateSeating(classroom, students, { metrics });

    return res.json({
      classroom: classroom.name,
      seating: result.seating,
      antiCheat: result.report
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function bulkCreateStudents(req, res) {
  try {
    const students = req.body.students;
    if (!Array.isArray(students)) return res.status(400).json({ error: "students array required" });

    const createdDocs = [];
    for (const s of students) {
      if (!s?.username) continue;
      const exists = await User.findOne({ username: s.username }).lean();
      if (exists) continue;

      const hashed = await bcrypt.hash(s.password || "pass123", 10);
      createdDocs.push({
        username: s.username,
        password: hashed,
        fullName: s.fullName,
        role: "student",
        rollNumber: s.rollNumber,
        className: s.className
      });
    }

    if (createdDocs.length) await User.insertMany(createdDocs);
    return res.json({ ok: true, created: createdDocs.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function assignTeacher(req, res) {
  try {
    const { teacherId, classroomId } = req.body;

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") return res.status(400).json({ error: "Invalid teacher" });

    const classroom = await Classroom.findById(classroomId).lean();
    if (!classroom) return res.status(400).json({ error: "Classroom not found" });

    teacher.assignedClassroom = classroom._id;
    await teacher.save();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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

function sanitizeClassroomPayload(body = {}) {
  const name = String(body.name || "").trim();
  const rows = Number(body.rows || 0);
  const benchesPerRow = Number(body.benchesPerRow || 0);
  const seatsPerBench = Number(body.seatsPerBench || 2);
  const requestedCapacity = Number(body.capacity || 0);
  const maxCapacity = rows * benchesPerRow * seatsPerBench;
  const capacity = requestedCapacity > 0 ? Math.min(requestedCapacity, maxCapacity) : maxCapacity;
  const pattern = ["normal", "gap", "zigzag"].includes(body.pattern) ? body.pattern : "normal";
  const gap = Number(body.gap || 0);
  const classesAllowed = Array.isArray(body.classesAllowed)
    ? body.classesAllowed.map((x) => String(x).trim()).filter(Boolean)
    : [];

  if (!name) throw new Error("name is required");
  if (rows <= 0 || benchesPerRow <= 0 || seatsPerBench <= 0) {
    throw new Error("rows/benchesPerRow/seatsPerBench must be positive");
  }

  return {
    name,
    rows,
    benchesPerRow,
    seatsPerBench,
    capacity,
    pattern,
    gap,
    classesAllowed
  };
}

module.exports = {
  createClassroom,
  listClassrooms,
  getClassroomById,
  updateClassroom,
  deleteClassroom,
  generateSeatingForClassroom,
  bulkCreateStudents,
  assignTeacher
};
