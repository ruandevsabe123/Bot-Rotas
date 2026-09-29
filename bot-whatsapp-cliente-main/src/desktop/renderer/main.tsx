import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

function lockApplicationZoom() {
  const preventWheelZoom = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
  };
  const preventKeyboardZoom = (event: KeyboardEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || !["+", "=", "-", "0"].includes(event.key)) return;
    event.preventDefault();
  };
  const preventGestureZoom = (event: Event) => event.preventDefault();

  window.addEventListener("wheel", preventWheelZoom, { passive: false, capture: true });
  window.addEventListener("keydown", preventKeyboardZoom, { capture: true });
  document.addEventListener("gesturestart", preventGestureZoom, { passive: false });
  document.addEventListener("gesturechange", preventGestureZoom, { passive: false });
}

lockApplicationZoom();

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && (window.location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(window.location.hostname))) {
  window.addEventListener("load", () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.update().catch(() => undefined))
      .catch(() => undefined);
  });
}
