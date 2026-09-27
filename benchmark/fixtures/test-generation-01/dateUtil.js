/**
 * A small date utility (all dates are treated in UTC to stay deterministic
 * across time zones). Task test-generation-01 asks for a thorough unit-test
 * suite covering these functions; the implementation itself must not change.
 * See benchmark/tasks/test-generation-01.json.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function assertValidDate(date, fn) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`${fn} expects a valid Date`);
  }
}

/** True when the date falls on Saturday or Sunday (UTC). */
function isWeekend(date) {
  assertValidDate(date, 'isWeekend');
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Returns a new Date `count` business days from `date` (weekends skipped).
 * `count` may be negative to move backwards; it must be an integer.
 */
function addBusinessDays(date, count) {
  assertValidDate(date, 'addBusinessDays');
  if (!Number.isInteger(count)) {
    throw new TypeError('addBusinessDays expects an integer count');
  }
  const result = new Date(date.getTime());
  const step = count >= 0 ? 1 : -1;
  let remaining = Math.abs(count);
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + step);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return result;
}

/** Formats a date as e.g. "Sep 27, 2026" (UTC). */
function formatShortDate(date) {
  assertValidDate(date, 'formatShortDate');
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

module.exports = { isWeekend, addBusinessDays, formatShortDate };
