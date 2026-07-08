"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  AvailabilityApiResponse,
  AvailabilitySlot,
  BookingApiResponse,
  BookingSuccessPayload,
} from "@/features/booking/types";

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success"; result: BookingSuccessPayload }
  | { phase: "error"; message: string; fieldErrors: Record<string, string[]> };

function todayIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const inputClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100";

function FieldError({ messages }: { messages?: string[] }): React.JSX.Element | null {
  if (messages === undefined || messages.length === 0) {
    return null;
  }
  return <p className="mt-1 text-xs text-red-600">{messages[0]}</p>;
}

export function BookingForm(): React.JSX.Element {
  const minDate = useMemo(todayIsoDate, []);
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [date, setDate] = useState<string>(minDate);
  const [time, setTime] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [honeypot, setHoneypot] = useState<string>("");

  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState<boolean>(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: "idle" });

  const loadSlots = useCallback(async (forDate: string): Promise<void> => {
    setSlotsLoading(true);
    setSlotsError(null);
    setTime("");
    try {
      const response = await fetch(
        `/api/availability?date=${encodeURIComponent(forDate)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as AvailabilityApiResponse;
      if (!payload.success) {
        setSlots([]);
        setSlotsError(payload.error.message);
        return;
      }
      setSlots(payload.data.slots);
    } catch {
      setSlots([]);
      setSlotsError("Не удалось загрузить свободное время — обновите страницу");
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSlots(date);
  }, [date, loadSlots]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitState({ phase: "submitting" });
    try {
      const response = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          date,
          time,
          comment: comment.length > 0 ? comment : undefined,
          website: honeypot,
        }),
      });
      const payload = (await response.json()) as BookingApiResponse;
      if (!payload.success) {
        setSubmitState({
          phase: "error",
          message: payload.error.message,
          fieldErrors: payload.error.fieldErrors ?? {},
        });
        if (payload.error.code === "SLOT_TAKEN") {
          void loadSlots(date);
        }
        return;
      }
      setSubmitState({ phase: "success", result: payload.data });
    } catch {
      setSubmitState({
        phase: "error",
        message: "Сеть недоступна — проверьте соединение и попробуйте снова",
        fieldErrors: {},
      });
    }
  };

  if (submitState.phase === "success") {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm">
        <h2 className="text-xl font-semibold text-emerald-800">
          Вы записаны!
        </h2>
        <p className="mt-2 text-sm text-emerald-700">
          Ждём вас {submitState.result.humanDateTime}.
        </p>
        <p className="mt-1 text-sm text-emerald-700">
          {submitState.result.whatsappNotified
            ? "Подтверждение отправлено вам в WhatsApp."
            : "Запись создана, но WhatsApp-сообщение не дошло — мы свяжемся с вами вручную."}
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitState({ phase: "idle" });
            void loadSlots(date);
          }}
          className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
        >
          Записаться ещё раз
        </button>
      </section>
    );
  }

  const fieldErrors =
    submitState.phase === "error" ? submitState.fieldErrors : {};
  const isSubmitting = submitState.phase === "submitting";

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Ваше имя
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Анна"
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
          disabled={isSubmitting}
          className={inputClassName}
        />
        <FieldError messages={fieldErrors.name} />
      </div>

      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium">
          Телефон (WhatsApp)
        </label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+79991234567"
          autoComplete="tel"
          required
          disabled={isSubmitting}
          className={inputClassName}
        />
        <FieldError messages={fieldErrors.phone} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="date" className="mb-1 block text-sm font-medium">
            Дата
          </label>
          <input
            id="date"
            type="date"
            value={date}
            min={minDate}
            onChange={(event) => setDate(event.target.value)}
            required
            disabled={isSubmitting}
            className={inputClassName}
          />
          <FieldError messages={fieldErrors.date} />
        </div>
        <div>
          <label htmlFor="time" className="mb-1 block text-sm font-medium">
            Время
          </label>
          <select
            id="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
            disabled={isSubmitting || slotsLoading}
            className={inputClassName}
          >
            <option value="" disabled>
              {slotsLoading ? "Загрузка..." : "Выберите время"}
            </option>
            {slots.map((slot) => (
              <option key={slot.time} value={slot.time} disabled={!slot.available}>
                {slot.time}
                {slot.available ? "" : " — занято"}
              </option>
            ))}
          </select>
          <FieldError messages={fieldErrors.time} />
        </div>
      </div>
      {slotsError !== null ? (
        <p className="text-xs text-red-600">{slotsError}</p>
      ) : null}

      <div>
        <label htmlFor="comment" className="mb-1 block text-sm font-medium">
          Комментарий <span className="text-slate-400">(необязательно)</span>
        </label>
        <textarea
          id="comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          maxLength={500}
          disabled={isSubmitting}
          className={inputClassName}
        />
        <FieldError messages={fieldErrors.comment} />
      </div>

      {/* Honeypot: невидимое поле-ловушка для ботов. tabIndex=-1 и
          autoComplete=off исключают случайное заполнение человеком. */}
      <div className="absolute left-[-9999px] top-[-9999px]" aria-hidden="true">
        <label htmlFor="website">Ваш сайт</label>
        <input
          id="website"
          type="text"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {submitState.phase === "error" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {submitState.message}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting || time.length === 0}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isSubmitting ? "Записываем..." : "Записаться"}
      </button>
      <p className="text-center text-xs text-slate-400">
        Нажимая «Записаться», вы соглашаетесь получить подтверждение в WhatsApp
      </p>
    </form>
  );
}
