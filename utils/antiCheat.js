const { extractAcademicStream, sameAcademicStream } = require("./academicGrouping");

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function normalizeCountMap(map) {
  const values = Object.values(map || {});
  const max = values.length ? Math.max(...values) : 0;
  if (!max) return {};
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = value / max;
  }
  return out;
}

function buildStudentFeatureMap(students, metrics = {}) {
  const absencesNorm = normalizeCountMap(metrics.absencesByStudentId || {});
  const incidentsNorm = normalizeCountMap(metrics.incidentsByStudentId || {});
  const classCounts = students.reduce((acc, s) => {
    const key = s.className || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const streamCounts = students.reduce((acc, s) => {
    const key = extractAcademicStream(s.className);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const total = Math.max(students.length, 1);

  const featureMap = {};
  for (const s of students) {
    const id = String(s._id || s.id || "");
    const classDensity = (classCounts[s.className] || 0) / total;
    const streamDensity = (streamCounts[extractAcademicStream(s.className)] || 0) / total;
    featureMap[id] = {
      absences: absencesNorm[id] || 0,
      incidents: incidentsNorm[id] || 0,
      classDensity,
      streamDensity
    };
  }
  return featureMap;
}

function pairRiskScore(a, b, featureMap) {
  if (!a || !b) return 0;
  const aid = String(a._id || a.id || "");
  const bid = String(b._id || b.id || "");
  const af = featureMap[aid] || { absences: 0, incidents: 0, classDensity: 0 };
  const bf = featureMap[bid] || { absences: 0, incidents: 0, classDensity: 0, streamDensity: 0 };

  const sameClass = a.className && b.className && a.className === b.className ? 1 : 0;
  const sameStream = sameAcademicStream(a, b) ? 1 : 0;
  const rollDistance = Math.abs((a.rollNumber || 0) - (b.rollNumber || 0));
  const rollProximity = sameClass ? 1 / (1 + rollDistance) : 0;
  const behaviorRisk = Math.max(af.incidents, bf.incidents);
  const absenceRisk = Math.max(af.absences, bf.absences);
  const densityRisk = Math.max(af.classDensity, bf.classDensity);
  const streamDensityRisk = Math.max(af.streamDensity || 0, bf.streamDensity || 0);

  // Stream-aware heuristic risk estimator.
  const linear =
    -2.4 +
    1.9 * sameClass +
    1.35 * sameStream +
    1.2 * rollProximity +
    1.5 * behaviorRisk +
    0.7 * absenceRisk +
    0.6 * densityRisk +
    0.75 * streamDensityRisk;
  return sigmoid(linear);
}

module.exports = {
  buildStudentFeatureMap,
  pairRiskScore
};
