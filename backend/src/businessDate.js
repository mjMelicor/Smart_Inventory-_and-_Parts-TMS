function dateTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function localMidnightToUtc(year, month, day, timeZone) {
  const target = Date.UTC(year, month - 1, day);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = dateTimeParts(new Date(candidate), timeZone);
    const representedLocalTime = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    const difference = representedLocalTime - target;
    if (difference === 0) return new Date(candidate);
    candidate -= difference;
  }
  throw new RangeError('Could not resolve local midnight for the selected time zone.');
}

export function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function businessDateRange(dateText, timeZone) {
  if (typeof dateText !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new RangeError('Enter a valid date in YYYY-MM-DD format.');
  }
  const [year, month, day] = dateText.split('-').map(Number);
  const dateCheck = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dateCheck.getTime()) || dateCheck.toISOString().slice(0, 10) !== dateText) {
    throw new RangeError('Enter a valid date in YYYY-MM-DD format.');
  }
  const start = localMidnightToUtc(year, month, day, timeZone);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const end = localMidnightToUtc(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate(), timeZone);
  return { date: dateText, start, end };
}
