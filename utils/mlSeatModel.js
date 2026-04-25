const { extractAcademicStream, sameAcademicStream } = require("./academicGrouping");

function sigmoid(value) {
  const bounded = Math.max(Math.min(value, 18), -18);
  return 1 / (1 + Math.exp(-bounded));
}

function buildMlSeatingContext(students, metrics = {}, options = {}) {
  const dataset = buildStudentDataset(students, metrics);
  const labelStats = summarizeLabels(dataset.samples);
  const fallbackReason = getFallbackReason(labelStats, dataset.samples.length);
  const maxEpochs = clampNumber(options.maxEpochs, 160, 40, 400);
  const learningRate = clampNumber(options.learningRate, 0.7, 0.05, 1.5);
  const regularization = clampNumber(options.regularization, 0.015, 0, 0.2);

  let model = null;
  let training = {
    enabled: !fallbackReason,
    fallbackReason: fallbackReason || "",
    sampleCount: dataset.samples.length,
    positiveLabels: labelStats.positives,
    negativeLabels: labelStats.negatives,
    epochs: 0,
    loss: 0,
    accuracy: 0,
    averagePredictedRisk: 0
  };

  if (!fallbackReason) {
    model = trainLogisticRegression(dataset.samples, {
      maxEpochs,
      learningRate,
      regularization
    });
    training = {
      ...training,
      epochs: model.epochs,
      loss: round(model.loss),
      accuracy: round(evaluateAccuracy(model.weights, dataset.samples)),
      averagePredictedRisk: round(average(Object.values(model.studentRiskById)))
    };
  }

  const studentRiskById = model?.studentRiskById || buildFallbackRiskById(dataset);
  return {
    kind: model ? "trained-ml" : "fallback-heuristic",
    sameClassBenchPenalty: 120,
    sameStreamBenchPenalty: 80,
    nearbySameClassPenalty: 1.2,
    nearbySameStreamPenalty: 0.95,
    studentRiskById,
    studentFeaturesById: dataset.studentFeaturesById,
    classProfiles: dataset.classProfiles,
    streamProfiles: dataset.streamProfiles,
    training,
    pairRisk(studentA, studentB) {
      return pairRiskScoreTrained(studentA, studentB, {
        studentRiskById,
        studentFeaturesById: dataset.studentFeaturesById
      });
    }
  };
}

function buildStudentDataset(students, metrics = {}) {
  const studentList = Array.isArray(students) ? students.filter(Boolean) : [];
  const absencesByStudentId = metrics.absencesByStudentId || {};
  const incidentsByStudentId = metrics.incidentsByStudentId || {};
  const absenceNorm = normalizeMap(absencesByStudentId);
  const incidentNorm = normalizeMap(incidentsByStudentId);
  const classProfiles = buildClassProfiles(studentList, incidentsByStudentId, absenceNorm);
  const streamProfiles = buildStreamProfiles(studentList, incidentsByStudentId, absenceNorm);
  const studentFeaturesById = {};
  const samples = [];

  for (const student of studentList) {
    const id = String(student._id || student.id || "");
    const className = student.className || "UNKNOWN";
    const classProfile = classProfiles[className] || {
      sizeRatio: 0,
      incidentRate: 0,
      averageAbsenceRate: 0,
      rankMap: {}
    };
    const streamName = extractAcademicStream(student.className);
    const streamProfile = streamProfiles[streamName] || {
      sizeRatio: 0,
      incidentRate: 0,
      averageAbsenceRate: 0
    };
    const features = {
      absences: absenceNorm[id] || 0,
      incidentHistory: incidentNorm[id] || 0,
      classDensity: classProfile.sizeRatio || 0,
      streamDensity: streamProfile.sizeRatio || 0,
      classIncidentRate: classProfile.incidentRate || 0,
      streamIncidentRate: streamProfile.incidentRate || 0,
      classAverageAbsence: classProfile.averageAbsenceRate || 0,
      rollPercentile: classProfile.rankMap[id] || 0
    };
    studentFeaturesById[id] = features;

    samples.push({
      id,
      label: incidentsByStudentId[id] > 0 ? 1 : 0,
      features: [
        1,
        features.absences,
        features.classDensity,
        features.streamDensity,
        features.classIncidentRate,
        features.streamIncidentRate,
        features.classAverageAbsence,
        features.rollPercentile
      ]
    });
  }

  return { samples, studentFeaturesById, classProfiles, streamProfiles };
}

