const Classroom = require("../models/classroom");
const User = require("../models/user");
const { generateSeating, findStudentSeat } = require("../utils/seating");

async function mySeat(req, res) {
  try {
    const student = req.user;
    const classroom = await Classroom.findOne({ classesAllowed: student.className }).lean();
    if (!classroom) return res.status(404).json({ error: "No classroom found for your class" });

    const students = await User.find({
      role: "student",
      className:
        Array.isArray(classroom.classesAllowed) && classroom.classesAllowed.length
          ? { $in: classroom.classesAllowed }
          : { $exists: true, $ne: null }
    })
      .sort({ className: 1, rollNumber: 1 })
      .lean();

    const { seating } = generateSeating(classroom, students);
    const seat = findStudentSeat(seating, student._id);
    if (!seat) return res.status(404).json({ error: "Seat not assigned" });

    return res.json({
      classroom: classroom.name,
      seat,
      seating
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { mySeat };
