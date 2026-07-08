/**
 * Работа с таймзонами без внешних зависимостей — через Intl.
 * Слоты вводятся в таймзоне бизнеса (BOOKING_TIMEZONE), а Google Calendar
 * и все сравнения "в прошлом/в будущем" требуют абсолютного UTC-времени.
 */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseWallClock(dateStr: string, timeStr: string): WallClock {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (dateMatch === null || timeMatch === null) {
    throw new Error(`Некорректные дата/время: ${dateStr} ${timeStr}`);
  }
  return {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
}

/** Смещение таймзоны (мс) относительно UTC в конкретный момент времени. */
export function getTimeZoneOffsetMs(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  const zonedAsUtcMs = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  const truncatedAtMs = Math.floor(at.getTime() / 1000) * 1000;
  return zonedAsUtcMs - truncatedAtMs;
}

/**
 * Переводит "настенные" дату и время в таймзоне бизнеса в абсолютный UTC-момент.
 * Двухпроходный алгоритм корректно обрабатывает переходы на летнее/зимнее время.
 */
export function zonedTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date {
  const wall = parseWallClock(dateStr, timeStr);
  const naiveUtcMs = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    0,
    0,
  );
  const firstGuessMs =
    naiveUtcMs - getTimeZoneOffsetMs(timeZone, new Date(naiveUtcMs));
  const finalMs =
    naiveUtcMs - getTimeZoneOffsetMs(timeZone, new Date(firstGuessMs));
  return new Date(finalMs);
}

/** Текущая дата (YYYY-MM-DD) в заданной таймзоне. */
export function currentDateInTimeZone(timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

/** Человекочитаемая дата для сообщений: "8 июля 2026, 15:00". */
export function formatHumanDateTime(
  at: Date,
  timeZone: string,
  locale: string = "ru-RU",
): string {
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dateFormatter.format(at)}, ${timeFormatter.format(at)}`;
}
