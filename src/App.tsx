import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { platform } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const PERMISSION_ERROR = "PERMISSION_DENIED";

const INTERVAL_PRESETS = [
  { label: "10s", value: 10 },
  { label: "57s", value: 57 },
];

const KEY_TOKENS = [
  { label: "Up", token: "{up}" },
  { label: "Down", token: "{down}" },
];

function formatRemaining(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function App() {
  const [phrase, setPhrase] = useState("{down}");
  const [intervalSeconds, setIntervalSeconds] = useState("57");
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const [hasPermission, setHasPermission] = useState(true);
  const [isMac, setIsMac] = useState(false);

  const [appVersion, setAppVersion] = useState("");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "downloading" | "ready"
  >("idle");
  const [updateProgress, setUpdateProgress] = useState(0);

  // Absolute deadline of the next keystroke; the countdown is derived from it
  // so the label never drifts or jumps.
  const nextTickAtRef = useRef(0);

  const intervalNumber = Math.max(1, Math.floor(Number(intervalSeconds) || 0));
  const isPhraseValid = phrase.trim().length > 0;
  const canStart = isPhraseValid && !isStarting;

  const refreshPermission = useCallback(async () => {
    try {
      const granted = await invoke<boolean>("accessibility_granted");
      setHasPermission(granted);
      if (granted) setErrorMessage("");
      return granted;
    } catch {
      setHasPermission(true);
      return true;
    }
  }, []);

  const requestPermission = async () => {
    try {
      await invoke("request_accessibility");
    } catch {
      // The dialog is best-effort; the poll below still picks up the result.
    }
    void refreshPermission();
  };

  // Ask the OS for the real permission state instead of remembering a click,
  // and re-check on focus so granting it in System Settings clears the banner.
  useEffect(() => {
    try {
      setIsMac(platform() === "macos");
    } catch {
      setIsMac(false);
    }
    void refreshPermission();
    void getVersion().then(setAppVersion).catch(() => undefined);

    const onFocus = () => void refreshPermission();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshPermission]);

  // Granting happens in System Settings, outside this window, and macOS sends
  // no notification when it lands — so poll while the banner is up.
  useEffect(() => {
    if (hasPermission) return;
    const timer = setInterval(() => void refreshPermission(), 1500);
    return () => clearInterval(timer);
  }, [hasPermission, refreshPermission]);

  // Each real keystroke from the backend resets the countdown.
  useEffect(() => {
    const unlisten = listen<number>("ticker://tick", (event) => {
      setTickCount(event.payload);
      nextTickAtRef.current = Date.now() + intervalNumber * 1000;
      setRemaining(intervalNumber);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [intervalNumber]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      const left = Math.ceil((nextTickAtRef.current - Date.now()) / 1000);
      setRemaining(Math.max(0, left));
    }, 250);
    return () => clearInterval(timer);
  }, [isRunning]);

  // Picking a key replaces whatever is in the field — one key at a time.
  const selectToken = (token: string) => setPhrase(token);

  const handleStart = async () => {
    if (!canStart) return;
    setErrorMessage("");
    setIsStarting(true);
    try {
      await invoke("start_typing", { phrase, intervalSeconds: intervalNumber });
      setTickCount(0);
      nextTickAtRef.current = Date.now() + intervalNumber * 1000;
      setRemaining(intervalNumber);
      setIsRunning(true);
      setHasPermission(true);
    } catch (error) {
      const message = typeof error === "string" ? error : "Failed to start.";
      if (message === PERMISSION_ERROR) {
        setHasPermission(false);
        setErrorMessage("Blocked: Accessibility permission is not granted.");
      } else {
        setErrorMessage(message);
      }
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setErrorMessage("");
    try {
      await invoke("stop_typing");
    } catch {
      // Stopping is idempotent; nothing useful to report.
    }
    setIsRunning(false);
  };

  // One check per launch. The previous version re-ran on every state change,
  // which looped forever and made the status text flicker.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setUpdateState("checking");
      let update: Update | null = null;
      try {
        update = await check();
      } catch (error) {
        console.error("Update check failed:", error);
      }

      if (cancelled) return;
      if (!update) {
        setUpdateState("idle");
        return;
      }

      setUpdateVersion(update.version);
      setUpdateState("downloading");
      try {
        let downloaded = 0;
        let contentLength = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            contentLength = event.data.contentLength ?? 0;
          } else if (event.event === "Progress" && contentLength > 0) {
            downloaded += event.data.chunkLength;
            setUpdateProgress(Math.round((downloaded / contentLength) * 100));
          }
        });
        if (!cancelled) setUpdateState("ready");
      } catch (error) {
        console.error("Update download failed:", error);
        if (!cancelled) setUpdateState("idle");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-6 text-neutral-200 antialiased select-none">
      <header className="flex items-baseline justify-between">
        <h1 className="text-sm font-semibold tracking-tight text-white">Ticker</h1>
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isRunning ? "bg-emerald-400" : "bg-neutral-700"
            }`}
          />
          {isRunning ? "Running" : "Idle"}
        </span>
      </header>

      {!hasPermission && (
        <div className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs leading-relaxed text-neutral-400">
            Ticker needs Accessibility permission to send keystrokes.
          </p>
          {isMac && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              Already ticked? After an update macOS invalidates the old entry.
              Select Ticker, press <span className="text-neutral-300">−</span>,
              then add it again with <span className="text-neutral-300">+</span>.
            </p>
          )}
          {isMac && (
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => void requestPermission()}
                className="flex-1 rounded-md bg-neutral-800 py-1.5 text-xs font-medium text-neutral-100 transition hover:bg-neutral-700"
              >
                Grant access
              </button>
              <button
                type="button"
                onClick={() =>
                  void openUrl(
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
                  )
                }
                className="flex-1 rounded-md border border-neutral-800 py-1.5 text-xs font-medium text-neutral-400 transition hover:border-neutral-700 hover:text-neutral-200"
              >
                System Settings
              </button>
            </div>
          )}
        </div>
      )}

      <form
        className="mt-6 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleStart();
        }}
      >
        <div>
          <label
            className="text-xs font-medium text-neutral-500"
            htmlFor="phrase"
          >
            Types
          </label>
          <input
            id="phrase"
            value={phrase}
            onChange={(event) => setPhrase(event.currentTarget.value)}
            placeholder="{up} or any text"
            autoComplete="off"
            disabled={isRunning}
            className="mt-1.5 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
          />
          <div className="mt-2 flex gap-1.5">
            {KEY_TOKENS.map(({ label, token }) => (
              <button
                key={token}
                type="button"
                disabled={isRunning}
                onClick={() => selectToken(token)}
                className={`flex-1 rounded border py-0.5 text-xs transition disabled:opacity-40 ${
                  phrase === token
                    ? "border-neutral-600 text-neutral-100"
                    : "border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            className="text-xs font-medium text-neutral-500"
            htmlFor="interval"
          >
            Every (seconds)
          </label>
          <input
            id="interval"
            type="number"
            min={1}
            step={1}
            value={intervalSeconds}
            onChange={(event) => setIntervalSeconds(event.currentTarget.value)}
            disabled={isRunning}
            className="mt-1.5 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm tabular-nums text-neutral-100 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
          />
          <div className="mt-2 flex gap-1.5">
            {INTERVAL_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                disabled={isRunning}
                onClick={() => setIntervalSeconds(String(preset.value))}
                className={`flex-1 rounded border py-0.5 text-xs transition disabled:opacity-40 ${
                  intervalNumber === preset.value
                    ? "border-neutral-600 text-neutral-100"
                    : "border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {isRunning ? (
          <button
            type="button"
            onClick={() => void handleStop()}
            className="w-full rounded-md border border-neutral-700 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-900"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canStart}
            className="w-full rounded-md bg-white py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-30"
          >
            {isStarting ? "Starting…" : "Start"}
          </button>
        )}

        {errorMessage && (
          <p className="text-xs text-red-400">{errorMessage}</p>
        )}
      </form>

      <p className="mt-5 h-4 text-xs tabular-nums text-neutral-500">
        {isRunning &&
          `Next in ${formatRemaining(remaining)} · ${tickCount} sent`}
      </p>

      <footer className="mt-6 flex items-center justify-between border-t border-neutral-900 pt-3 text-xs text-neutral-600">
        <span>{appVersion ? `v${appVersion}` : ""}</span>
        {updateState === "downloading" && (
          <span>Downloading v{updateVersion} · {updateProgress}%</span>
        )}
        {updateState === "ready" && (
          <button
            type="button"
            onClick={() => void relaunch()}
            className="text-neutral-300 underline underline-offset-2 hover:text-white"
          >
            Restart to update to v{updateVersion}
          </button>
        )}
      </footer>
    </main>
  );
}

export default App;
