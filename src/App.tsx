import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

function App() {
  const [phrase, setPhrase] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState("60");
  const [isRunning, setIsRunning] = useState(false);
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

  const checkForUpdates = async (manual = false) => {
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
  };

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

    // Auto-check for updates on launch
    void checkForUpdates(false);
  }, []);

  const intervalNumber = Number(intervalSeconds);
  const isIntervalValid =
    Number.isFinite(intervalNumber) && intervalNumber >= 1;
  const isPhraseValid = phrase.trim().length > 0;

  const canStart =
    isPhraseValid && isIntervalValid && !isRunning && !showPermissionModal;
  const canStop = isRunning;

  const keyTokens = [
    { label: "↑", token: "{up}" },
    { label: "↓", token: "{down}" },
    { label: "←", token: "{left}" },
    { label: "→", token: "{right}" },
    { label: "Space", token: "{space}" },
  ];

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
        intervalSeconds: Number(intervalSeconds),
      });
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#09090b] text-neutral-200 font-sans selection:bg-neutral-800">
      {showPermissionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#18181b] border border-neutral-800 p-8 shadow-2xl">
            <h2 className="text-xl font-medium text-white mb-2">Accessibility Access</h2>
            <p className="text-sm text-neutral-400 mb-6 leading-relaxed">
              Ticker needs accessibility permissions to simulate keyboard strokes.
            </p>

            {currentPlatform === "macos" && (
              <div className="mb-6 space-y-3 text-sm text-neutral-500">
                <p>1. Open System Settings → Privacy & Security</p>
                <p>2. Select Accessibility</p>
                <p>3. Toggle switch for Ticker</p>
                <button
                  type="button"
                  onClick={() => void handleOpenMacSettings()}
                  className="mt-2 w-full rounded-lg bg-neutral-800 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 active:scale-[0.98]"
                >
                  Open Settings
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleAcknowledgePermissions}
              className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200 active:scale-[0.98]"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-sm px-6 py-6">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#18181b] border border-neutral-800/80 shadow-sm">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <h1 className="text-xl font-medium tracking-tight text-white">Ticker</h1>
          <p className="mt-1 text-xs text-neutral-500">Automated keyboard events</p>
        </div>

        {/* Update Banner */}
        {availableUpdate && (
          <div className="mb-6 rounded-2xl border border-indigo-500/20 bg-indigo-950/40 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-xs font-semibold text-indigo-200">
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
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between text-[11px] text-indigo-300">
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
                className="mt-3 w-full rounded-xl bg-indigo-600 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98]"
              >
                Install Update & Restart
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
          <div className="space-y-2">
            <label className="text-xs font-medium text-neutral-400" htmlFor="phrase">
              Phrase or Action
            </label>
            <input
              id="phrase"
              ref={phraseInputRef}
              value={phrase}
              onChange={(event) => setPhrase(event.currentTarget.value)}
              placeholder="e.g. Hello, or {space}"
              className="w-full rounded-xl border border-neutral-800 bg-[#18181b] px-4 py-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 transition-all"
              autoComplete="off"
            />
            
            <div className="flex gap-2 pt-1 overflow-x-auto pb-1 scrollbar-hide">
              {keyTokens.map(({ label, token }) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className="shrink-0 rounded-md border border-neutral-800 bg-neutral-900/50 px-2.5 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 active:scale-[0.97]"
                >
                  {label}
                </button>
              ))}
            </div>
            
            {!isPhraseValid && phrase.length > 0 && (
              <p className="text-xs text-red-400/80">Input required</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-neutral-400" htmlFor="interval">
              Interval (seconds)
            </label>
            <input
              id="interval"
              type="number"
              min={1}
              step={1}
              value={intervalSeconds}
              onChange={(event) => setIntervalSeconds(event.currentTarget.value)}
              className="w-full rounded-xl border border-neutral-800 bg-[#18181b] px-4 py-3 text-sm text-neutral-200 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 transition-all"
            />
            {!isIntervalValid && (
              <p className="text-xs text-red-400/80">Minimum 1s</p>
            )}
          </div>

          <div className="flex gap-3 pt-3">
            <button
              type="submit"
              disabled={!canStart}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-neutral-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-30"
            >
              Start
            </button>
            <button
              type="button"
              disabled={!canStop}
              onClick={() => void handleStop()}
              className="flex-1 rounded-xl border border-neutral-800 bg-transparent px-4 py-3 text-sm font-medium text-neutral-300 transition-all hover:bg-neutral-800 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-30"
            >
              Stop
            </button>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-500/10 bg-red-500/5 px-3 py-2 text-xs text-red-400/90">
              {errorMessage}
            </div>
          )}
        </form>

        <div className="mt-6 flex items-center justify-between rounded-xl border border-neutral-800/60 bg-[#18181b]/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative flex h-2 w-2 items-center justify-center">
               {isRunning && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
               <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isRunning ? "bg-emerald-500" : "bg-neutral-600"}`} />
            </div>
            <span className="text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
              {isRunning ? "Running" : "Idle"}
            </span>
          </div>
          {isRunning ? (
            <span className="text-[11px] font-medium text-neutral-500">
              Every {intervalNumber}s
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void checkForUpdates(true)}
              disabled={isCheckingUpdate || isUpdating}
              className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-50"
            >
              {isCheckingUpdate
                ? "Checking..."
                : updateMessage || "Check updates"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
