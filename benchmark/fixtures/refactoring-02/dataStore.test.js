const assert = require('node:assert');
const store = require('./dataStore');

(async () => {
  // Promise/async style: get() returns a Promise resolving to the value.
  const value = await store.get('a');
  assert.strictEqual(value, 1);

  // A missing key rejects the returned Promise (was the callback's `err` arg).
  await assert.rejects(() => store.get('missing'), /key not found/);

  // The backward-compatible callback wrapper still works for un-migrated callers.
  const viaCallback = await new Promise((resolve, reject) => {
    store.getCallback('b', (err, result) => (err ? reject(err) : resolve(result)));
  });
  assert.strictEqual(viaCallback, 2);

  console.log('data store refactor tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
