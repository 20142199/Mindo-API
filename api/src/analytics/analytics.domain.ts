import { BadRequestException } from '@nestjs/common';

export type AnalyticsGranularity = 'day' | 'week' | 'month';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function localDateParts(date: Date) {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseLocalDate(value: string, endExclusive = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day + (endExclusive ? 1 : 0)) - VN_OFFSET_MS;
  const date = new Date(utc);
  const verified = localDateParts(new Date(Date.UTC(year, month - 1, day) - VN_OFFSET_MS));
  if (verified.year !== year || verified.month !== month || verified.day !== day) throw new BadRequestException('Khoảng ngày không hợp lệ');
  return date;
}

export function resolveAnalyticsPeriod(from?: string, to?: string, granularity?: string, now = new Date()) {
  const today = localDateParts(now);
  const defaultTo = formatParts(today.year, today.month, today.day);
  const defaultFromDate = new Date(parseLocalDate(defaultTo).getTime() - 29 * DAY_MS);
  const defaultFromParts = localDateParts(defaultFromDate);
  const resolvedFrom = from ?? formatParts(defaultFromParts.year, defaultFromParts.month, defaultFromParts.day);
  const resolvedTo = to ?? defaultTo;
  const start = parseLocalDate(resolvedFrom);
  const endExclusive = parseLocalDate(resolvedTo, true);
  const durationMs = endExclusive.getTime() - start.getTime();
  if (durationMs <= 0) throw new BadRequestException('Ngày kết thúc phải từ ngày bắt đầu trở đi');
  if (durationMs > 366 * DAY_MS) throw new BadRequestException('Khoảng báo cáo tối đa là 366 ngày');
  const resolvedGranularity: AnalyticsGranularity = granularity === 'week' || granularity === 'month' ? granularity : 'day';
  return {
    from: resolvedFrom,
    to: resolvedTo,
    start,
    endExclusive,
    previousStart: new Date(start.getTime() - durationMs),
    previousEndExclusive: start,
    granularity: resolvedGranularity,
  };
}

export function analyticsBucketKey(date: Date, granularity: AnalyticsGranularity) {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  if (granularity === 'month') return `${year}-${String(month).padStart(2, '0')}`;
  if (granularity === 'week') {
    const weekday = shifted.getUTCDay() || 7;
    const monday = new Date(Date.UTC(year, month - 1, day - weekday + 1));
    return formatParts(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
  }
  return formatParts(year, month, day);
}

export function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