function buildClassProfiles(students, incidentsByStudentId = {}, absenceNorm = {}) {
  const grouped = {};
  for (const student of students) {
    const className = student.className || "UNKNOWN";
    if (!grouped[className]) grouped[className] = [];
    grouped[className].push(student);
  }

  const totalStudents = Math.max(students.length, 1);
  const profiles = {};
  for (const [className, members] of Object.entries(grouped)) {
    const sorted = members
      .slice()
      .sort((left, right) => Number(left.rollNumber || 0) - Number(right.rollNumber || 0));
    const rankMap = {};
    const denominator = Math.max(sorted.length - 1, 1);
    let incidentCount = 0;
    let totalAbsenceScore = 0;

    sorted.forEach((student, index) => {
      const id = String(student._id || student.id || "");
      rankMap[id] = denominator ? index / denominator : 0;
      if (incidentsByStudentId[id] > 0) incidentCount += 1;
      totalAbsenceScore += Number(absenceNorm[id] || 0);
    });

    profiles[className] = {
      sizeRatio: members.length / totalStudents,
      incidentRate: members.length ? incidentCount / members.length : 0,
      averageAbsenceRate: members.length ? totalAbsenceScore / members.length : 0,
      rankMap
    };
  }

  return profiles;
}

function buildStreamProfiles(students, incidentsByStudentId = {}, absenceNorm = {}) {
  const grouped = {};
  for (const student of students) {
    const stream = extractAcademicStream(student.className);
    if (!grouped[stream]) grouped[stream] = [];
    grouped[stream].push(student);
  }

  const totalStudents = Math.max(students.length, 1);
  const profiles = {};
  for (const [stream, members] of Object.entries(grouped)) {
    let incidentCount = 0;
    let totalAbsenceScore = 0;
    for (const student of members) {
      const id = String(student._id || student.id || "");
      if (incidentsByStudentId[id] > 0) incidentCount += 1;
      totalAbsenceScore += Number(absenceNorm[id] || 0);
    }
    profiles[stream] = {
      sizeRatio: members.length / totalStudents,
      incidentRate: members.length ? incidentCount / members.length : 0,
      averageAbsenceRate: members.length ? totalAbsenceScore / members.length : 0
    };
  }
  return profiles;
}

function summarizeLabels(samples) {
  let positives = 0;
  for (const sample of samples) positives += sample.label ? 1 : 0;
  return {
    positives,
    negatives: Math.max(samples.length - positives, 0)
  };
}

function getFallbackReason(labelStats, sampleCount) {
  if (sampleCount < 8) return "not-enough-training-samples";
  if (!labelStats.positives) return "no-positive-incidents";
  if (!labelStats.negatives) return "no-negative-incidents";
  return "";
}

function trainLogisticRegression(samples, options = {}) {
  const featureCount = samples[0]?.features?.length || 0;
  const weights = Array.from({ length: featureCount }, () => 0);
  const epochs = clampNumber(options.maxEpochs, 160, 40, 400);
  const learningRate = clampNumber(options.learningRate, 0.7, 0.05, 1.5);
  const regularization = clampNumber(options.regularization, 0.015, 0, 0.2);
  let loss = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradients = Array.from({ length: featureCount }, () => 0);
    loss = 0;

    for (const sample of samples) {
      const prediction = sigmoid(dot(weights, sample.features));
      const error = prediction - sample.label;
      loss += crossEntropy(sample.label, prediction);
      for (let index = 0; index < featureCount; index++) {
        gradients[index] += error * sample.features[index];
      }
    }

    for (let index = 0; index < featureCount; index++) {
      const regularizedGradient = gradients[index] / samples.length + regularization * weights[index];
      weights[index] -= learningRate * regularizedGradient;
    }
    loss /= samples.length;
  }

  const studentRiskById = {};
  for (const sample of samples) {
    studentRiskById[sample.id] = round(sigmoid(dot(weights, sample.features)));
  }

  return {
    weights,
    epochs,
    loss,
    studentRiskById
  };
}

