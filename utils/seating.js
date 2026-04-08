const { buildStudentFeatureMap, pairRiskScore } = require("./antiCheat");

function generateSeating(classroom, students, options = {}) {
  const rows = Number(classroom.rows || 0);
  const benchesPerRow = Number(classroom.benchesPerRow || 0);
  const seatsPerBench = Number(classroom.seatsPerBench || 2);
  const capacity = rows * benchesPerRow * seatsPerBench;
  const totalStudents = students.length;
  const studentPool = students.slice(0, capacity);
  const featureMap = buildStudentFeatureMap(studentPool, options.metrics || {});

  const seating = createEmptySeating(rows, benchesPerRow, seatsPerBench);
  const placedSeats = [];
  const benchViolations = [];

  for (let row = 0; row < rows; row++) {
    for (let bench = 0; bench < benchesPerRow; bench++) {
      for (let seat = 0; seat < seatsPerBench; seat++) {
        if (!studentPool.length) break;
        const candidateResult = pickLowestRiskCandidate(
          studentPool,
          row,
          bench,
          seat,
          seating,
          placedSeats,
          featureMap
        );
        if (!candidateResult) continue;
        const { student, risk } = candidateResult;
        seating[row][bench][seat] = sanitizeStudent(student);
        placedSeats.push({ row, bench, seat, student, risk });
        const idx = studentPool.findIndex((s) => String(s._id) === String(student._id));
        if (idx >= 0) studentPool.splice(idx, 1);
      }
    }
  }

  for (let row = 0; row < seating.length; row++) {
    for (let bench = 0; bench < seating[row].length; bench++) {
      const classes = seating[row][bench].filter(Boolean).map((student) => student.className).filter(Boolean);
      if (new Set(classes).size !== classes.length) {
        benchViolations.push({ row: row + 1, bench: bench + 1 });
      }
    }
  }

  return {
    seating,
    report: {
      model: "hard-bench-separation-v2",
      placed: placedSeats.length,
      requested: totalStudents,
      maxCapacity: capacity,
      unseated: Math.max(totalStudents - capacity, 0),
      averagePairRisk: average(placedSeats.map((x) => x.risk)),
      sameClassBenchViolations: benchViolations.length,
      benchViolations
    }
  };
}

function createEmptySeating(rows, benchesPerRow, seatsPerBench) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: benchesPerRow }, () => Array.from({ length: seatsPerBench }, () => null))
  );
}

function pickLowestRiskCandidate(pool, row, bench, seat, seating, placedSeats, featureMap) {
  if (!pool.length) return null;

  const benchOccupants = (seating[row]?.[bench] || []).filter(Boolean);
  const hardSafeCandidates = pool.filter(
    (student) => !benchOccupants.some((peer) => peer.className && peer.className === student.className)
  );
  const candidatePool = hardSafeCandidates.length ? hardSafeCandidates : pool;

  let bestStudent = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const student of candidatePool) {
    const neighbors = getNeighborStudents(row, bench, seat, seating, placedSeats);
    const scores = neighbors.map((n) => {
      const pair = pairRiskScore(student, n.student, featureMap);
      return pair * n.weight;
    });
    const sameClassBenchPenalty = benchOccupants.some(
      (peer) => peer.className && peer.className === student.className
    )
      ? 100
      : 0;
    const nearbySameClassPenalty = neighbors.some(
      (neighbor) => neighbor.student.className && neighbor.student.className === student.className
    )
      ? 0.8
      : 0;
    const score =
      (scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0) +
      sameClassBenchPenalty +
      nearbySameClassPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestStudent = student;
    }
  }

  return bestStudent ? { student: bestStudent, risk: round(bestScore) } : null;
}

