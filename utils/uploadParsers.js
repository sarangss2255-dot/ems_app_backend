const csv = require("csv-parser");
const { Readable } = require("stream");
const XLSX = require("xlsx");

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\uFEFF/g, "")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value)
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
      .pipe(
        csv({
          mapHeaders: ({ header }) => normalizeHeader(header),
          mapValues: ({ value }) => String(value || "").trim()
        })
      )
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function parseSpreadsheetBuffer(buffer, fileName = "") {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "xlsx") return parseXlsxBuffer(buffer);
  return parseCsvBuffer(buffer);
}

function parseXlsxBuffer(buffer) {
  return new Promise((resolve, reject) => {
    try {
      // Read the workbook from buffer
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return reject(new Error("XLSX file contains no sheets"));
      }

      // Get the first sheet
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convert sheet to JSON array
      const rawData = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (!rawData.length) {
        return resolve([]);
      }

      // Normalize headers (convert to lowercase, remove special chars)
      const records = rawData.map((row) => {
        const normalizedRow = {};
        for (const [key, value] of Object.entries(row)) {
          normalizedRow[normalizeHeader(key)] = String(value ?? "").trim();
        }
        return normalizedRow;
      });

      // Filter out empty rows
      return resolve(records.filter((row) => Object.values(row).some(Boolean)));
    } catch (error) {
      return reject(new Error(`Failed to parse XLSX upload. ${error.message}`));
    }
  });
}

function pick(row, keys, fallback = "") {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function mapStudentRow(row) {
  const positionalValues = Object.values(row || {}).map((value) => String(value || "").trim()).filter(Boolean);
  const urn = pick(row, ["urn", "username", "user_name", "email"], positionalValues[5] || positionalValues.at(-1) || "");
  const year = pick(row, ["year", "academic_year"], positionalValues[1] || "");
  const program = pick(row, ["program", "course"], positionalValues[2] || "");
  const specialization = pick(row, ["specialization", "department", "branch"], positionalValues[3] || "");
  const derivedClass = [year, program, specialization].filter(Boolean).join(" - ");
  return {
    username: urn,
    password: pick(row, ["password", "passcode", "default_password"], urn || "pass123"),
    fullName: pick(row, ["full_name", "fullname", "student_name", "student_name_", "name"], positionalValues[4] || ""),
    rollNumber: pick(row, ["roll_number", "rollno", "roll", "register_number", "sr_no", "sr._no"], positionalValues[0] || ""),
    className: pick(row, ["class_name", "class", "section"], derivedClass || specialization)
  };
}

function mapTeacherRow(row) {
  return {
    username: pick(row, ["username", "user_name", "email"]),
    password: pick(row, ["password", "passcode", "default_password"], "pass123"),
    fullName: pick(row, ["full_name", "fullname", "teacher_name", "name"]),
    assignedClassroomName: pick(row, ["assigned_classroom", "classroom_name", "hall_name", "room_name"]),
    autoAssign: ["true", "1", "yes", "y", "auto"].includes(
      pick(row, ["auto_assign", "automatic_assignment"], "true").toLowerCase()
    )
  };
}

function mapClassroomRow(row) {
  const rows = Number(pick(row, ["rows", "row_count"], "0"));
  const benchesPerRow = Number(pick(row, ["benches_per_row", "benches", "bench_count"], "0"));
  const seatsPerBench = Number(pick(row, ["seats_per_bench", "seat_per_bench", "seats"], "2"));
  const capacityRaw = Number(pick(row, ["capacity"], "0"));

  return {
    name: pick(row, ["name", "classroom_name", "hall_name", "room_name"]),
    rows,
    benchesPerRow,
    seatsPerBench,
    capacity: capacityRaw > 0 ? capacityRaw : rows * benchesPerRow * seatsPerBench,
    pattern: pick(row, ["pattern"], "normal"),
    gap: Number(pick(row, ["gap"], "0")),
    classesAllowed: toArray(pick(row, ["classes_allowed", "classes", "allowed_classes"], ""))
  };
}

module.exports = {
  parseCsvBuffer,
  parseSpreadsheetBuffer,
  mapStudentRow,
  mapClassroomRow,
  mapTeacherRow
};