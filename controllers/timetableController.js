const Timetable = require("../models/Timetable");
const Classroom = require("../models/classroom");
const User = require("../models/user");

function buildTimetableFilter(query = {}) {
  const { className, date, upcoming } = query;
  const filter = {};

  if (className) {
    filter.className = className;
  }

  if (date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    filter.examDate = { $gte: startOfDay, $lte: endOfDay };
  } else if (upcoming === "true") {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    filter.examDate = { $gte: startOfToday };
  }

  return filter;
}

// Admin: Create new exam timetable entry
async function createTimetable(req, res) {
  try {
    const { className, subject, examDate, startTime, endTime, classroomId, teacherIds, notes } = req.body;

    if (!className || !subject || !examDate || !startTime || !endTime) {
      return res.status(400).json({ error: "className, subject, examDate, startTime, endTime are required" });
    }

    let classroomName = "";

    if (classroomId) {
      const classroom = await Classroom.findById(classroomId);
      if (classroom) {
        classroomName = classroom.name;
      }
    }

    const timetable = new Timetable({
      className,
      subject,
      examDate: new Date(examDate),
      startTime,
      endTime,
      classroom: classroomId || null,
      classroomName,
      assignedTeachers: teacherIds || [],
      createdBy: req.user._id,
      notes: notes || ""
    });

    await timetable.save();
    res.json({ ok: true, timetable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Admin: List all timetable entries
async function listTimetable(req, res) {
  try {
    const filter = buildTimetableFilter(req.query);
    const timetable = await Timetable.find(filter)
      .populate("classroom", "name")
      .populate("assignedTeachers", "fullName username")
      .populate("createdBy", "fullName")
      .sort({ examDate: 1, startTime: 1 });

    res.json({ timetable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Admin: Update timetable entry
async function updateTimetable(req, res) {
  try {
    const { id } = req.params;
    const { className, subject, examDate, startTime, endTime, classroomId, teacherIds, isActive, notes } = req.body;

    const timetable = await Timetable.findById(id);
    if (!timetable) {
      return res.status(404).json({ error: "Timetable entry not found" });
    }

    if (className) timetable.className = className;
    if (subject) timetable.subject = subject;
    if (examDate) timetable.examDate = new Date(examDate);
    if (startTime) timetable.startTime = startTime;
    if (endTime) timetable.endTime = endTime;
    if (notes !== undefined) timetable.notes = notes;
    if (isActive !== undefined) timetable.isActive = isActive;

    if (classroomId !== undefined) {
      if (classroomId) {
        const classroom = await Classroom.findById(classroomId);
        timetable.classroom = classroomId;
        timetable.classroomName = classroom ? classroom.name : "";
      } else {
        timetable.classroom = null;
        timetable.classroomName = "";
      }
    }

    if (teacherIds !== undefined) {
      timetable.assignedTeachers = teacherIds;
    }

    await timetable.save();
    res.json({ ok: true, timetable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Admin: Delete timetable entry
async function deleteTimetable(req, res) {
  try {
    const { id } = req.params;
    const timetable = await Timetable.findByIdAndDelete(id);
    if (!timetable) {
      return res.status(404).json({ error: "Timetable entry not found" });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Teacher: Get timetable for assigned duties
async function getMyDuties(req, res) {
  try {
    const teacherId = req.user._id;
    const timetable = await Timetable.find({
      assignedTeachers: teacherId,
      isActive: true
    })
      .populate("classroom", "name")
      .sort({ examDate: 1, startTime: 1 });

    res.json({ timetable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Student: Get timetable for their class
async function getMyClassTimetable(req, res) {
  try {
    const className = req.user.className;
    if (!className) {
      return res.status(400).json({ error: "No class assigned to this student" });
    }

    const timetable = await Timetable.find({
      className,
      isActive: true
    })
      .populate("classroom", "name")
      .populate("assignedTeachers", "fullName")
      .sort({ examDate: 1, startTime: 1 });

    res.json({ timetable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Get all unique class names from timetable
async function getClassNames(req, res) {
  try {
    const classNames = await Timetable.distinct("className");
    res.json({ classNames });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Get teachers for assignment dropdown
async function getTeachers(req, res) {
  try {
    const teachers = await User.find({ role: "teacher" }).select("fullName username assignedClassroom");
    res.json({ teachers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createTimetable,
  listTimetable,
  updateTimetable,
  deleteTimetable,
  getMyDuties,
  getMyClassTimetable,
  getClassNames,
  getTeachers
};
