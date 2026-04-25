const { buildStudentFeatureMap, pairRiskScore } = require("./antiCheat");
const { buildMlSeatingContext } = require("./mlSeatModel");
const { sameAcademicStream } = require("./academicGrouping");

function generateSeating(classroom, students, options = {}) {
  const rows = Number(classroom.rows || 0);
  const benchesPerRow = Number(classroom.benchesPerRow || 0);
  const seatsPerBench = Number(classroom.seatsPerBench || 2);
  const capacity = rows * benchesPerRow * seatsPerBench;
  const totalStudents = students.length;
  const basePool = students.slice(0, capacity);
  const featureMap = buildStudentFeatureMap(basePool, options.metrics || {});
  const selectedStrategy = String(options.seatingStrategy || "reinforcement-guided").toLowerCase();
  const heuristicScoring = createHeuristicScoringContext(featureMap);

  if (selectedStrategy === "trained-ml") {
    const mlContext = buildMlSeatingContext(basePool, options.metrics || {}, options.trainingOptions || {});
    return generateModelGuidedSeating(
      rows,
      benchesPerRow,
      seatsPerBench,
      capacity,
      totalStudents,
      basePool,
      mlContext
    );
  }

  if (selectedStrategy === "greedy") {
    return generateGreedySeating(
      rows,
      benchesPerRow,
      seatsPerBench,
      capacity,
      totalStudents,
      basePool,
      heuristicScoring
    );
  }

  const episodeCount = Math.max(4, Math.min(Number(options.rlEpisodes || 12), 30));
  const qTable = {};

  let bestResult = null;
  for (let episode = 0; episode < episodeCount; episode++) {
    const epsilon = Math.max(0.05, 0.28 - episode * 0.02);
    const alpha = 0.22;
    const episodeResult = runReinforcementEpisode(
      rows,
      benchesPerRow,
      seatsPerBench,
      basePool,
      heuristicScoring,
      qTable,
      { epsilon, alpha }
    );
    if (!bestResult || episodeResult.totalScore < bestResult.totalScore) {
      bestResult = episodeResult;
    }
  }

  const seating = bestResult?.seating || createEmptySeating(rows, benchesPerRow, seatsPerBench);
  const placedSeats = bestResult?.placedSeats || [];
  const benchViolations = bestResult?.benchViolations || [];
  const violationSummary = summarizeBenchViolations(benchViolations);

  return {
    seating,
    report: {
      model: "reinforcement-guided-seat-policy-v1",
      placed: placedSeats.length,
      requested: totalStudents,
      maxCapacity: capacity,
      unseated: Math.max(totalStudents - capacity, 0),
      averagePairRisk: bestResult ? round(bestResult.averageRisk) : average(placedSeats.map((x) => x.risk)),
      sameClassBenchViolations: violationSummary.sameClassCount,
      sameStreamBenchViolations: violationSummary.sameStreamCount,
      totalBenchViolations: violationSummary.totalCount,
      benchViolations,
      reinforcementLearning: {
        strategy: "epsilon-greedy contextual seat policy",
        episodes: episodeCount,
        exploredStates: Object.keys(qTable).length,
        score: bestResult ? round(bestResult.totalScore) : 0
      }
    }
  };
}

function generateGreedySeating(rows, benchesPerRow, seatsPerBench, capacity, totalStudents, basePool, featureMap) {
  const seating = createEmptySeating(rows, benchesPerRow, seatsPerBench);
  const studentPool = basePool.slice();
  const placedSeats = [];

  for (let row = 0; row < rows; row++) {
    for (let bench = 0; bench < benchesPerRow; bench++) {
      for (let seat = 0; seat < seatsPerBench; seat++) {
        if (!studentPool.length) break;
        const candidateResult = pickGreedyCandidate(studentPool, row, bench, seat, seating, placedSeats, featureMap);
        if (!candidateResult) continue;
        const { student, risk } = candidateResult;
        seating[row][bench][seat] = sanitizeStudent(student);
        placedSeats.push({ row, bench, seat, student, risk });
        const idx = studentPool.findIndex((s) => String(s._id) === String(student._id));
        if (idx >= 0) studentPool.splice(idx, 1);
      }
    }
  }

  const benchViolations = collectBenchViolations(seating);
  const violationSummary = summarizeBenchViolations(benchViolations);
  return {
    seating,
    report: {
      model: "hard-bench-separation-v2",
      placed: placedSeats.length,
      requested: totalStudents,
      maxCapacity: capacity,
      unseated: Math.max(totalStudents - capacity, 0),
      averagePairRisk: average(placedSeats.map((x) => x.risk)),
      sameClassBenchViolations: violationSummary.sameClassCount,
      sameStreamBenchViolations: violationSummary.sameStreamCount,
      totalBenchViolations: violationSummary.totalCount,
      benchViolations,
      reinforcementLearning: {
        strategy: "disabled",
        episodes: 0,
        exploredStates: 0,
        score: 0
      }
    }
  };
}

