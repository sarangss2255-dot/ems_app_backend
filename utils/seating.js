const { buildStudentFeatureMap, pairRiskScore } = require("./antiCheat");

function generateSeating(classroom, students, options = {}) {
  const rows = Number(classroom.rows || 0);
  const benchesPerRow = Number(classroom.benchesPerRow || 0);
  const seatsPerBench = Number(classroom.seatsPerBench || 2);
  const capacity = rows * benchesPerRow * seatsPerBench;
  const totalStudents = students.length;
  const studentPool = students.slice(0, capacity);
  const featureMap = buildStudentFeatureMap(studentPool, options.metrics || {});

  const seating = Array.from({ length: rows }, () =>
    Array.from({ length: benchesPerRow }, () => Array.from({ length: seatsPerBench }, () => null))
  );
  const placedSeats = [];

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
        seating[row][bench][seat] = student;
        placedSeats.push({ row, bench, seat, student, risk });
        const idx = studentPool.findIndex((s) => String(s._id) === String(student._id));
        if (idx >= 0) studentPool.splice(idx, 1);
      }
    }
  }

  return {
    seating,
    report: {
      model: "weighted-linear-risk-v1",
      placed: placedSeats.length,
      requested: totalStudents,
      maxCapacity: capacity,
      unseated: Math.max(totalStudents - capacity, 0),
      averagePairRisk: average(placedSeats.map((x) => x.risk))
    }
  };
}

function pickLowestRiskCandidate(pool, row, bench, seat, seating, placedSeats, featureMap) {
  if (!pool.length) return null;

  let bestStudent = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const student of pool) {
    const neighbors = getNeighborStudents(row, bench, seat, seating, placedSeats);
    const scores = neighbors.map((n) => {
      const pair = pairRiskScore(student, n.student, featureMap);
      return pair * n.weight;
    });
    const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
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

function average(values) {
  if (!values.length) return 0;
  return round(values.reduce((a, b) => a + b, 0) / values.length);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = {
  generateSeating,
  findStudentSeat
};
