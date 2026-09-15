import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import InstallApp from "@/components/pwa/install-app";
import "./globals.css";

export const metadata: Metadata = {
  title: "AKEDA — математика с Адильжаном Ажагалиевым",
  description: "Индивидуальные онлайн-занятия по математике с Адильжаном Ажагалиевым и личная учебная платформа.",
  applicationName: "AKEDA",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AKEDA",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#142b23",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}<InstallApp /></body>
    </html>
  );
}
