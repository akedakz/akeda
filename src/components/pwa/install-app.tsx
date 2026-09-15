"use client";

import { useEffect } from "react";

export default function InstallApp() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // PWA support is optional; never block the site if registration fails.
      });
    }
  }, []);

  return null;
}
