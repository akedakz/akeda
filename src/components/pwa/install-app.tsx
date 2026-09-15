"use client";

import { useEffect, useState } from "react";
import styles from "./install-app.module.css";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export default function InstallApp() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosAvailable, setIosAvailable] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Installation remains optional; never block the site if registration fails.
      });
    }

    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    setIosAvailable(isIOS());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      setShowIOSHelp(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (installed || (!promptEvent && !iosAvailable)) return null;

  const install = async () => {
    if (!promptEvent) {
      setShowIOSHelp(true);
      return;
    }

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPromptEvent(null);
  };

  return (
    <>
      <button className={styles.installButton} type="button" onClick={install}>
        <span className={styles.mark} aria-hidden="true">A</span>
        <span>Установить AKEDA</span>
      </button>

      {showIOSHelp && (
        <div className={styles.backdrop} onPointerDown={(event) => {
          if (event.target === event.currentTarget) setShowIOSHelp(false);
        }}>
          <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="pwa-ios-title">
            <button className={styles.close} type="button" aria-label="Закрыть" onClick={() => setShowIOSHelp(false)}>×</button>
            <span className={styles.sheetMark} aria-hidden="true">A</span>
            <h2 id="pwa-ios-title">Установить AKEDA</h2>
            <p>На iPhone и iPad установка делается через меню браузера:</p>
            <ol>
              <li>Нажмите <strong>«Поделиться»</strong>.</li>
              <li>Выберите <strong>«На экран „Домой“»</strong>.</li>
              <li>Нажмите <strong>«Добавить»</strong>.</li>
            </ol>
            <p className={styles.hint}>Если пункта нет, откройте akeda.kz в Safari и повторите эти шаги.</p>
          </section>
        </div>
      )}
    </>
  );
}
