import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { reportFailure, reportExitIfDirty } from "./lib/failure-reporting";
import "./index.css";
import "./styles/theme-gauss-ui.css";
import "./styles/crt.css";
import "./styles/gauss-platform.css";

if (typeof window !== "undefined") {
  window.onerror = (message, source, lineno, colno, error) => {
    reportFailure({
      type: "error",
      message: typeof message === "string" ? message : String(message),
      stack: error?.stack ?? undefined,
      page: window.location.href,
    });
  };
  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    reportFailure({
      type: "unhandledrejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      page: window.location.href,
      payload: { reason: reason instanceof Error ? String(reason) : reason },
    });
  };
  window.addEventListener("pagehide", () => reportExitIfDirty());
}

createRoot(document.getElementById("root")!).render(<App />);

const swEnabled =
  String(
    (import.meta.env?.VITE_ENABLE_OFFLINE_SW ??
      (typeof process !== "undefined" ? process.env?.VITE_ENABLE_OFFLINE_SW : undefined)) ??
    "true"
  ).toLowerCase() !== "false";
if (swEnabled && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/offline-sw.js").catch((error) => {
      console.warn("[offline-sw] registration failed", error);
    });
  });
}
