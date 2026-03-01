import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// --- Crash diagnostics: capture errors into a log visible on device ---
const errorLog: string[] = [];
const MAX_LOG_ENTRIES = 200;

function pushLog(entry: string) {
  const ts = new Date().toISOString().slice(11, 23);
  errorLog.push(`[${ts}] ${entry}`);
  if (errorLog.length > MAX_LOG_ENTRIES) errorLog.shift();
}

window.onerror = (_msg, source, line, col, error) => {
  pushLog(`ERROR: ${error?.message || _msg} at ${source}:${line}:${col}`);
  if (error?.stack) pushLog(`STACK: ${error.stack}`);
};

window.onunhandledrejection = (event) => {
  const reason = event.reason;
  const msg = reason instanceof Error ? reason.message : String(reason);
  pushLog(`UNHANDLED PROMISE: ${msg}`);
  if (reason instanceof Error && reason.stack) pushLog(`STACK: ${reason.stack}`);
};

// Capture console.error output too
const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  pushLog(`console.error: ${args.map(a => {
    if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
    return String(a);
  }).join(' ')}`);
  origConsoleError.apply(console, args);
};

// Expose globally so it can be read from DevTools or a diagnostics screen
(window as unknown as Record<string, unknown>).__CODEDECK_ERROR_LOG = errorLog;
(window as unknown as Record<string, unknown>).__CODEDECK_DUMP_LOG = () => errorLog.join('\n');

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