function getNeighborStudents(row, bench, seat, seating, placedSeats) {
  const neighbors = [];

  const benchSeats = seating[row]?.[bench] || [];
  for (let i = 0; i < benchSeats.length; i++) {
    if (i !== seat && benchSeats[i]) neighbors.push({ student: benchSeats[i], weight: 1.0 });
  }

  const leftBench = seating[row]?.[bench - 1] || [];
  for (const s of leftBench) if (s) neighbors.push({ student: s, weight: 0.55 });
  const rightBench = seating[row]?.[bench + 1] || [];
  for (const s of rightBench) if (s) neighbors.push({ student: s, weight: 0.45 });

  const frontRow = seating[row - 1]?.[bench] || [];
  for (const s of frontRow) if (s) neighbors.push({ student: s, weight: 0.5 });

  for (const placed of placedSeats) {
    if (placed.row === row && Math.abs(placed.bench - bench) <= 2) {
      neighbors.push({ student: placed.student, weight: 0.25 });
    }
  }

  return neighbors;
}

function sanitizeStudent(student) {
  if (!student) return null;
  return {
    _id: student._id || student.id,
    username: student.username || "",
    fullName: student.fullName || "",
    rollNumber: Number(student.rollNumber || 0),
    className: student.className || ""
  };
}

function normalizeStoredSeating(seating) {
  if (!Array.isArray(seating)) return [];
  return seating.map((row) =>
    Array.isArray(row)
      ? row.map((bench) =>
          Array.isArray(bench) ? bench.map((student) => (student ? sanitizeStudent(student) : null)) : []
        )
      : []
  );
}

function findStudentSeat(seating, studentId) {
  for (let row = 0; row < seating.length; row++) {
    for (let bench = 0; bench < seating[row].length; bench++) {
      for (let seat = 0; seat < seating[row][bench].length; seat++) {
        const student = seating[row][bench][seat];
        if (student && String(student._id || student.id) === String(studentId)) {
          return { row: row + 1, bench: bench + 1, seat: seat + 1, student };
        }
      }
    }
  }
  return null;
}

function moveStudent(seatingInput, studentId, targetPosition) {
  const seating = normalizeStoredSeating(seatingInput);
  const current = findStudentSeat(seating, studentId);
  if (!current) throw new Error("Student not found in seating plan");

  const target = getSeatByPosition(seating, targetPosition);
  if (!target) throw new Error("Target seat is out of range");

  const movedStudent = current.student;
  seating[current.row - 1][current.bench - 1][current.seat - 1] = target.student || null;
  seating[target.row - 1][target.bench - 1][target.seat - 1] = movedStudent;

  return {
    seating,
    movedStudent,
    from: current,
    to: {
      row: target.row,
      bench: target.bench,
      seat: target.seat,
      student: movedStudent
    },
    swappedStudent: target.student || null
  };
}

function getSeatByPosition(seating, position = {}) {
  const row = Number(position.row || 0);
  const bench = Number(position.bench || 0);
  const seat = Number(position.seat || 0);
  if (!row || !bench || !seat) return null;
  const student = seating[row - 1]?.[bench - 1]?.[seat - 1];
  if (typeof student === "undefined") return null;
  return { row, bench, seat, student };
}

function seatingToCsv(classroomName, seating) {
  const lines = [["Classroom", classroomName], ["Row", "Bench", "Seat", "Student Name", "Username", "Roll Number", "Class"]];

  for (let row = 0; row < seating.length; row++) {
    for (let bench = 0; bench < seating[row].length; bench++) {
      for (let seat = 0; seat < seating[row][bench].length; seat++) {
        const student = seating[row][bench][seat];
        lines.push([
          String(row + 1),
          String(bench + 1),
          String(seat + 1),
          student?.fullName || "",
          student?.username || "",
          student?.rollNumber != null ? String(student.rollNumber) : "",
          student?.className || ""
        ]);
      }
    }
  }

  return lines.map((line) => line.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function average(values) {
  if (!values.length) return 0;
  return round(values.reduce((a, b) => a + b, 0) / values.length);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = {
  createEmptySeating,
  findStudentSeat,
  generateSeating,
  moveStudent,
  normalizeStoredSeating,
  sanitizeStudent,
  seatingToCsv
};