function generateModelGuidedSeating(rows, benchesPerRow, seatsPerBench, capacity, totalStudents, basePool, mlContext) {
  const seating = createEmptySeating(rows, benchesPerRow, seatsPerBench);
  const studentPool = rankStudentsByModelRisk(basePool, mlContext.studentRiskById || {});
  const placedSeats = [];

  for (let row = 0; row < rows; row++) {
    for (let bench = 0; bench < benchesPerRow; bench++) {
      for (let seat = 0; seat < seatsPerBench; seat++) {
        if (!studentPool.length) break;
        const candidateResult = pickGreedyCandidate(studentPool, row, bench, seat, seating, placedSeats, mlContext);
        if (!candidateResult) continue;
        const { student, risk } = candidateResult;
        seating[row][bench][seat] = sanitizeStudent(student);
        placedSeats.push({ row, bench, seat, student, risk });
        const idx = studentPool.findIndex((item) => String(item._id) === String(student._id));
        if (idx >= 0) studentPool.splice(idx, 1);
      }
    }
  }

  const benchViolations = collectBenchViolations(seating);
  const violationSummary = summarizeBenchViolations(benchViolations);
  return {
    seating,
    report: {
      model: "trained-logistic-student-risk-v1",
      placed: placedSeats.length,
      requested: totalStudents,
      maxCapacity: capacity,
      unseated: Math.max(totalStudents - capacity, 0),
      averagePairRisk: average(placedSeats.map((item) => item.risk)),
      sameClassBenchViolations: violationSummary.sameClassCount,
      sameStreamBenchViolations: violationSummary.sameStreamCount,
      totalBenchViolations: violationSummary.totalCount,
      benchViolations,
      machineLearning: {
        strategy: mlContext.kind,
        sampleCount: mlContext.training.sampleCount,
        positiveLabels: mlContext.training.positiveLabels,
        negativeLabels: mlContext.training.negativeLabels,
        epochs: mlContext.training.epochs,
        loss: mlContext.training.loss,
        accuracy: mlContext.training.accuracy,
        averagePredictedRisk: mlContext.training.averagePredictedRisk,
        fallbackReason: mlContext.training.fallbackReason || ""
      }
    }
  };
}

function runReinforcementEpisode(rows, benchesPerRow, seatsPerBench, basePool, featureMap, qTable, config) {
  const seating = createEmptySeating(rows, benchesPerRow, seatsPerBench);
  const studentPool = shuffle(basePool.slice());
  const placedSeats = [];

  for (let row = 0; row < rows; row++) {
    for (let bench = 0; bench < benchesPerRow; bench++) {
      for (let seat = 0; seat < seatsPerBench; seat++) {
        if (!studentPool.length) break;
        const candidateResult = pickReinforcementCandidate(
          studentPool,
          row,
          bench,
          seat,
          seating,
          placedSeats,
          featureMap,
          qTable,
          config
        );
        if (!candidateResult) continue;

        const { student, risk, reward, seatKey } = candidateResult;
        seating[row][bench][seat] = sanitizeStudent(student);
        placedSeats.push({ row, bench, seat, student, risk, reward });
        updateQValue(qTable, seatKey, student.className || "__unknown__", reward, config.alpha);

        const idx = studentPool.findIndex((s) => String(s._id) === String(student._id));
        if (idx >= 0) studentPool.splice(idx, 1);
      }
    }
  }

  const benchViolations = collectBenchViolations(seating);
  const totalScore = evaluateSeatingScore(seating, featureMap);
  const terminalReward = -totalScore;
  for (const placement of placedSeats) {
    updateQValue(
      qTable,
      seatStateKey(placement.row, placement.bench, placement.seat),
      placement.student.className || "__unknown__",
      terminalReward,
      config.alpha * 0.6
    );
  }

  return {
    seating,
    placedSeats,
    benchViolations,
    totalScore,
    averageRisk: average(placedSeats.map((x) => x.risk))
  };
}