function evaluateAccuracy(weights, samples) {
  if (!samples.length) return 0;
  let correct = 0;
  for (const sample of samples) {
    const prediction = sigmoid(dot(weights, sample.features)) >= 0.5 ? 1 : 0;
    if (prediction === sample.label) correct += 1;
  }
  return correct / samples.length;
}

function buildFallbackRiskById(dataset) {
  const out = {};
  for (const sample of dataset.samples) {
    const features = dataset.studentFeaturesById[sample.id] || {};
    const risk =
      0.45 * (features.incidentHistory || 0) +
      0.25 * (features.absences || 0) +
      0.15 * (features.streamIncidentRate || 0) +
      0.2 * (features.classIncidentRate || 0) +
      0.1 * (features.classDensity || 0) +
      0.15 * (features.streamDensity || 0);
    out[sample.id] = round(Math.max(0, Math.min(risk, 1)));
  }
  return out;
}

function pairRiskScoreTrained(studentA, studentB, context = {}) {
  if (!studentA || !studentB) return 0;

  const idA = String(studentA._id || studentA.id || "");
  const idB = String(studentB._id || studentB.id || "");
  const featuresA = context.studentFeaturesById?.[idA] || {};
  const featuresB = context.studentFeaturesById?.[idB] || {};
  const riskA = Number(context.studentRiskById?.[idA] || 0);
  const riskB = Number(context.studentRiskById?.[idB] || 0);

  const sameClass = studentA.className && studentB.className && studentA.className === studentB.className ? 1 : 0;
  const sameStream = sameAcademicStream(studentA, studentB) ? 1 : 0;
  const rollDistance = Math.abs(Number(studentA.rollNumber || 0) - Number(studentB.rollNumber || 0));
  const rollProximity = sameClass ? 1 / (1 + rollDistance) : 0;
  const densityRisk = Math.max(featuresA.classDensity || 0, featuresB.classDensity || 0);
  const streamDensityRisk = Math.max(featuresA.streamDensity || 0, featuresB.streamDensity || 0);
  const absenceRisk = Math.max(featuresA.absences || 0, featuresB.absences || 0);
  const classIncidentRisk = Math.max(featuresA.classIncidentRate || 0, featuresB.classIncidentRate || 0);
  const streamIncidentRisk = Math.max(featuresA.streamIncidentRate || 0, featuresB.streamIncidentRate || 0);
  const learnedRisk = Math.max(riskA, riskB);
  const combinedRisk = (riskA + riskB) / 2;

  const linear =
    -3.1 +
    2.8 * sameClass +
    1.85 * sameStream +
    1.25 * rollProximity +
    1.9 * learnedRisk +
    0.95 * combinedRisk +
    0.7 * densityRisk +
    0.55 * streamDensityRisk +
    0.45 * absenceRisk +
    0.6 * classIncidentRisk +
    0.85 * streamIncidentRisk;

  return sigmoid(linear);
}

function normalizeMap(map = {}) {
  const numericValues = Object.values(map).map((value) => Number(value || 0)).filter((value) => value > 0);
  const max = numericValues.length ? Math.max(...numericValues) : 0;
  if (!max) return {};

  const normalized = {};
  for (const [key, value] of Object.entries(map)) {
    normalized[key] = Number(value || 0) / max;
  }
  return normalized;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index++) {
    total += Number(left[index] || 0) * Number(right[index] || 0);
  }
  return total;
}

function crossEntropy(label, prediction) {
  const boundedPrediction = Math.max(Math.min(prediction, 1 - 1e-8), 1e-8);
  return -(label * Math.log(boundedPrediction) + (1 - label) * Math.log(1 - boundedPrediction));
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

module.exports = {
  buildMlSeatingContext,
  pairRiskScoreTrained
};
