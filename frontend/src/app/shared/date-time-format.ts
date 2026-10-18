const dateFormatter = new Intl.DateTimeFormat('de-AT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const utcDateFormatter = new Intl.DateTimeFormat('de-AT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
const timeFormatter = new Intl.DateTimeFormat('de-AT', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type DateTimeValue = Date | string | null | undefined;

export function formatDate(value: DateTimeValue): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const [, year, month, day] = match;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day)
      )
        return '';
      return utcDateFormatter.format(date);
    }
  }
  const date = toValidDate(value);
  return date ? dateFormatter.format(date) : '';
}

export function formatTime(value: DateTimeValue): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(value);
    if (match) return `${match[1]}:${match[2]}`;
  }
  const date = toValidDate(value);
  return date ? timeFormatter.format(date) : '';
}

export function formatDateTime(value: DateTimeValue): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.test(value))
    return formatTime(value);
  const date = toValidDate(value);
  return date ? `${dateFormatter.format(date)} ${timeFormatter.format(date)}` : '';
}

function toValidDate(value: DateTimeValue): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