function createEmptySeating(rows, benchesPerRow, seatsPerBench) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: benchesPerRow }, () => Array.from({ length: seatsPerBench }, () => null))
  );
}

function pickReinforcementCandidate(pool, row, bench, seat, seating, placedSeats, featureMap, qTable, config) {
  if (!pool.length) return null;

  const benchOccupants = (seating[row]?.[bench] || []).filter(Boolean);
  const classSafeCandidates = pool.filter(
    (student) => !benchOccupants.some((peer) => peer.className && peer.className === student.className)
  );
  const streamSafeCandidates = pool.filter(
    (student) => !benchOccupants.some((peer) => sameAcademicStream(peer, student))
  );
  const candidatePool = streamSafeCandidates.length
    ? streamSafeCandidates
    : classSafeCandidates.length
        ? classSafeCandidates
        : pool;
  const seatKey = seatStateKey(row, bench, seat);

  let bestCandidate = null;
  let bestPolicyScore = Number.POSITIVE_INFINITY;
  const exploredCandidates = [];
  for (const student of candidatePool) {
    const score = computeLocalSeatScore(student, row, bench, seat, seating, placedSeats, featureMap);
    const learnedBias = getQValue(qTable, seatKey, student.className || "__unknown__");
    const policyScore = score - learnedBias;
    exploredCandidates.push({ student, score, policyScore });
    if (policyScore < bestPolicyScore) {
      bestPolicyScore = policyScore;
      bestCandidate = { student, score };
    }
  }

  if (!bestCandidate) return null;

  let selected = bestCandidate;
  if (Math.random() < config.epsilon && exploredCandidates.length > 1) {
    const ranked = exploredCandidates.sort((a, b) => a.policyScore - b.policyScore).slice(0, 3);
    const exploratory = ranked[Math.floor(Math.random() * ranked.length)];
    selected = { student: exploratory.student, score: exploratory.score };
  }

  return {
    student: selected.student,
    risk: round(selected.score),
    reward: round(-selected.score),
    seatKey
  };
}

