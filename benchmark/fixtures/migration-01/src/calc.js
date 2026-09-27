// CommonJS utility module. Task migration-01 requires migrating the files in
// src/ to native ES modules (import/export) with a documented CommonJS interop
// path for callers that cannot be updated. See benchmark/tasks/migration-01.json.
function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, multiply };
