/**
 * Callback-based data-access module (Node-style `fn(args, (err, result) => {})`).
 *
 * Task refactoring-02: convert the public surface to Promise-returning async
 * functions (usable with async/await), keeping a thin backward-compatible
 * callback wrapper exported as `getCallback` for callers not migrated in this
 * change. Errors that previously arrived as the callback's `err` argument must
 * reject the returned Promise with an equivalent error.
 * See benchmark/tasks/refactoring-02.json.
 */
const store = new Map([
  ['a', 1],
  ['b', 2],
]);

// Node-style callback API: get(key, (err, value) => {}).
function get(key, callback) {
  setImmediate(() => {
    if (!store.has(key)) {
      callback(new Error(`key not found: ${key}`));
      return;
    }
    callback(null, store.get(key));
  });
}

// Backward-compatible callback alias (kept stable through the refactor).
function getCallback(key, callback) {
  get(key, callback);
}

module.exports = { get, getCallback };
