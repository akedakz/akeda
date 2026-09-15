import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AKEDA",
    short_name: "AKEDA",
    description: "Учебная платформа AKEDA: занятия, тесты, тренажёры, прогресс и расписание.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8f1",
    theme_color: "#142b23",
    lang: "ru",
    categories: ["education"],
    icons: [
      {
        src: "/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