function pickGreedyCandidate(pool, row, bench, seat, seating, placedSeats, featureMap) {
  if (!pool.length) return null;

  const benchOccupants = (seating[row]?.[bench] || []).filter(Boolean);
  const classSafeCandidates = pool.filter(
    (student) => !benchOccupants.some((peer) => peer.className && peer.className === student.className)
  );
  const streamSafeCandidates = pool.filter(
    (student) => !benchOccupants.some((peer) => sameAcademicStream(peer, student))
  );
  const candidatePool = streamSafeCandidates.length
    ? streamSafeCandidates
    : classSafeCandidates.length
        ? classSafeCandidates
        : pool;

  let bestStudent = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const student of candidatePool) {
    const score = computeLocalSeatScore(student, row, bench, seat, seating, placedSeats, featureMap);
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

function computeLocalSeatScore(student, row, bench, seat, seating, placedSeats, scoringContext) {
  const benchOccupants = (seating[row]?.[bench] || []).filter(Boolean);
  const neighbors = getNeighborStudents(row, bench, seat, seating, placedSeats);
  const scores = neighbors.map((neighbor) => scoringContext.pairRisk(student, neighbor.student) * neighbor.weight);
  const sameClassBenchPenalty = benchOccupants.some(
    (peer) => peer.className && peer.className === student.className
  )
    ? scoringContext.sameClassBenchPenalty
    : 0;
  const sameStreamBenchPenalty = benchOccupants.some((peer) => sameAcademicStream(peer, student))
    ? scoringContext.sameStreamBenchPenalty
    : 0;
  const nearbySameClassPenalty = neighbors.some(
    (neighbor) => neighbor.student.className && neighbor.student.className === student.className
  )
    ? scoringContext.nearbySameClassPenalty
    : 0;
  const nearbySameStreamPenalty = neighbors.some((neighbor) => sameAcademicStream(neighbor.student, student))
    ? scoringContext.nearbySameStreamPenalty
    : 0;
  return (scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0) +
    sameClassBenchPenalty +
    sameStreamBenchPenalty +
    nearbySameClassPenalty +
    nearbySameStreamPenalty;
}

function evaluateSeatingScore(seating, scoringContext) {
  let totalRisk = 0;
  let occupiedSeats = 0;

  for (let row = 0; row < seating.length; row++) {
    for (let bench = 0; bench < seating[row].length; bench++) {
      for (let seat = 0; seat < seating[row][bench].length; seat++) {
        const student = seating[row][bench][seat];
        if (!student) continue;
        occupiedSeats += 1;
        totalRisk += computeLocalSeatScore(student, row, bench, seat, seating, [], scoringContext);
      }
    }
  }

  const benchViolations = summarizeBenchViolations(collectBenchViolations(seating)).totalCount;
  const normalizedRisk = occupiedSeats ? totalRisk / occupiedSeats : 0;
  return normalizedRisk + benchViolations * 25;
}

function collectBenchViolations(seating) {
  const benchViolations = [];
  for (let row = 0; row < seating.length; row++) {
    for (let bench = 0; bench < seating[row].length; bench++) {
      const occupants = seating[row][bench].filter(Boolean);
      const classes = occupants.map((student) => student.className).filter(Boolean);
      const streams = occupants.map((student) => student.className).filter(Boolean);
      const hasSameClass = new Set(classes).size !== classes.length;
      const hasSameStream = streams.some((current, index) =>
        streams.some((other, otherIndex) => otherIndex !== index && sameAcademicStream(current, other))
      );
      if (hasSameClass || hasSameStream) {
        benchViolations.push({
          row: row + 1,
          bench: bench + 1,
          sameClass: hasSameClass,
          sameStream: hasSameStream
        });
      }
    }
  }
  return benchViolations;
}

function summarizeBenchViolations(benchViolations) {
  return {
    totalCount: benchViolations.length,
    sameClassCount: benchViolations.filter((item) => item.sameClass).length,
    sameStreamCount: benchViolations.filter((item) => item.sameStream).length
  };
}

function seatStateKey(row, bench, seat) {
  return `r${row + 1}-b${bench + 1}-s${seat + 1}`;
}

function getQValue(qTable, seatKey, className) {
  return qTable[seatKey]?.[className] || 0;
}

function updateQValue(qTable, seatKey, className, reward, alpha) {
  if (!qTable[seatKey]) qTable[seatKey] = {};
  const current = qTable[seatKey][className] || 0;
  qTable[seatKey][className] = current + alpha * (reward - current);
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function createHeuristicScoringContext(featureMap) {
  return {
    kind: "heuristic",
    sameClassBenchPenalty: 100,
    sameStreamBenchPenalty: 70,
    nearbySameClassPenalty: 0.8,
    nearbySameStreamPenalty: 0.7,
    pairRisk(studentA, studentB) {
      return pairRiskScore(studentA, studentB, featureMap);
    }
  };
}

function rankStudentsByModelRisk(students, studentRiskById) {
  return students.slice().sort((left, right) => {
    const leftRisk = Number(studentRiskById[String(left._id || left.id || "")] || 0);
    const rightRisk = Number(studentRiskById[String(right._id || right.id || "")] || 0);
    if (rightRisk !== leftRisk) return rightRisk - leftRisk;
    const leftRoll = Number(left.rollNumber || 0);
    const rightRoll = Number(right.rollNumber || 0);
    return leftRoll - rightRoll;
  });
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
  if (!Array.isArray(seating)) return null;
  for (let row = 0; row < seating.length; row++) {
    if (!Array.isArray(seating[row])) continue;
    for (let bench = 0; bench < seating[row].length; bench++) {
      if (!Array.isArray(seating[row][bench])) continue;
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
