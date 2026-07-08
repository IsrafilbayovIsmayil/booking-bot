import { NextResponse, type NextRequest } from "next/server";
import { availabilityQuerySchema } from "@/features/booking/schema";
import { enumerateDaySlotTimes } from "@/features/booking/slot-rules";
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  AvailabilityPayload,
  AvailabilitySlot,
} from "@/features/booking/types";
import { getEnv } from "@/lib/env";
import { BookingError, isBookingError, toErrorMessage } from "@/lib/errors";
import { getBusyRanges } from "@/lib/google-calendar";
import { zonedTimeToUtc } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/availability?date=ГГГГ-ММ-ДД
 * Возвращает сетку слотов дня с признаком доступности — форма показывает
 * клиенту только реально свободное время. Занятость берётся из freebusy,
 * поэтому наружу не утекают ни названия событий, ни данные других клиентов.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const parsed = availabilityQuerySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
    });
    if (!parsed.success) {
      throw new BookingError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Некорректный параметр date",
        400,
      );
    }
    const { date } = parsed.data;

    const env = getEnv();
    const slotTimes = enumerateDaySlotTimes(env);
    const dayStartUtc = zonedTimeToUtc(
      date,
      `${String(env.BOOKING_OPEN_HOUR).padStart(2, "0")}:00`,
      env.BOOKING_TIMEZONE,
    );
    const dayEndUtc = new Date(
      dayStartUtc.getTime() +
        (env.BOOKING_CLOSE_HOUR - env.BOOKING_OPEN_HOUR) * 60 * 60 * 1000,
    );

    const busyRanges = await getBusyRanges(dayStartUtc, dayEndUtc);
    const now = new Date();

    const slots: AvailabilitySlot[] = slotTimes.map((time) => {
      const startUtc = zonedTimeToUtc(date, time, env.BOOKING_TIMEZONE);
      const endUtc = new Date(
        startUtc.getTime() + env.BOOKING_SLOT_MINUTES * 60_000,
      );
      const inPast = startUtc.getTime() <= now.getTime();
      const overlapsBusy = busyRanges.some(
        (range) => range.start < endUtc && range.end > startUtc,
      );
      return { time, available: !inPast && !overlapsBusy };
    });

    const body: ApiSuccessResponse<AvailabilityPayload> = {
      success: true,
      data: { date, timeZone: env.BOOKING_TIMEZONE, slots },
    };
    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    if (isBookingError(error)) {
      const body: ApiErrorResponse = {
        success: false,
        error: { code: error.code, message: error.message },
      };
      return NextResponse.json(body, { status: error.status });
    }
    console.error(`[availability] unexpected failure: ${toErrorMessage(error)}`);
    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Не удалось загрузить расписание — попробуйте позже",
      },
    };
    return NextResponse.json(body, { status: 500 });
  }
}
