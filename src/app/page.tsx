import { BookingForm } from "@/features/booking/components/BookingForm";

export default function HomePage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-12">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Онлайн-запись
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Выберите удобные дату и время — подтверждение придёт в WhatsApp
        </p>
      </header>
      <BookingForm />
    </main>
  );
}
