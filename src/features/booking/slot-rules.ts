import type { AppEnv } from "@/lib/env";
import { BookingError } from "@/lib/errors";
import { zonedTimeToUtc } from "@/lib/timezone";

export interface ResolvedSlot {
  startUtc: Date;
  endUtc: Date;
}

/**
 * Бизнес-правила слота. Zod-схема гарантирует только форму данных;
 * здесь проверяется смысл: слот в будущем, внутри рабочих часов,
 * выровнен по сетке и не дальше горизонта записи.
 * Нарушение — BookingError со статусом 422.
 */
export function resolveAndValidateSlot(
  date: string,
  time: string,
  env: AppEnv,
): ResolvedSlot {
  const startUtc = zonedTimeToUtc(date, time, env.BOOKING_TIMEZONE);
  const endUtc = new Date(
    startUtc.getTime() + env.BOOKING_SLOT_MINUTES * 60_000,
  );

  const now = new Date();
  if (startUtc.getTime() <= now.getTime()) {
    throw new BookingError(
      "SLOT_INVALID",
      "Выбранное время уже прошло — выберите слот в будущем",
      422,
    );
  }

  const horizonMs = env.BOOKING_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  if (startUtc.getTime() - now.getTime() > horizonMs) {
    throw new BookingError(
      "SLOT_INVALID",
      `Запись открыта не более чем на ${env.BOOKING_MAX_DAYS_AHEAD} дней вперёд`,
      422,
    );
  }

  const [hourStr, minuteStr] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const minutesFromOpen =
    hour * 60 + minute - env.BOOKING_OPEN_HOUR * 60;

  if (
    minutesFromOpen < 0 ||
    hour * 60 + minute + env.BOOKING_SLOT_MINUTES >
      env.BOOKING_CLOSE_HOUR * 60
  ) {
    throw new BookingError(
      "SLOT_INVALID",
      `Запись возможна с ${String(env.BOOKING_OPEN_HOUR).padStart(2, "0")}:00 до ${String(env.BOOKING_CLOSE_HOUR).padStart(2, "0")}:00`,
      422,
    );
  }

  if (minutesFromOpen % env.BOOKING_SLOT_MINUTES !== 0) {
    throw new BookingError(
      "SLOT_INVALID",
      `Время должно совпадать с сеткой слотов по ${env.BOOKING_SLOT_MINUTES} минут`,
      422,
    );
  }

  return { startUtc, endUtc };
}

/** Все возможные времена слотов рабочего дня: ["09:00", "10:00", ...]. */
export function enumerateDaySlotTimes(env: AppEnv): string[] {
  const times: string[] = [];
  const openMinutes = env.BOOKING_OPEN_HOUR * 60;
  const closeMinutes = env.BOOKING_CLOSE_HOUR * 60;
  for (
    let cursor = openMinutes;
    cursor + env.BOOKING_SLOT_MINUTES <= closeMinutes;
    cursor += env.BOOKING_SLOT_MINUTES
  ) {
    const hour = Math.floor(cursor / 60);
    const minute = cursor % 60;
    times.push(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
  }
  return times;
}
