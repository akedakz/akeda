import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AKEDA — математика с Адильжаном Ажагалиевым",
  description: "Индивидуальные онлайн-занятия по математике с Адильжаном Ажагалиевым и личная учебная платформа.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
