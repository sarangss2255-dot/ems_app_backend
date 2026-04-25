function normalizeAcademicLabel(value) {
  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function extractAcademicStream(className) {
  const normalized = normalizeAcademicLabel(className);
  if (!normalized) return "UNKNOWN";

  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return "UNKNOWN";

  const first = tokens[0];
  if (/^\d/.test(first) && tokens.length > 1) {
    return tokens[1];
  }
  return first;
}

function sameAcademicStream(left, right) {
  const streamLeft = extractAcademicStream(left?.className || left);
  const streamRight = extractAcademicStream(right?.className || right);
  return !!streamLeft && !!streamRight && streamLeft !== "UNKNOWN" && streamLeft === streamRight;
}

module.exports = {
  extractAcademicStream,
  normalizeAcademicLabel,
  sameAcademicStream
};
