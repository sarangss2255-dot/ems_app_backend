const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, unique: true },
  password: { type: String }, // hashed
  initialPassword: { type: String, default: "" }, // admin-visible bootstrap credential
  fullName: { type: String },
  role: { type: String, enum: ["admin","teacher","student"], default: "student" },
  rollNumber: { type: Number },    // for students
  className: { type: String },     // e.g. "CSE-A"
  assignedClassroom: { type: Schema.Types.ObjectId, ref: "Classroom", default: null } // for teachers
}, { timestamps: true });

module.exports = mongoose.model("User", UserSchema);
