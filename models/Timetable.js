const mongoose = require("mongoose");
const { Schema } = mongoose;

const TimetableSchema = new Schema({
  className: { type: String, required: true },       // e.g., "CS-2024"
  subject: { type: String, required: true },         // e.g., "Data Structures"
  examDate: { type: Date, required: true },          // Date of exam
  startTime: { type: String, required: true },      // e.g., "09:00"
  endTime: { type: String, required: true },         // e.g., "11:00"
  classroom: { type: Schema.Types.ObjectId, ref: "Classroom" },
  classroomName: { type: String, default: "" },      // Store name for easy reference
  assignedTeachers: [{ type: Schema.Types.ObjectId, ref: "User" }],  // Teachers on duty
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  isActive: { type: Boolean, default: true },
  notes: { type: String, default: "" }
}, { timestamps: true });

// Index for efficient queries
TimetableSchema.index({ className: 1, examDate: 1 });
TimetableSchema.index({ assignedTeachers: 1 });
TimetableSchema.index({ examDate: 1 });

module.exports = mongoose.model("Timetable", TimetableSchema);