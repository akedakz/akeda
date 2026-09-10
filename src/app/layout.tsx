import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "NSP — физика и математика",
  description: "Индивидуальные онлайн-занятия по физике и математике с Арманом Бисембаевым и личная учебная платформа.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
