import { z } from "zod";
import { BookingError } from "@/lib/errors";

/**
 * Единственная точка доступа к переменным окружения.
 * Все ключи читаются ТОЛЬКО на сервере: ни одна переменная не имеет
 * префикса NEXT_PUBLIC_, поэтому Next.js физически не включит их в
 * клиентский бандл.
 */
const envSchema = z
  .object({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: z
      .string()
      .email("GOOGLE_SERVICE_ACCOUNT_EMAIL должен быть email сервис-аккаунта"),
    GOOGLE_PRIVATE_KEY: z
      .string()
      .min(100, "GOOGLE_PRIVATE_KEY выглядит пустым или обрезанным"),
    GOOGLE_CALENDAR_ID: z.string().min(3, "GOOGLE_CALENDAR_ID обязателен"),

    BOOKING_TIMEZONE: z.string().min(1).default("Europe/Moscow"),
    BOOKING_OPEN_HOUR: z.coerce.number().int().min(0).max(23).default(9),
    BOOKING_CLOSE_HOUR: z.coerce.number().int().min(1).max(24).default(18),
    BOOKING_SLOT_MINUTES: z.coerce.number().int().min(15).max(240).default(60),
    BOOKING_MAX_DAYS_AHEAD: z.coerce.number().int().min(1).max(365).default(60),
    BUSINESS_NAME: z.string().min(1).default("Наша компания"),
    BUSINESS_ADDRESS: z.string().optional(),

    WHATSAPP_PROVIDER: z.enum(["green-api", "twilio"]).default("green-api"),
    GREEN_API_BASE_URL: z.string().url().default("https://api.green-api.com"),
    GREEN_API_ID_INSTANCE: z.string().optional(),
    GREEN_API_API_TOKEN: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_WHATSAPP_FROM: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.BOOKING_OPEN_HOUR >= env.BOOKING_CLOSE_HOUR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BOOKING_OPEN_HOUR должен быть меньше BOOKING_CLOSE_HOUR",
        path: ["BOOKING_OPEN_HOUR"],
      });
    }
    if (env.WHATSAPP_PROVIDER === "green-api") {
      if (!env.GREEN_API_ID_INSTANCE || !env.GREEN_API_API_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Для WHATSAPP_PROVIDER=green-api обязательны GREEN_API_ID_INSTANCE и GREEN_API_API_TOKEN",
          path: ["GREEN_API_ID_INSTANCE"],
        });
      }
    }
    if (env.WHATSAPP_PROVIDER === "twilio") {
      if (
        !env.TWILIO_ACCOUNT_SID ||
        !env.TWILIO_AUTH_TOKEN ||
        !env.TWILIO_WHATSAPP_FROM
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Для WHATSAPP_PROVIDER=twilio обязательны TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN и TWILIO_WHATSAPP_FROM",
          path: ["TWILIO_ACCOUNT_SID"],
        });
      } else if (!env.TWILIO_WHATSAPP_FROM.startsWith("whatsapp:+")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "TWILIO_WHATSAPP_FROM должен иметь формат whatsapp:+79990000000",
          path: ["TWILIO_WHATSAPP_FROM"],
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv !== null) {
    return cachedEnv;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new BookingError(
      "CONFIG_ERROR",
      `Сервис временно недоступен: некорректная конфигурация окружения (${details})`,
      503,
    );
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

/**
 * Ключ из переменной окружения приходит с экранированными переводами строк
 * ("\n" как два символа) — разворачиваем их в настоящие переводы строк,
 * иначе подпись JWT для Google не соберётся.
 */
export function normalizePrivateKey(rawKey: string): string {
  return rawKey.replace(/\\n/g, "\n");
}
