import { z } from "zod";

/** Телефон строго в E.164: +, код страны, всего 8–15 цифр. */
const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealCalendarDate(dateStr: string): boolean {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

/**
 * Схема входящей заявки. Используется ТОЛЬКО на сервере как источник истины;
 * клиентская форма может дублировать проверки для UX, но не заменяет их.
 */
export const bookingRequestSchema = z.object({
  name: z
    .string({ required_error: "Укажите имя" })
    .trim()
    .min(2, "Имя должно содержать минимум 2 символа")
    .max(100, "Имя слишком длинное"),
  phone: z
    .string({ required_error: "Укажите телефон" })
    .trim()
    .regex(
      PHONE_E164_REGEX,
      "Телефон должен быть в международном формате, например +79991234567",
    ),
  date: z
    .string({ required_error: "Выберите дату" })
    .regex(DATE_REGEX, "Дата должна быть в формате ГГГГ-ММ-ДД")
    .refine(isRealCalendarDate, "Такой даты не существует"),
  time: z
    .string({ required_error: "Выберите время" })
    .regex(TIME_REGEX, "Время должно быть в формате ЧЧ:ММ"),
  comment: z
    .string()
    .trim()
    .max(500, "Комментарий не длиннее 500 символов")
    .optional(),
});

export type BookingRequest = z.infer<typeof bookingRequestSchema>;

export const availabilityQuerySchema = z.object({
  date: z
    .string({ required_error: "Параметр date обязателен" })
    .regex(DATE_REGEX, "date должен быть в формате ГГГГ-ММ-ДД")
    .refine(isRealCalendarDate, "Такой даты не существует"),
});
