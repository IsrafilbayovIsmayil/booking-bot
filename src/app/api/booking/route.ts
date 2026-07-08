import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { bookingRequestSchema } from "@/features/booking/schema";
import { resolveAndValidateSlot } from "@/features/booking/slot-rules";
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  BookingSuccessPayload,
} from "@/features/booking/types";
import { getEnv } from "@/lib/env";
import { BookingError, isBookingError, toErrorMessage } from "@/lib/errors";
import {
  deleteEvent,
  insertBookingEvent,
  isRangeBusy,
  resolveInsertRaceWinner,
} from "@/lib/google-calendar";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { withSlotLock } from "@/lib/slot-mutex";
import { formatHumanDateTime } from "@/lib/timezone";
import {
  buildConfirmationMessage,
  getWhatsAppProvider,
} from "@/lib/whatsapp";

// Интеграции используют Node-примитивы (googleapis, Buffer, crypto) —
// закрепляем Node.js-рантайм и запрещаем статическую оптимизацию роута.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

function errorResponse(error: BookingError, requestId: string): NextResponse {
  const body: ApiErrorResponse = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.fieldErrors !== undefined
        ? { fieldErrors: { ...error.fieldErrors } }
        : {}),
    },
  };
  return NextResponse.json(body, {
    status: error.status,
    headers: { "x-request-id": requestId },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();

  try {
    // --- 0. Rate limit по IP: отсекаем даблклики и наивный флуд ---
    const clientIp = clientIpFromHeaders(request.headers);
    const rate = checkRateLimit(
      `booking:${clientIp}`,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_MS,
    );
    if (!rate.allowed) {
      const body: ApiErrorResponse = {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Слишком много запросов — попробуйте через минуту",
        },
      };
      return NextResponse.json(body, {
        status: 429,
        headers: {
          "Retry-After": String(rate.retryAfterSeconds),
          "x-request-id": requestId,
        },
      });
    }

    // --- 1. Разбор тела: битый JSON — это 400, а не 500 ---
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new BookingError(
        "VALIDATION_ERROR",
        "Тело запроса должно быть корректным JSON",
        400,
      );
    }

    // Honeypot: скрытое поле формы, которое человек не заполнит.
    // Боту отвечаем «успехом», не создавая ничего.
    if (
      typeof rawBody === "object" &&
      rawBody !== null &&
      "website" in rawBody &&
      typeof (rawBody as Record<string, unknown>).website === "string" &&
      ((rawBody as Record<string, unknown>).website as string).length > 0
    ) {
      const decoy: ApiSuccessResponse<BookingSuccessPayload> = {
        success: true,
        data: {
          eventId: randomUUID(),
          startsAtIso: new Date().toISOString(),
          endsAtIso: new Date().toISOString(),
          humanDateTime: "",
          whatsappNotified: true,
        },
      };
      return NextResponse.json(decoy, {
        status: 201,
        headers: { "x-request-id": requestId },
      });
    }

    // --- 2. Zod-валидация формы данных ---
    const parsed = bookingRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BookingError(
        "VALIDATION_ERROR",
        "Проверьте правильность заполнения формы",
        422,
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }
    const booking = parsed.data;

    // --- 3. Бизнес-валидация слота (будущее, рабочие часы, сетка) ---
    const env = getEnv();
    const slot = resolveAndValidateSlot(booking.date, booking.time, env);

    // --- 4–6. Критическая секция: проверка занятости + создание события.
    // Мьютекс сериализует конкурентов внутри инстанса; межинстансную гонку
    // закрывает resolveInsertRaceWinner (insert-then-verify).
    const slotKey = `${env.GOOGLE_CALENDAR_ID}:${booking.date}T${booking.time}`;
    const createdEvent = await withSlotLock(slotKey, async () => {
      const busy = await isRangeBusy(slot.startUtc, slot.endUtc);
      if (busy) {
        throw new BookingError(
          "SLOT_TAKEN",
          "Это время уже занято — выберите другой слот",
          409,
        );
      }

      const event = await insertBookingEvent({
        summary: `Запись: ${booking.name}`,
        description: [
          `Клиент: ${booking.name}`,
          `Телефон: ${booking.phone}`,
          booking.comment !== undefined ? `Комментарий: ${booking.comment}` : null,
          `Источник: онлайн-форма (${requestId})`,
        ]
          .filter((line): line is string => line !== null)
          .join("\n"),
        startUtc: slot.startUtc,
        endUtc: slot.endUtc,
        timeZone: env.BOOKING_TIMEZONE,
        location: env.BUSINESS_ADDRESS,
      });

      const raceResult = await resolveInsertRaceWinner(
        event.id,
        slot.startUtc,
        slot.endUtc,
      );
      if (!raceResult.weWon) {
        throw new BookingError(
          "SLOT_TAKEN",
          "Это время только что заняли — выберите другой слот",
          409,
        );
      }
      return event;
    });

    // --- 7. WhatsApp-уведомление. Ошибка отправки НЕ отменяет бронь:
    // событие уже в календаре, а сообщение владелец может продублировать.
    const humanDateTime = formatHumanDateTime(
      slot.startUtc,
      env.BOOKING_TIMEZONE,
    );
    const whatsappResult = await getWhatsAppProvider().sendText(
      booking.phone,
      buildConfirmationMessage({
        clientName: booking.name,
        humanDateTime,
        businessName: env.BUSINESS_NAME,
        businessAddress: env.BUSINESS_ADDRESS,
      }),
    );
    if (!whatsappResult.ok) {
      console.error(
        `[booking:${requestId}] WhatsApp send failed for event ${createdEvent.id}: ${whatsappResult.error ?? "unknown"}`,
      );
    }

    // --- 8. Структурированный успех ---
    const body: ApiSuccessResponse<BookingSuccessPayload> = {
      success: true,
      data: {
        eventId: createdEvent.id,
        startsAtIso: slot.startUtc.toISOString(),
        endsAtIso: slot.endUtc.toISOString(),
        humanDateTime,
        whatsappNotified: whatsappResult.ok,
      },
    };
    return NextResponse.json(body, {
      status: 201,
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    if (isBookingError(error)) {
      // Ожидаемые доменные ошибки: настоящая причина уже в message,
      // серверные детали (502/503) дополнительно попадают в лог.
      if (error.status >= 500) {
        console.error(`[booking:${requestId}] ${error.code}: ${error.message}`);
      }
      return errorResponse(error, requestId);
    }
    console.error(
      `[booking:${requestId}] unexpected failure: ${toErrorMessage(error)}`,
    );
    return errorResponse(
      new BookingError(
        "INTERNAL_ERROR",
        "Внутренняя ошибка сервера — попробуйте ещё раз или свяжитесь с нами напрямую",
        500,
      ),
      requestId,
    );
  }
}
