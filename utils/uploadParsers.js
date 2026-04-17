const csv = require("csv-parser");
const { Readable } = require("stream");
const XLSX = require("xlsx");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

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
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if (ext === ".xlsx") return parseXlsxBuffer(buffer);
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
      return parseXlsxBufferFallback(buffer)
        .then(resolve)
        .catch((fallbackError) => reject(new Error(`Failed to parse XLSX upload. ${fallbackError.message}`)));
    }
  });
}

function parseXlsxBufferFallback(buffer) {
  return new Promise((resolve, reject) => {
    const tempBase = path.join(os.tmpdir(), `exam_upload_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const xlsxPath = `${tempBase}.xlsx`;
    const scriptPath = `${tempBase}.ps1`;
    fs.writeFileSync(xlsxPath, buffer);

    const script = `
param([string]$path)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipRoot = Join-Path ([System.IO.Path]::GetDirectoryName($path)) ([System.IO.Path]::GetFileNameWithoutExtension($path) + "_unzipped")
if (Test-Path $zipRoot) { Remove-Item -Recurse -Force $zipRoot }
[System.IO.Compression.ZipFile]::ExtractToDirectory($path, $zipRoot)
$shared = @()
$sharedPath = Join-Path $zipRoot 'xl\\sharedStrings.xml'
if (Test-Path $sharedPath) {
  [xml]$sx = Get-Content -LiteralPath $sharedPath -Raw
  foreach ($si in $sx.sst.si) {
    if ($si.t) { $shared += [string]$si.t }
    elseif ($si.r) { $shared += (($si.r | ForEach-Object { $_.t.'#text' }) -join '') }
    else { $shared += '' }
  }
}
[xml]$workbook = Get-Content -LiteralPath (Join-Path $zipRoot 'xl\\workbook.xml') -Raw
[xml]$rels = Get-Content -LiteralPath (Join-Path $zipRoot 'xl\\_rels\\workbook.xml.rels') -Raw
$sheet = $workbook.workbook.sheets.sheet | Select-Object -First 1
$rid = $sheet.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
$target = ($rels.Relationships.Relationship | Where-Object { $_.Id -eq $rid }).Target
$sheetPath = Join-Path $zipRoot ('xl\\' + $target.Replace('/','\\'))
[xml]$sheetXml = Get-Content -LiteralPath $sheetPath -Raw
function Get-CellValue($cell) {
  if (-not $cell) { return '' }
  $type = $cell.t
  $value = $cell.v
  if ($null -eq $value) { return '' }
  if ($type -eq 's') { return $shared[[int]$value] }
  return [string]$value
}
$rows = @()
foreach ($row in $sheetXml.worksheet.sheetData.row) {
  $values = @()
  foreach ($cell in $row.c) { $values += (Get-CellValue $cell) }
  $rows += ,@($values)
}
$rows | ConvertTo-Json -Depth 6 -Compress
Remove-Item -Force $path
Remove-Item -Recurse -Force $zipRoot
`;
    fs.writeFileSync(scriptPath, script, "utf8");

    const candidates = [
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      "powershell.exe",
      "pwsh.exe"
    ];

    runPowerShellCandidate(
      candidates,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, xlsxPath],
      (error, stdout, stderr) => {
        cleanupTempFiles(xlsxPath, scriptPath);
        if (error) {
          const message = stderr ? `${error.message}: ${stderr}` : error.message;
          return reject(new Error(message));
        }
        try {
          const rows = JSON.parse(String(stdout || "[]"));
          const arrayRows = normalizeWorksheetRows(rows);
          if (!arrayRows.length) return resolve([]);
          const headers = toValueArray(arrayRows[0]).map((header) => normalizeHeader(header));
          const records = arrayRows.slice(1).map((values) => {
            const row = {};
            const valueArray = toValueArray(values);
            headers.forEach((header, index) => {
              row[header] = String(valueArray[index] ?? "").trim();
            });
            return row;
          });
          return resolve(records.filter((row) => Object.values(row).some(Boolean)));
        } catch (parseError) {
          return reject(parseError);
        }
      }
    );
  });
}

function runPowerShellCandidate(commands, args, done, index = 0) {
  const command = commands[index];
  if (!command) {
    return done(new Error("No PowerShell runtime was available to process XLSX files"), "", "");
  }

  execFile(
    command,
    args,
    { windowsHide: true, maxBuffer: 1024 * 1024 * 64, timeout: 120000 },
    (error, stdout, stderr) => {
      if (error && (error.code === "ENOENT" || error.code === "EPERM") && index < commands.length - 1) {
        return runPowerShellCandidate(commands, args, done, index + 1);
      }
      return done(error, stdout, stderr);
    }
  );
}

function cleanupTempFiles(xlsxPath, scriptPath) {
  try {
    if (fs.existsSync(xlsxPath)) fs.unlinkSync(xlsxPath);
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
  } catch (_) {}
}

function normalizeWorksheetRows(rows) {
  if (Array.isArray(rows)) return rows;
  if (!rows || typeof rows !== "object") return [];
  return [rows];
}

function toValueArray(row) {
  if (Array.isArray(row)) {
    if (row.length === 1 && (Array.isArray(row[0]) || (row[0] && typeof row[0] === "object"))) {
      return toValueArray(row[0]);
    }
    return row.map((value) => {
      if (Array.isArray(value) && value.length === 1) return value[0];
      if (value && typeof value === "object") {
        const nested = toValueArray(value);
        return nested.length === 1 ? nested[0] : nested.join(" ");
      }
      return value;
    });
  }
  if (!row || typeof row !== "object") return [];
  if ("value" in row) return toValueArray(row.value);
  if ("Value" in row) return toValueArray(row.Value);
  const numericKeys = Object.keys(row)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b));
  if (numericKeys.length) {
    return numericKeys.map((key) => row[key]);
  }
  return Object.values(row).flatMap((value) => toValueArray(value));
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
