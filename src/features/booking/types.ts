import type { BookingErrorCode } from "@/lib/errors";

/** Контракт ответа API — общий для сервера и клиентской формы. */

export interface BookingSuccessPayload {
  eventId: string;
  startsAtIso: string;
  endsAtIso: string;
  humanDateTime: string;
  whatsappNotified: boolean;
}

export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: BookingErrorCode;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
}

export type BookingApiResponse =
  | ApiSuccessResponse<BookingSuccessPayload>
  | ApiErrorResponse;

export interface AvailabilitySlot {
  time: string;
  available: boolean;
}

export interface AvailabilityPayload {
  date: string;
  timeZone: string;
  slots: AvailabilitySlot[];
}

export type AvailabilityApiResponse =
  | ApiSuccessResponse<AvailabilityPayload>
  | ApiErrorResponse;
