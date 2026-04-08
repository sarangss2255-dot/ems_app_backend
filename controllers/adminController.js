const bcrypt = require("bcryptjs");
const Classroom = require("../models/classroom");
const User = require("../models/user");
const Attendance = require("../models/Attendance");
const CheatingIncident = require("../models/CheatingIncident");
const { generateSeating, moveStudent, normalizeStoredSeating, seatingToCsv } = require("../utils/seating");
const mongoose = require("mongoose");
const { parseSpreadsheetBuffer, mapStudentRow, mapClassroomRow, mapTeacherRow } = require("../utils/uploadParsers");

async function createClassroom(req, res) {
  try {
    const payload = sanitizeClassroomPayload(req.body);
    const exists = await Classroom.findOne({ name: payload.name }).lean();
    if (exists) return res.status(400).json({ error: "Classroom name already exists" });

    const classroom = await Classroom.create(payload);
    const assignment = await autoAssignTeacherToClassroom(classroom._id);
    return res.json({ ok: true, id: classroom._id, assignedTeacher: assignment });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function listClassrooms(req, res) {
  try {
    const list = await Classroom.find().sort({ createdAt: -1 }).lean();
    const classroomIds = list.map((item) => item._id);
    const teachers = await User.find({
      role: "teacher",
      assignedClassroom: { $in: classroomIds }
    })
      .select("fullName username assignedClassroom")
      .lean();
    const teacherByClassroomId = Object.fromEntries(
      teachers.map((teacher) => [String(teacher.assignedClassroom), teacher])
    );
    return res.json(
      list.map((item) => ({
        ...item,
        assignedTeacher: teacherByClassroomId[String(item._id)] || null
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function listStudents(req, res) {
  try {
    const students = await User.find({ role: "student" })
      .sort({ className: 1, rollNumber: 1, fullName: 1 })
      .select("username fullName className rollNumber initialPassword createdAt")
      .lean();
    return res.json(students);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getClassroomById(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id).lean();
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    const assignedTeacher = await User.findOne({
      role: "teacher",
      assignedClassroom: classroom._id
    })
      .select("fullName username assignedClassroom")
      .lean();
    return res.json({ ...classroom, assignedTeacher: assignedTeacher || null });
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

async function deleteStudent(req, res) {
  try {
    const identifier = String(req.params.identifier || "").trim();
    if (!identifier) return res.status(400).json({ error: "student identifier is required" });

    const filter = mongoose.Types.ObjectId.isValid(identifier)
      ? { role: "student", $or: [{ _id: identifier }, { username: identifier }] }
      : { role: "student", username: identifier };

    const deleted = await User.findOneAndDelete(filter).lean();
    if (!deleted) return res.status(404).json({ error: "Student not found" });

    await Promise.all([
      Attendance.deleteMany({ student: deleted._id }),
      CheatingIncident.deleteMany({ student: deleted._id })
    ]);

    return res.json({ ok: true, deletedStudent: { username: deleted.username, fullName: deleted.fullName } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function generateSeatingForClassroom(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const generated = await generateAndPersistSeating(classroom, "generated-by-admin");
    return res.json(generated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function reshuffleSeatingForClassroom(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const generated = await generateAndPersistSeating(classroom, "reshuffled-by-admin");
    return res.json({ ...generated, message: "Seating reshuffled" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function moveSeatForClassroom(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    if (!Array.isArray(classroom.seatingPlan) || !classroom.seatingPlan.length) {
      await generateAndPersistSeating(classroom, "generated-before-admin-seat-change");
    }

    const { studentId, row, bench, seat } = req.body || {};
    if (!studentId || !row || !bench || !seat) {
      return res.status(400).json({ error: "studentId, row, bench and seat are required" });
    }

    const result = moveStudent(classroom.seatingPlan, studentId, { row, bench, seat });
    classroom.seatingPlan = result.seating;
    classroom.seatingGeneratedAt = new Date();
    classroom.seatingVersion = Number(classroom.seatingVersion || 0) + 1;
    classroom.lastSeatingAction = "manual-admin-seat-change";
    await classroom.save();

    return res.json({
      ok: true,
      message: "Seat updated",
      classroom: classroom.name,
      seating: classroom.seatingPlan,
      movedStudent: result.movedStudent,
      swappedStudent: result.swappedStudent
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function exportSeatingCsv(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    if (!Array.isArray(classroom.seatingPlan) || !classroom.seatingPlan.length) {
      await generateAndPersistSeating(classroom, "generated-before-export");
    }

    const csv = seatingToCsv(classroom.name, normalizeStoredSeating(classroom.seatingPlan));
    const fileName = `${classroom.name.replace(/[^a-z0-9_-]+/gi, "_")}_seating.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(csv);
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
        initialPassword: s.password || "pass123",
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

async function uploadStudents(req, res) {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "Spreadsheet file required" });

    const rows = await parseSpreadsheetBuffer(req.file.buffer, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: "Uploaded sheet is empty" });

    let created = 0;
    let skipped = 0;

    for (const row of rows) {
      const student = mapStudentRow(row);
      if (!student.username) {
        skipped += 1;
        continue;
      }

      const exists = await User.findOne({ username: student.username }).lean();
      if (exists) {
        skipped += 1;
        continue;
      }

      const hashed = await bcrypt.hash(student.password || "pass123", 10);
      await User.create({
        username: student.username,
        password: hashed,
        initialPassword: student.password || "pass123",
        fullName: student.fullName,
        role: "student",
        rollNumber: student.rollNumber,
        className: student.className
      });
      created += 1;
    }

    return res.json({
      ok: true,
      imported: created,
      skipped,
      expectedColumns: ["URN", "Student Name", "Sr. No", "Year", "Program", "Specialization"]
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function previewStudentsUpload(req, res) {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "Spreadsheet file required" });

    const rows = await parseSpreadsheetBuffer(req.file.buffer, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: "Uploaded sheet is empty" });

    const preview = [];
    let valid = 0;
    let missingIdentity = 0;
    let duplicatesInDatabase = 0;

    for (let index = 0; index < rows.length; index++) {
      const student = mapStudentRow(rows[index]);
      if (!student.username) {
        missingIdentity += 1;
      } else {
        valid += 1;
        const exists = await User.findOne({ username: student.username }).select("_id").lean();
        if (exists) duplicatesInDatabase += 1;
      }

      if (preview.length < 20) {
        preview.push({
          rowNumber: index + 2,
          username: student.username,
          password: student.password,
          fullName: student.fullName,
          rollNumber: student.rollNumber,
          className: student.className
        });
      }
    }

    return res.json({
      ok: true,
      fileName: req.file.originalname || "",
      totalRows: rows.length,
      valid,
      missingIdentity,
      duplicatesInDatabase,
      preview
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function uploadTeachers(req, res) {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "Spreadsheet file required" });

    const rows = await parseSpreadsheetBuffer(req.file.buffer, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: "Uploaded sheet is empty" });

    let created = 0;
    let skipped = 0;
    let autoAssigned = 0;
    let explicitAssigned = 0;

    for (const row of rows) {
      const teacherRow = mapTeacherRow(row);
      if (!teacherRow.username) {
        skipped += 1;
        continue;
      }

      const exists = await User.findOne({ username: teacherRow.username }).lean();
      if (exists) {
        skipped += 1;
        continue;
      }

      const hashed = await bcrypt.hash(teacherRow.password || "pass123", 10);
      const teacher = await User.create({
        username: teacherRow.username,
        password: hashed,
        initialPassword: teacherRow.password || "pass123",
        fullName: teacherRow.fullName,
        role: "teacher"
      });

      let assignmentApplied = false;
      if (teacherRow.assignedClassroomName) {
        const classroom = await Classroom.findOne({ name: teacherRow.assignedClassroomName }).lean();
        if (classroom) {
          teacher.assignedClassroom = classroom._id;
          await teacher.save();
          explicitAssigned += 1;
          assignmentApplied = true;
        }
      }

      if (!assignmentApplied && teacherRow.autoAssign) {
        const assigned = await autoAssignSpecificTeacher(teacher._id);
        if (assigned) autoAssigned += 1;
      }

      created += 1;
    }

    return res.json({
      ok: true,
      imported: created,
      skipped,
      autoAssigned,
      explicitAssigned,
      expectedColumns: ["username", "password", "fullName", "assignedClassroom", "autoAssign"]
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function uploadClassrooms(req, res) {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "Spreadsheet file required" });

    const rows = await parseSpreadsheetBuffer(req.file.buffer, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: "Uploaded sheet is empty" });

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const payload = sanitizeClassroomPayload(mapClassroomRow(row));
        const existing = await Classroom.findOne({ name: payload.name });
        if (!existing) {
          await Classroom.create(payload);
          created += 1;
          continue;
        }

        existing.rows = payload.rows;
        existing.benchesPerRow = payload.benchesPerRow;
        existing.seatsPerBench = payload.seatsPerBench;
        existing.capacity = payload.capacity;
        existing.pattern = payload.pattern;
        existing.gap = payload.gap;
        existing.classesAllowed = payload.classesAllowed;
        await existing.save();
        updated += 1;
      } catch (err) {
        skipped += 1;
      }
    }

    return res.json({
      ok: true,
      created,
      updated,
      skipped,
      expectedColumns: ["name", "rows", "benchesPerRow", "seatsPerBench", "capacity", "pattern", "gap"]
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function exportStudentCredentials(req, res) {
  try {
    const students = await User.find({ role: "student" })
      .sort({ className: 1, rollNumber: 1, username: 1 })
      .select("username initialPassword fullName className rollNumber")
      .lean();

    const lines = [
      ["Username", "Password", "Full Name", "Class", "Roll Number"],
      ...students.map((student) => [
        student.username || "",
        student.initialPassword || "",
        student.fullName || "",
        student.className || "",
        student.rollNumber != null ? String(student.rollNumber) : ""
      ])
    ];
    const csv = lines.map((line) => line.map(escapeCsv).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="student_credentials.csv"');
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function assignTeacher(req, res) {
  try {
    const { teacherId, classroomId, autoAssign } = req.body;
    const classroom = await Classroom.findById(classroomId).lean();
    if (!classroom) return res.status(400).json({ error: "Classroom not found" });

    if (autoAssign || !teacherId) {
      const assignment = await autoAssignTeacherToClassroom(classroom._id);
      if (!assignment) return res.status(404).json({ error: "No available teacher for auto assignment" });
      return res.json({ ok: true, assignedTeacher: assignment, autoAssigned: true });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") return res.status(400).json({ error: "Invalid teacher" });

    teacher.assignedClassroom = classroom._id;
    await teacher.save();
    return res.json({
      ok: true,
      assignedTeacher: {
        _id: teacher._id,
        fullName: teacher.fullName,
        username: teacher.username,
        assignedClassroom: teacher.assignedClassroom
      },
      autoAssigned: false
    });
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

async function generateAndPersistSeating(classroom, actionLabel) {
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
  classroom.lastSeatingAction = actionLabel;
  await classroom.save();

  return {
    classroom: classroom.name,
    seating: classroom.seatingPlan,
    antiCheat: classroom.antiCheatReport,
    seatingGeneratedAt: classroom.seatingGeneratedAt,
    seatingVersion: classroom.seatingVersion,
    lastSeatingAction: classroom.lastSeatingAction
  };
}

async function autoAssignTeacherToClassroom(classroomId) {
  const alreadyAssigned = await User.findOne({
    role: "teacher",
    assignedClassroom: classroomId
  })
    .select("fullName username assignedClassroom")
    .lean();
  if (alreadyAssigned) return alreadyAssigned;

  const availableTeacher = await User.findOne({
    role: "teacher",
    $or: [{ assignedClassroom: null }, { assignedClassroom: { $exists: false } }]
  }).sort({ createdAt: 1, username: 1 });

  if (!availableTeacher) return null;

  availableTeacher.assignedClassroom = classroomId;
  await availableTeacher.save();
  return {
    _id: availableTeacher._id,
    fullName: availableTeacher.fullName,
    username: availableTeacher.username,
    assignedClassroom: availableTeacher.assignedClassroom
  };
}

async function autoAssignSpecificTeacher(teacherId) {
  const teacher = await User.findById(teacherId);
  if (!teacher || teacher.role !== "teacher") return null;
  if (teacher.assignedClassroom) {
    return {
      _id: teacher._id,
      fullName: teacher.fullName,
      username: teacher.username,
      assignedClassroom: teacher.assignedClassroom
    };
  }

  const staffedClassroomIds = await User.find({
    role: "teacher",
    assignedClassroom: { $ne: null }
  })
    .distinct("assignedClassroom");
  const openClassroom = await Classroom.findOne({
    _id: { $nin: staffedClassroomIds }
  }).sort({ createdAt: 1, name: 1 });

  if (!openClassroom) return null;

  teacher.assignedClassroom = openClassroom._id;
  await teacher.save();
  return {
    _id: teacher._id,
    fullName: teacher.fullName,
    username: teacher.username,
    assignedClassroom: teacher.assignedClassroom
  };
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

function escapeCsv(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

module.exports = {
  assignTeacher,
  bulkCreateStudents,
  createClassroom,
  deleteClassroom,
  deleteStudent,
  exportSeatingCsv,
  exportStudentCredentials,
  generateSeatingForClassroom,
  getClassroomById,
  listClassrooms,
  listStudents,
  moveSeatForClassroom,
  previewStudentsUpload,
  reshuffleSeatingForClassroom,
  updateClassroom,
  uploadClassrooms,
  uploadTeachers,
  uploadStudents
};
