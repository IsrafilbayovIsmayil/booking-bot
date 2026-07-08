import { getEnv } from "@/lib/env";
import { toErrorMessage } from "@/lib/errors";

const SEND_TIMEOUT_MS = 10_000;

export interface WhatsAppSendResult {
  ok: boolean;
  providerMessageId: string | null;
  error: string | null;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(toPhoneE164: string, text: string): Promise<WhatsAppSendResult>;
}

interface GreenApiSendResponse {
  idMessage?: string;
}

interface TwilioSendResponse {
  sid?: string;
  message?: string;
}

/**
 * Green-API: неофициальный, но популярный у малого бизнеса шлюз к WhatsApp.
 * Документация: https://green-api.com/docs/api/sending/SendMessage/
 */
class GreenApiProvider implements WhatsAppProvider {
  public readonly name = "green-api";

  constructor(
    private readonly baseUrl: string,
    private readonly idInstance: string,
    private readonly apiToken: string,
  ) {}

  public async sendText(
    toPhoneE164: string,
    text: string,
  ): Promise<WhatsAppSendResult> {
    const digitsOnly = toPhoneE164.replace(/\D/g, "");
    const url = `${this.baseUrl}/waInstance${this.idInstance}/sendMessage/${this.apiToken}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: `${digitsOnly}@c.us`,
          message: text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = await response.text();
        return {
          ok: false,
          providerMessageId: null,
          error: `Green-API HTTP ${response.status}: ${body.slice(0, 300)}`,
        };
      }
      const payload = (await response.json()) as GreenApiSendResponse;
      return {
        ok: true,
        providerMessageId: payload.idMessage ?? null,
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        providerMessageId: null,
        error: toErrorMessage(error),
      };
    }
  }
}

/**
 * Twilio WhatsApp Business API — официальный маршрут.
 * Документация: https://www.twilio.com/docs/whatsapp/api
 */
class TwilioWhatsAppProvider implements WhatsAppProvider {
  public readonly name = "twilio";

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromAddress: string,
  ) {}

  public async sendText(
    toPhoneE164: string,
    text: string,
  ): Promise<WhatsAppSendResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: `whatsapp:${toPhoneE164}`,
      From: this.fromAddress,
      Body: text,
    });
    const basicAuth = Buffer.from(
      `${this.accountSid}:${this.authToken}`,
    ).toString("base64");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const payload = (await response.json()) as TwilioSendResponse;
      if (!response.ok) {
        return {
          ok: false,
          providerMessageId: null,
          error: `Twilio HTTP ${response.status}: ${payload.message ?? "unknown"}`,
        };
      }
      return {
        ok: true,
        providerMessageId: payload.sid ?? null,
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        providerMessageId: null,
        error: toErrorMessage(error),
      };
    }
  }
}

export function getWhatsAppProvider(): WhatsAppProvider {
  const env = getEnv();
  if (env.WHATSAPP_PROVIDER === "twilio") {
    return new TwilioWhatsAppProvider(
      env.TWILIO_ACCOUNT_SID ?? "",
      env.TWILIO_AUTH_TOKEN ?? "",
      env.TWILIO_WHATSAPP_FROM ?? "",
    );
  }
  return new GreenApiProvider(
    env.GREEN_API_BASE_URL,
    env.GREEN_API_ID_INSTANCE ?? "",
    env.GREEN_API_API_TOKEN ?? "",
  );
}

export interface ConfirmationMessageInput {
  clientName: string;
  humanDateTime: string;
  businessName: string;
  businessAddress?: string;
}

export function buildConfirmationMessage(
  input: ConfirmationMessageInput,
): string {
  const lines: string[] = [
    `Здравствуйте, ${input.clientName}!`,
    "",
    `Вы записаны: ${input.humanDateTime}.`,
    `Компания: ${input.businessName}.`,
  ];
  if (input.businessAddress !== undefined && input.businessAddress.length > 0) {
    lines.push(`Адрес: ${input.businessAddress}.`);
  }
  lines.push(
    "",
    "Если планы изменятся — просто ответьте на это сообщение, и мы перенесём запись.",
  );
  return lines.join("\n");
}
