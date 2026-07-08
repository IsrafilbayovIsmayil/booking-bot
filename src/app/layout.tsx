import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Онлайн-запись",
  description:
    "Запишитесь онлайн: выберите удобное время, и мы пришлём подтверждение в WhatsApp",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
