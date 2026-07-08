/**
 * Коды ошибок домена бронирования. Каждый код однозначно отображается
 * в HTTP-статус, а клиент может строить UX-ветвление по коду, не парся текст.
 */
export type BookingErrorCode =
  | "VALIDATION_ERROR"
  | "SLOT_INVALID"
  | "SLOT_TAKEN"
  | "RATE_LIMITED"
  | "CALENDAR_ERROR"
  | "WHATSAPP_ERROR"
  | "CONFIG_ERROR"
  | "INTERNAL_ERROR";

export class BookingError extends Error {
  public readonly code: BookingErrorCode;
  public readonly status: number;
  public readonly fieldErrors?: Readonly<Record<string, string[]>>;

  constructor(
    code: BookingErrorCode,
    message: string,
    status: number,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "BookingError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function isBookingError(error: unknown): error is BookingError {
  return error instanceof BookingError;
}

/** Достаёт человекочитаемое сообщение из unknown-ошибки без использования any. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Неизвестная ошибка";
}
