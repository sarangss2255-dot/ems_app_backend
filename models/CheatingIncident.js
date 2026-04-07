const mongoose = require("mongoose");
const { Schema } = mongoose;

const CheatingIncidentSchema = new Schema(
  {
    classroom: { type: Schema.Types.ObjectId, ref: "Classroom", required: true },
    teacher: { type: Schema.Types.ObjectId, ref: "User", required: true },
    student: { type: Schema.Types.ObjectId, ref: "User", required: true },
    severity: { type: Number, min: 1, max: 5, default: 1 },
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CheatingIncident", CheatingIncidentSchema);
