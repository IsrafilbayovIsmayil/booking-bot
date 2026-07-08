import { google, type calendar_v3 } from "googleapis";
import { getEnv, normalizePrivateKey } from "@/lib/env";
import { BookingError, toErrorMessage } from "@/lib/errors";

const CALENDAR_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

/** Метка, по которой мы отличаем события, созданные этой формой. */
export const BOOKING_SOURCE_TAG = "booking-form";

export interface CalendarEventInput {
  summary: string;
  description: string;
  startUtc: Date;
  endUtc: Date;
  timeZone: string;
  location?: string;
}

export interface CreatedCalendarEvent {
  id: string;
  htmlLink: string | null;
  createdAtIso: string;
}

let cachedClient: calendar_v3.Calendar | null = null;

function getCalendarClient(): calendar_v3.Calendar {
  if (cachedClient !== null) {
    return cachedClient;
  }
  const env = getEnv();
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(env.GOOGLE_PRIVATE_KEY),
    scopes: [...CALENDAR_SCOPES],
  });
  cachedClient = google.calendar({ version: "v3", auth });
  return cachedClient;
}

/** Проверка занятости диапазона через freebusy — быстрый предварительный фильтр. */
export async function isRangeBusy(startUtc: Date, endUtc: Date): Promise<boolean> {
  const env = getEnv();
  const client = getCalendarClient();
  try {
    const response = await client.freebusy.query({
      requestBody: {
        timeMin: startUtc.toISOString(),
        timeMax: endUtc.toISOString(),
        items: [{ id: env.GOOGLE_CALENDAR_ID }],
      },
    });
    const busyRanges =
      response.data.calendars?.[env.GOOGLE_CALENDAR_ID]?.busy ?? [];
    return busyRanges.length > 0;
  } catch (error) {
    throw new BookingError(
      "CALENDAR_ERROR",
      `Не удалось проверить занятость календаря: ${toErrorMessage(error)}`,
      502,
    );
  }
}

/** Занятые интервалы за произвольный период (для эндпоинта доступности). */
export async function getBusyRanges(
  startUtc: Date,
  endUtc: Date,
): Promise<ReadonlyArray<{ start: Date; end: Date }>> {
  const env = getEnv();
  const client = getCalendarClient();
  try {
    const response = await client.freebusy.query({
      requestBody: {
        timeMin: startUtc.toISOString(),
        timeMax: endUtc.toISOString(),
        items: [{ id: env.GOOGLE_CALENDAR_ID }],
      },
    });
    const busy = response.data.calendars?.[env.GOOGLE_CALENDAR_ID]?.busy ?? [];
    return busy
      .filter(
        (range): range is { start: string; end: string } =>
          typeof range.start === "string" && typeof range.end === "string",
      )
      .map((range) => ({ start: new Date(range.start), end: new Date(range.end) }));
  } catch (error) {
    throw new BookingError(
      "CALENDAR_ERROR",
      `Не удалось получить расписание: ${toErrorMessage(error)}`,
      502,
    );
  }
}

export async function insertBookingEvent(
  input: CalendarEventInput,
): Promise<CreatedCalendarEvent> {
  const env = getEnv();
  const client = getCalendarClient();
  try {
    const response = await client.events.insert({
      calendarId: env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: {
          dateTime: input.startUtc.toISOString(),
          timeZone: input.timeZone,
        },
        end: {
          dateTime: input.endUtc.toISOString(),
          timeZone: input.timeZone,
        },
        extendedProperties: {
          private: { source: BOOKING_SOURCE_TAG },
        },
      },
    });
    const eventId = response.data.id;
    if (typeof eventId !== "string" || eventId.length === 0) {
      throw new BookingError(
        "CALENDAR_ERROR",
        "Google Calendar не вернул идентификатор созданного события",
        502,
      );
    }
    return {
      id: eventId,
      htmlLink: response.data.htmlLink ?? null,
      createdAtIso: response.data.created ?? new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof BookingError) {
      throw error;
    }
    throw new BookingError(
      "CALENDAR_ERROR",
      `Не удалось создать событие в календаре: ${toErrorMessage(error)}`,
      502,
    );
  }
}

export async function deleteEvent(eventId: string): Promise<void> {
  const env = getEnv();
  const client = getCalendarClient();
  await client.events.delete({
    calendarId: env.GOOGLE_CALENDAR_ID,
    eventId,
  });
}

/**
 * Финальный арбитр гонки двойного бронирования (работает и между разными
 * serverless-инстансами, где мьютекс в памяти бессилен).
 *
 * Инвариант: после events.insert перечисляем ВСЕ активные события,
 * пересекающиеся со слотом. Победитель — событие с самым ранним временем
 * `created` (при равенстве — с лексикографически меньшим id: детерминированный
 * tie-break, одинаковый на всех инстансах). Если наше событие не победило —
 * удаляем его и сообщаем клиенту 409. Оба конкурирующих процесса приходят
 * к одному и тому же победителю, поэтому ровно одна запись выживает.
 */
export async function resolveInsertRaceWinner(
  ourEventId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<{ weWon: boolean }> {
  const env = getEnv();
  const client = getCalendarClient();

  let overlapping: calendar_v3.Schema$Event[];
  try {
    const response = await client.events.list({
      calendarId: env.GOOGLE_CALENDAR_ID,
      timeMin: startUtc.toISOString(),
      timeMax: endUtc.toISOString(),
      singleEvents: true,
      showDeleted: false,
      maxResults: 50,
    });
    overlapping = (response.data.items ?? []).filter(
      (event) => event.status !== "cancelled",
    );
  } catch (error) {
    // Не смогли верифицировать — считаем бронь состоявшейся (событие создано),
    // владелец увидит возможный дубль в календаре. Это осознанный fail-open:
    // отменять оплаченную клиентом запись из-за сбоя листинга хуже.
    console.error(
      `[booking] race-verification listing failed: ${toErrorMessage(error)}`,
    );
    return { weWon: true };
  }

  const rivals = overlapping.filter((event) => event.id !== ourEventId);
  if (rivals.length === 0) {
    return { weWon: true };
  }

  const ourEvent = overlapping.find((event) => event.id === ourEventId);
  const ourCreated = ourEvent?.created ?? new Date().toISOString();

  const weLostToSomeone = rivals.some((rival) => {
    const rivalCreated = rival.created ?? "";
    if (rivalCreated === ourCreated) {
      return (rival.id ?? "") < ourEventId;
    }
    return rivalCreated < ourCreated;
  });

  if (!weLostToSomeone) {
    return { weWon: true };
  }

  try {
    await deleteEvent(ourEventId);
  } catch (error) {
    console.error(
      `[booking] failed to roll back losing event ${ourEventId}: ${toErrorMessage(error)}`,
    );
  }
  return { weWon: false };
}
