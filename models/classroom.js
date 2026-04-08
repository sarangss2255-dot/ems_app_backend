const mongoose = require("mongoose");
const { Schema } = mongoose;

const SeatedStudentSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, default: "" },
    fullName: { type: String, default: "" },
    rollNumber: { type: Number, default: 0 },
    className: { type: String, default: "" }
  },
  { _id: false }
);

const ClassroomSchema = new Schema({
  name: { type: String, unique: true },        // "B-101"
  rows: { type: Number, default: 0 },
  benchesPerRow: { type: Number, default: 0 }, // benches in one row
  seatsPerBench: { type: Number, default: 2 }, // typically 2
  capacity: { type: Number, default: 0 },      // must be <= rows*benchesPerRow*seatsPerBench
  pattern: { type: String, enum: ["normal","gap","zigzag"], default: "normal" },
  gap: { type: Number, default: 0 },
  classesAllowed: { type: [String], default: [] }, // multiple classes
  seatingPlan: { type: [[[SeatedStudentSchema]]], default: [] },
  antiCheatReport: { type: Schema.Types.Mixed, default: null },
  seatingGeneratedAt: { type: Date, default: null },
  seatingVersion: { type: Number, default: 0 },
  lastSeatingAction: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model("Classroom", ClassroomSchema);
