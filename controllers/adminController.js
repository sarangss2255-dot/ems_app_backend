const bcrypt = require("bcryptjs");
const Classroom = require("../models/classroom");
const User = require("../models/user");
const Attendance = require("../models/Attendance");
const CheatingIncident = require("../models/CheatingIncident");
const { generateSeating, moveStudent, normalizeStoredSeating, seatingToCsv } = require("../utils/seating");
const fs = require("fs");
const mongoose = require("mongoose");
const { parseSpreadsheetBuffer, parseSpreadsheetFile, mapStudentRow, mapClassroomRow, mapTeacherRow } = require("../utils/uploadParsers");
const { getAppSettings } = require("../config/appSettings");

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

    const examClasses = extractExamClasses(req.body, classroom.classesAllowed);
    if (!examClasses.length) {
      return res.status(400).json({ error: "Select at least one class that currently has an exam" });
    }

    const generated = await generateAndPersistSeating(
      classroom,
      "generated-by-admin",
      examClasses,
      resolveSeatingStrategy(req.body)
    );
    return res.json(generated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getSeatingForClassroom(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id).lean();
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    return res.json({
      classroom: classroom.name,
      allowedClasses: Array.isArray(classroom.classesAllowed) ? classroom.classesAllowed : [],
      activeExamClasses: Array.isArray(classroom.activeExamClasses) ? classroom.activeExamClasses : [],
      seating: normalizeStoredSeating(classroom.seatingPlan),
      antiCheat: classroom.antiCheatReport || null,
      seatingGeneratedAt: classroom.seatingGeneratedAt,
      seatingVersion: classroom.seatingVersion || 0,
      lastSeatingAction: classroom.lastSeatingAction || ""
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function reshuffleSeatingForClassroom(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    if (!Array.isArray(classroom.seatingPlan) || !classroom.seatingPlan.length) {
      return res.status(400).json({ error: "Generate seating first" });
    }

    const examClasses = extractExamClasses(req.body, classroom.classesAllowed);
    if (!examClasses.length) {
      return res.status(400).json({ error: "Select at least one class that currently has an exam" });
    }

    const generated = await generateAndPersistSeating(
      classroom,
      "reshuffled-by-admin",
      examClasses,
      resolveSeatingStrategy(req.body)
    );
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
      return res.status(400).json({ error: "Generate seating first" });
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
      return res.status(400).json({ error: "Generate seating first" });
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

async function clearSeatingForClassroom(req, res) {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    classroom.seatingPlan = [];
    classroom.activeExamClasses = [];
    classroom.antiCheatReport = null;
    classroom.seatingGeneratedAt = null;
    classroom.seatingVersion = 0;
    classroom.lastSeatingAction = "cleared-by-admin";
    await classroom.save();

    return res.json({
      ok: true,
      classroom: classroom.name,
      allowedClasses: Array.isArray(classroom.classesAllowed) ? classroom.classesAllowed : [],
      activeExamClasses: [],
      seating: [],
      antiCheat: null,
      seatingGeneratedAt: null,
      seatingVersion: 0,
      lastSeatingAction: classroom.lastSeatingAction
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
    if (!req.file) return res.status(400).json({ error: "Spreadsheet file required" });

    const rows = await getSpreadsheetRowsFromUpload(req.file);
    if (!rows.length) return res.status(400).json({ error: "Uploaded sheet is empty" });

    const mappedRows = rows.map(mapStudentRow);
    const usernames = mappedRows.map((student) => student.username).filter(Boolean);
    const existingUsernames = await getExistingUsernames(usernames);

    const seenInFile = new Set();
    const studentsToCreate = [];
    let skipped = 0;

    for (const student of mappedRows) {
      if (!student.username) {
        skipped += 1;
        continue;
      }

      if (existingUsernames.has(student.username) || seenInFile.has(student.username)) {
        skipped += 1;
        continue;
      }

      seenInFile.add(student.username);
      studentsToCreate.push(student);
    }

    const createdDocs = await Promise.all(
      studentsToCreate.map(async (student) => ({
        username: student.username,
        password: await bcrypt.hash(student.password || "pass123", 10),
        initialPassword: student.password || "pass123",
        fullName: student.fullName,
        role: "student",
        rollNumber: student.rollNumber,
        className: student.className
      }))
    );

    if (createdDocs.length) {
      await User.insertMany(createdDocs, { ordered: false });
    }

    return res.json({
      ok: true,
      imported: createdDocs.length,
      skipped,
      expectedColumns: ["URN", "Student Name", "Sr. No", "Year", "Program", "Specialization"]
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function previewStudentsUpload(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "Spreadsheet file required" });

    const rows = await getSpreadsheetRowsFromUpload(req.file);
    if (!rows.length) return res.status(400).json({ error: "Uploaded sheet is empty" });

    const mappedRows = rows.map(mapStudentRow);
    const existingUsernames = await getExistingUsernames(mappedRows.map((student) => student.username).filter(Boolean));
    const preview = [];
    let valid = 0;
    let missingIdentity = 0;
    let duplicatesInDatabase = 0;

    for (let index = 0; index < mappedRows.length; index++) {
      const student = mappedRows[index];
      if (!student.username) {
        missingIdentity += 1;
      } else {
        valid += 1;
        if (existingUsernames.has(student.username)) duplicatesInDatabase += 1;
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
    if (!req.file) return res.status(400).json({ error: "Spreadsheet file required" });

    const rows = await getSpreadsheetRowsFromUpload(req.file);
    if (!rows.length) return res.status(400).json({ error: "Uploaded sheet is empty" });

    const mappedRows = rows.map(mapTeacherRow);
    const usernames = mappedRows.map((teacher) => teacher.username).filter(Boolean);
    const existingUsernames = await getExistingUsernames(usernames);
    const classroomNames = mappedRows.map((teacher) => teacher.assignedClassroomName).filter(Boolean);
    const classrooms = classroomNames.length
      ? await Classroom.find({ name: { $in: Array.from(new Set(classroomNames)) } })
          .select("_id name")
          .lean()
      : [];
    const classroomByName = new Map(classrooms.map((classroom) => [classroom.name, classroom]));

    const seenInFile = new Set();
    const teachersToCreate = [];
    let skipped = 0;
    let explicitAssigned = 0;

    for (const teacherRow of mappedRows) {
      if (!teacherRow.username) {
        skipped += 1;
        continue;
      }

      if (existingUsernames.has(teacherRow.username) || seenInFile.has(teacherRow.username)) {
        skipped += 1;
        continue;
      }

      seenInFile.add(teacherRow.username);

      const explicitClassroom = teacherRow.assignedClassroomName
        ? classroomByName.get(teacherRow.assignedClassroomName)
        : null;
      if (explicitClassroom) explicitAssigned += 1;

      teachersToCreate.push({
        ...teacherRow,
        explicitClassroomId: explicitClassroom?._id || null
      });
    }

    const createdDocs = await Promise.all(
      teachersToCreate.map(async (teacherRow) => ({
        username: teacherRow.username,
        password: await bcrypt.hash(teacherRow.password || "pass123", 10),
        initialPassword: teacherRow.password || "pass123",
        fullName: teacherRow.fullName,
        role: "teacher",
        assignedClassroom: teacherRow.explicitClassroomId
      }))
    );

    const insertedTeachers = createdDocs.length ? await User.insertMany(createdDocs, { ordered: false }) : [];

    let autoAssigned = 0;
    const autoAssignableTeachers = insertedTeachers.filter((teacher, index) => {
      const source = teachersToCreate[index];
      return !source.explicitClassroomId && source.autoAssign;
    });

    if (autoAssignableTeachers.length) {
      const staffedClassroomIds = await User.find({
        role: "teacher",
        assignedClassroom: { $ne: null }
      }).distinct("assignedClassroom");
      const openClassrooms = await Classroom.find({
        _id: { $nin: staffedClassroomIds }
      })
        .sort({ createdAt: 1, name: 1 })
        .select("_id")
        .lean();

      const assignments = autoAssignableTeachers
        .slice(0, openClassrooms.length)
        .map((teacher, index) => ({
          updateOne: {
            filter: { _id: teacher._id },
            update: { $set: { assignedClassroom: openClassrooms[index]._id } }
          }
        }));

      if (assignments.length) {
        await User.bulkWrite(assignments, { ordered: false });
        autoAssigned = assignments.length;
      }
    }

    return res.json({
      ok: true,
      imported: insertedTeachers.length,
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
    if (!req.file) return res.status(400).json({ error: "Spreadsheet file required" });

    const rows = await getSpreadsheetRowsFromUpload(req.file);
    if (!rows.length) return res.status(400).json({ error: "Uploaded sheet is empty" });

    const mappedRows = rows.map(mapClassroomRow);
    const payloads = [];
    const seenNames = new Set();
    let skipped = 0;

    for (const row of mappedRows) {
      try {
        const payload = sanitizeClassroomPayload(row);
        if (seenNames.has(payload.name)) {
          skipped += 1;
          continue;
        }
        seenNames.add(payload.name);
        payloads.push(payload);
      } catch (err) {
        skipped += 1;
      }
    }

    const existingClassrooms = payloads.length
      ? await Classroom.find({ name: { $in: Array.from(new Set(payloads.map((payload) => payload.name))) } })
          .select("_id name")
          .lean()
      : [];
    const existingNames = new Set(existingClassrooms.map((classroom) => classroom.name));

    const createPayloads = payloads.filter((payload) => !existingNames.has(payload.name));
    const updateOps = payloads
      .filter((payload) => existingNames.has(payload.name))
      .map((payload) => ({
        updateOne: {
          filter: { name: payload.name },
          update: {
            $set: {
              rows: payload.rows,
              benchesPerRow: payload.benchesPerRow,
              seatsPerBench: payload.seatsPerBench,
              capacity: payload.capacity,
              pattern: payload.pattern,
              gap: payload.gap,
              classesAllowed: payload.classesAllowed
            }
          }
        }
      }));

    if (createPayloads.length) {
      await Classroom.insertMany(createPayloads, { ordered: false });
    }
    if (updateOps.length) {
      await Classroom.bulkWrite(updateOps, { ordered: false });
    }

    return res.json({
      ok: true,
      created: createPayloads.length,
      updated: updateOps.length,
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

    await User.updateMany(
      {
        role: "teacher",
        assignedClassroom: classroom._id,
        _id: { $ne: teacher._id }
      },
      { $set: { assignedClassroom: null } }
    );

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

async function generateAndPersistSeating(classroom, actionLabel, examClasses, seatingStrategyOverride = "") {
  const students = await User.find({
    role: "student",
    className:
      examClasses.length ? { $in: examClasses } : { $exists: true, $ne: null }
  })
    .sort({ className: 1, rollNumber: 1 })
    .lean();

  const metrics = await buildStudentMetrics(students.map((s) => s._id));
  const result = generateSeating(classroom, students, {
    metrics,
    seatingStrategy: seatingStrategyOverride || getAppSettings().seatingStrategy
  });

  classroom.seatingPlan = result.seating;
  classroom.activeExamClasses = examClasses;
  classroom.antiCheatReport = result.report;
  classroom.seatingGeneratedAt = new Date();
  classroom.seatingVersion = Number(classroom.seatingVersion || 0) + 1;
  classroom.lastSeatingAction = actionLabel;
  await classroom.save();

  return {
    classroom: classroom.name,
    allowedClasses: Array.isArray(classroom.classesAllowed) ? classroom.classesAllowed : [],
    activeExamClasses: examClasses,
    seating: classroom.seatingPlan,
    antiCheat: classroom.antiCheatReport,
    seatingGeneratedAt: classroom.seatingGeneratedAt,
    seatingVersion: classroom.seatingVersion,
    lastSeatingAction: classroom.lastSeatingAction
  };
}

function resolveSeatingStrategy(body = {}) {
  const requested = String(body.seatingStrategy || "").trim().toLowerCase();
  if (["trained-ml", "reinforcement-guided", "greedy"].includes(requested)) {
    return requested;
  }
  return "";
}

function extractExamClasses(body = {}, allowedClasses = []) {
  const requestedClasses = Array.isArray(body.examClasses)
    ? body.examClasses.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!requestedClasses.length) return [];

  const normalizedAllowed = Array.isArray(allowedClasses)
    ? allowedClasses.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!normalizedAllowed.length) return Array.from(new Set(requestedClasses));

  const allowedSet = new Set(normalizedAllowed);
  const filtered = requestedClasses.filter((item) => allowedSet.has(item));
  return Array.from(new Set(filtered));
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

async function getExistingUsernames(usernames) {
  const uniqueUsernames = Array.from(new Set(usernames.filter(Boolean)));
  if (!uniqueUsernames.length) return new Set();

  const existingUsers = await User.find({ username: { $in: uniqueUsernames } })
    .select("username")
    .lean();
  return new Set(existingUsers.map((user) => user.username));
}

async function getSpreadsheetRowsFromUpload(file) {
  try {
    if (file.buffer) {
      return await parseSpreadsheetBuffer(file.buffer, file.originalname);
    }
    if (file.path) {
      return await parseSpreadsheetFile(file.path, file.originalname);
    }
    throw new Error("Spreadsheet file required");
  } finally {
    if (file?.path) {
      try {
        fs.unlinkSync(file.path);
      } catch (_) {}
    }
  }
}

module.exports = {
  assignTeacher,
  bulkCreateStudents,
  clearSeatingForClassroom,
  createClassroom,
  deleteClassroom,
  deleteStudent,
  exportSeatingCsv,
  exportStudentCredentials,
  generateSeatingForClassroom,
  getSeatingForClassroom,
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
