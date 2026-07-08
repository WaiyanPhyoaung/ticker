import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";

function App() {
  const [phrase, setPhrase] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState("1");
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [currentPlatform, setCurrentPlatform] = useState<string>("unknown");
  const phraseInputRef = useRef<HTMLInputElement>(null);

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
  }, []);

  const intervalNumber = Number(intervalSeconds);
  const isIntervalValid =
    Number.isFinite(intervalNumber) && intervalNumber >= 1;
  const isPhraseValid = phrase.trim().length > 0;

  const canStart =
    isPhraseValid && isIntervalValid && !isRunning && !showPermissionModal;
  const canStop = isRunning;

  const keyTokens = [
    { label: "↑ Up", token: "{up}" },
    { label: "↓ Down", token: "{down}" },
    { label: "← Left", token: "{left}" },
    { label: "→ Right", token: "{right}" },
    { label: "␣ Space", token: "{space}" },
  ];

  // Insert a special-key token at the current cursor position in the phrase
  // input (or replacing the current selection), then restore focus + caret.
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
    if (!canStart) {
      return;
    }
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
    if (!canStop) {
      return;
    }
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="pointer-events-none absolute -top-40 right-20 h-96 w-96 rounded-full bg-indigo-600/10 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-violet-500/10 blur-[140px]" />

      {showPermissionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-md">
          <div className="relative w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="rounded-3xl border border-white/10 bg-linear-to-b from-slate-800/90 to-slate-900/90 p-8 shadow-2xl backdrop-blur-xl">
              <div className="mb-6">
                <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10 ring-1 ring-indigo-500/20">
                  <svg
                    className="h-7 w-7 text-indigo-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-slate-50">
                  Permission Required
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Enable accessibility to allow automated typing
                </p>
              </div>

              {currentPlatform === "macos" && (
                <div className="mb-6 rounded-2xl border border-white/5 bg-white/5 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    macOS Setup
                  </p>
                  <ol className="space-y-2 text-sm text-slate-300">
                    <li className="flex gap-2">
                      <span className="text-indigo-400">1.</span>System Settings
                      → Privacy
                    </li>
                    <li className="flex gap-2">
                      <span className="text-indigo-400">2.</span>Accessibility
                    </li>
                    <li className="flex gap-2">
                      <span className="text-indigo-400">3.</span>Enable this app
                    </li>
                  </ol>
                </div>
              )}

              {currentPlatform === "windows" && (
                <div className="mb-6 rounded-2xl border border-white/5 bg-white/5 p-4">
                  <p className="text-sm text-slate-300">
                    Usually works by default. Run as Administrator if needed.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-3">
                {currentPlatform === "macos" && (
                  <button
                    type="button"
                    onClick={() => void handleOpenMacSettings()}
                    className="group flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-slate-100 transition-all hover:border-white/20 hover:bg-white/10"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    Open Settings
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAcknowledgePermissions}
                  className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:shadow-indigo-500/40"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 ring-1 ring-white/10">
            <svg
              className="h-8 w-8 text-indigo-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">
            Active Timer
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Automated typing on schedule
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-slate-800/40 to-slate-900/40 p-6 shadow-2xl backdrop-blur-xl">
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void handleStart();
              }}
            >
              <div className="space-y-2">
                <label
                  className="text-xs font-medium uppercase tracking-wider text-slate-400"
                  htmlFor="phrase"
                >
                  Phrase
                </label>
                <input
                  id="phrase"
                  ref={phraseInputRef}
                  value={phrase}
                  onChange={(event) => setPhrase(event.currentTarget.value)}
                  placeholder="Type your message"
                  className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-slate-100 placeholder:text-slate-600 backdrop-blur-sm transition focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  autoComplete="off"
                />
                <div className="flex flex-wrap gap-2">
                  {keyTokens.map(({ label, token }) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => insertToken(token)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-slate-100"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Tap a key to insert it. Arrow keys and{" "}
                  <code className="text-slate-400">{"{space}"}</code> are sent as
                  real key presses.
                </p>
                {!isPhraseValid && phrase.length > 0 && (
                  <p className="text-xs text-rose-400">Required</p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  className="text-xs font-medium uppercase tracking-wider text-slate-400"
                  htmlFor="interval"
                >
                  Interval (seconds)
                </label>
                <input
                  id="interval"
                  type="number"
                  min={1}
                  step={1}
                  value={intervalSeconds}
                  onChange={(event) =>
                    setIntervalSeconds(event.currentTarget.value)
                  }
                  className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-slate-100 backdrop-blur-sm transition focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                {!isIntervalValid && (
                  <p className="text-xs text-rose-400">Minimum 1 second</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="submit"
                  disabled={!canStart}
                  className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 disabled:shadow-none"
                >
                  <span className="relative z-10">Start</span>
                </button>
                <button
                  type="button"
                  disabled={!canStop}
                  onClick={() => void handleStop()}
                  className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-300 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/5 disabled:text-slate-600"
                >
                  Stop
                </button>
              </div>

              {errorMessage && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  {errorMessage}
                </div>
              )}
            </form>
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/5 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Status
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isRunning ? "animate-pulse bg-emerald-400" : "bg-slate-600"
                  }`}
                />
                <span className="text-sm font-medium text-slate-300">
                  {isRunning ? "Active" : "Idle"}
                </span>
              </div>
            </div>
            {isRunning && (
              <p className="mt-2 text-xs text-slate-500">
                Every {intervalNumber}s
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
