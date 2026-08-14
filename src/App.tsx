import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const INTERVAL_PRESETS = [
  { label: "10s", value: "10" },
  { label: "30s", value: "30" },
  { label: "1m", value: "60" },
  { label: "5m", value: "300" },
  { label: "15m", value: "900" },
];

const KEY_TOKENS = [
  { label: "↑ Up", token: "{up}" },
  { label: "↓ Down", token: "{down}" },
  { label: "← Left", token: "{left}" },
  { label: "→ Right", token: "{right}" },
  { label: "␣ Space", token: "{space}" },
];

function App() {
  const [phrase, setPhrase] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState("60");
  const [isRunning, setIsRunning] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [secondsUntilNextTick, setSecondsUntilNextTick] = useState(60);
  const [errorMessage, setErrorMessage] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [currentPlatform, setCurrentPlatform] = useState<string>("unknown");
  const phraseInputRef = useRef<HTMLInputElement>(null);

  // Updater states
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateStatusText, setUpdateStatusText] = useState("Downloading...");
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const checkForUpdates = useCallback(async (manual = false) => {
    if (isCheckingUpdate || isUpdating) return;
    setIsCheckingUpdate(true);
    setUpdateMessage(null);
    try {
      const update = await check();
      if (update) {
        setAvailableUpdate(update);
      } else if (manual) {
        setUpdateMessage("Ticker is up to date");
        setTimeout(() => setUpdateMessage(null), 3000);
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      if (manual) {
        setUpdateMessage("No updates found");
        setTimeout(() => setUpdateMessage(null), 3000);
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [isCheckingUpdate, isUpdating]);

  const handleInstallUpdate = async () => {
    if (!availableUpdate || isUpdating) return;
    setIsUpdating(true);
    setUpdateStatusText("Downloading update...");
    setUpdateProgress(0);
    try {
      let downloaded = 0;
      let contentLength = 0;
      await availableUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setUpdateProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setUpdateStatusText("Installing & Restarting...");
            break;
        }
      });
      await relaunch();
    } catch (err) {
      console.error("Failed to install update:", err);
      setErrorMessage("Failed to install update.");
      setIsUpdating(false);
    }
  };

  useEffect(() => {
    const hasSeenPermission =
      window.localStorage.getItem("att.permissions.v1") === "true";
    setShowPermissionModal(!hasSeenPermission);

    try {
      const detectedPlatform = platform();
      setCurrentPlatform(detectedPlatform);
    } catch {
      setCurrentPlatform("unknown");
    }

    void checkForUpdates(false);
  }, [checkForUpdates]);

  const intervalNumber = Math.max(1, Number(intervalSeconds) || 1);

  // Countdown timer effect
  useEffect(() => {
    if (!isRunning) {
      setSecondsUntilNextTick(intervalNumber);
      return;
    }

    setSecondsUntilNextTick(intervalNumber);
    const timer = setInterval(() => {
      setSecondsUntilNextTick((prev) => {
        if (prev <= 1) {
          setTickCount((c) => c + 1);
          return intervalNumber;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning, intervalNumber]);

  const isIntervalValid =
    Number.isFinite(intervalNumber) && intervalNumber >= 1;
  const isPhraseValid = phrase.trim().length > 0;

  const canStart =
    isPhraseValid && isIntervalValid && !isRunning && !showPermissionModal;
  const canStop = isRunning;

  const insertToken = (token: string) => {
    const input = phraseInputRef.current;
    const start = input?.selectionStart ?? phrase.length;
    const end = input?.selectionEnd ?? phrase.length;
    const nextPhrase = phrase.slice(0, start) + token + phrase.slice(end);
    setPhrase(nextPhrase);

    const caret = start + token.length;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  };

  const handleStart = async () => {
    if (!canStart) return;
    setErrorMessage("");
    try {
      await invoke("start_typing", {
        phrase,
        intervalSeconds: intervalNumber,
      });
      setTickCount(1);
      setSecondsUntilNextTick(intervalNumber);
      setIsRunning(true);
    } catch (error) {
      setErrorMessage(
        typeof error === "string" ? error : "Failed to start timer."
      );
    }
  };

  const handleStop = async () => {
    if (!canStop) return;
    setErrorMessage("");
    try {
      await invoke("stop_typing");
      setIsRunning(false);
    } catch (error) {
      setErrorMessage(
        typeof error === "string" ? error : "Failed to stop timer."
      );
    }
  };

  const handleAcknowledgePermissions = () => {
    window.localStorage.setItem("att.permissions.v1", "true");
    setShowPermissionModal(false);
  };

  const handleOpenMacSettings = async () => {
    await openUrl(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    );
  };

  const progressPercent = isRunning
    ? Math.max(0, Math.min(100, ((intervalNumber - secondsUntilNextTick) / intervalNumber) * 100))
    : 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#09090b] text-neutral-200 font-sans selection:bg-neutral-800 antialiased select-none">
      {showPermissionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#18181b] border border-neutral-800 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <h2 className="text-base font-medium text-white">Accessibility Permission</h2>
            </div>
            <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
              Ticker requires accessibility privileges to simulate keyboard strokes.
            </p>

            {currentPlatform === "macos" && (
              <div className="mb-4 space-y-2 text-xs text-neutral-400 bg-neutral-900/60 p-3 rounded-xl border border-neutral-800">
                <p>1. Open System Settings → Privacy & Security</p>
                <p>2. Select Accessibility</p>
                <p>3. Toggle on for Ticker</p>
                <button
                  type="button"
                  onClick={() => void handleOpenMacSettings()}
                  className="mt-2 w-full rounded-lg bg-neutral-800 py-2 text-xs font-medium text-white transition hover:bg-neutral-700 active:scale-[0.98]"
                >
                  Open System Settings
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleAcknowledgePermissions}
              className="w-full rounded-lg bg-white py-2 text-xs font-medium text-black transition hover:bg-neutral-200 active:scale-[0.98]"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-[380px] px-5 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-700/60 shadow-inner">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-200"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white leading-none">Ticker</h1>
              <p className="text-[11px] text-neutral-500 mt-0.5">Automated Active State</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-medium">
              <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-neutral-600"}`} />
              <span className={isRunning ? "text-emerald-400" : "text-neutral-500"}>
                {isRunning ? "Active" : "Idle"}
              </span>
            </div>
          </div>
        </div>

        {/* Update Notification */}
        {availableUpdate && (
          <div className="mb-5 rounded-xl border border-indigo-500/25 bg-indigo-950/40 p-3.5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-xs font-medium text-indigo-200">
                  Update v{availableUpdate.version} ready
                </span>
              </div>
              {!isUpdating && (
                <button
                  type="button"
                  onClick={() => setAvailableUpdate(null)}
                  className="text-xs text-neutral-400 hover:text-neutral-200"
                >
                  ✕
                </button>
              )}
            </div>
            {isUpdating ? (
              <div className="mt-2.5 space-y-1.5">
                <div className="flex justify-between text-[10px] text-indigo-300">
                  <span>{updateStatusText}</span>
                  <span>{updateProgress > 0 ? `${updateProgress}%` : ""}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-950">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(updateProgress, 6)}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleInstallUpdate()}
                className="mt-2.5 w-full rounded-lg bg-indigo-600 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98]"
              >
                Install & Restart
              </button>
            )}
          </div>
        )}

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleStart();
          }}
        >
          {/* Phrase Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider" htmlFor="phrase">
                Phrase / Key Event
              </label>
              {!isPhraseValid && phrase.length > 0 && (
                <span className="text-[11px] text-red-400">Required</span>
              )}
            </div>
            <input
              id="phrase"
              ref={phraseInputRef}
              value={phrase}
              onChange={(event) => setPhrase(event.currentTarget.value)}
              placeholder="e.g. {space} or Active"
              className="w-full rounded-xl border border-neutral-800 bg-[#141416] px-3.5 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 transition-all"
              autoComplete="off"
            />
            
            {/* Quick Key Badges */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {KEY_TOKENS.map(({ label, token }) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className="rounded-lg border border-neutral-800/80 bg-neutral-900/60 px-2 py-1 text-[11px] font-mono font-medium text-neutral-400 transition-all hover:bg-neutral-800 hover:text-neutral-200 hover:border-neutral-700 active:scale-[0.95]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Interval Input & Presets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider" htmlFor="interval">
                Interval (Seconds)
              </label>
              <span className="text-[11px] text-neutral-500 font-mono">
                {intervalNumber}s ({Math.round((intervalNumber / 60) * 10) / 10}m)
              </span>
            </div>
            <input
              id="interval"
              type="number"
              min={1}
              step={1}
              value={intervalSeconds}
              onChange={(event) => setIntervalSeconds(event.currentTarget.value)}
              className="w-full rounded-xl border border-neutral-800 bg-[#141416] px-3.5 py-2.5 text-sm font-mono text-neutral-100 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 transition-all"
            />

            {/* Presets */}
            <div className="flex gap-1.5 pt-0.5">
              {INTERVAL_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setIntervalSeconds(preset.value)}
                  className={`flex-1 rounded-lg border py-1 text-[11px] font-mono font-medium transition-all active:scale-[0.95] ${
                    intervalSeconds === preset.value
                      ? "border-neutral-600 bg-neutral-800 text-white"
                      : "border-neutral-800/80 bg-neutral-900/60 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-2.5 pt-2">
            <button
              type="submit"
              disabled={!canStart}
              className="flex-1 rounded-xl bg-white py-2.5 text-xs font-semibold text-black transition-all hover:bg-neutral-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-25 shadow-sm"
            >
              Start Timer
            </button>
            <button
              type="button"
              disabled={!canStop}
              onClick={() => void handleStop()}
              className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900/60 py-2.5 text-xs font-semibold text-neutral-300 transition-all hover:bg-neutral-800 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-25"
            >
              Stop
            </button>
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {errorMessage}
            </div>
          )}
        </form>

        {/* Live Status Bar & Countdown */}
        <div className="mt-6 rounded-2xl border border-neutral-800/80 bg-[#141416]/80 p-3.5 backdrop-blur-sm">
          {isRunning ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-neutral-400">Next tick in:</span>
                <span className="font-mono text-emerald-400 font-semibold text-sm">
                  {secondsUntilNextTick}s
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full bg-emerald-500 transition-all duration-1000 ease-linear rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-0.5">
                <span>Active loop</span>
                <span>Sent {tickCount} times</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-500">Ready to start</span>
              <button
                type="button"
                onClick={() => void checkForUpdates(true)}
                disabled={isCheckingUpdate || isUpdating}
                className="text-[11px] text-neutral-400 hover:text-white transition-colors disabled:opacity-50"
              >
                {isCheckingUpdate ? "Checking..." : updateMessage || "Check for updates"}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
