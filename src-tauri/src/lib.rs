use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::{AppHandle, Emitter, State};

/// Sentinel the frontend matches on to re-show the permission banner.
const ERR_PERMISSION: &str = "PERMISSION_DENIED";

struct AppState {
    is_running: bool,
    stop_sender: Option<Sender<()>>,
}

#[derive(Clone, Debug)]
enum Segment {
    Text(String),
    Key(Key),
}

#[cfg(target_os = "macos")]
mod accessibility {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        // Both return a CFBoolean-style 0/1 byte.
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> u8;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    pub fn is_granted() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    /// Shows the system "wants to control this computer" dialog. This is the
    /// only way an app gets added to the Accessibility list, so a user who has
    /// never seen the dialog has nothing to toggle in System Settings.
    pub fn request() -> bool {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let options: CFDictionary<CFType, CFType> = CFDictionary::from_CFType_pairs(&[(
                key.as_CFType(),
                CFBoolean::true_value().as_CFType(),
            )]);
            AXIsProcessTrustedWithOptions(options.as_CFTypeRef()) != 0
        }
    }
}

/// True when the OS lets us synthesise keystrokes.
/// macOS gates this behind Privacy & Security -> Accessibility; other
/// platforms have no equivalent gate, so they are always trusted.
fn is_accessibility_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        accessibility::is_granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn accessibility_granted() -> bool {
    is_accessibility_granted()
}

/// Sync (main-thread) on purpose: the macOS prompt is UI.
#[tauri::command]
fn request_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        accessibility::request()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn token_to_key(token: &str) -> Option<Key> {
    match token.to_ascii_lowercase().as_str() {
        "up" => Some(Key::UpArrow),
        "down" => Some(Key::DownArrow),
        "left" => Some(Key::LeftArrow),
        "right" => Some(Key::RightArrow),
        "space" => Some(Key::Space),
        _ => None,
    }
}

fn parse_phrase(phrase: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut literal = String::new();
    let mut chars = phrase.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '{' {
            let mut token = String::new();
            let mut closed = false;
            while let Some(&next) = chars.peek() {
                chars.next();
                if next == '}' {
                    closed = true;
                    break;
                }
                token.push(next);
            }

            if closed {
                if let Some(key) = token_to_key(&token) {
                    if !literal.is_empty() {
                        segments.push(Segment::Text(std::mem::take(&mut literal)));
                    }
                    segments.push(Segment::Key(key));
                    continue;
                }
                literal.push('{');
                literal.push_str(&token);
                literal.push('}');
            } else {
                literal.push('{');
                literal.push_str(&token);
            }
        } else {
            literal.push(c);
        }
    }

    if !literal.is_empty() {
        segments.push(Segment::Text(literal));
    }

    segments
}

// `async` so Tauri runs this off the main thread: we block on the worker's
// readiness handshake below and must not freeze the UI while doing so.
#[tauri::command]
async fn start_typing(
    app: AppHandle,
    phrase: String,
    interval_seconds: u64,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    if interval_seconds == 0 {
        return Err("Interval must be at least 1 second.".to_string());
    }
    if !is_accessibility_granted() {
        return Err(ERR_PERMISSION.to_string());
    }

    let segments = parse_phrase(&phrase);
    if segments.is_empty() {
        return Err("Phrase cannot be empty.".to_string());
    }

    {
        let app_state = state.lock().expect("state mutex poisoned");
        if app_state.is_running {
            return Err("Already running.".to_string());
        }
    }

    let (stop_sender, stop_receiver) = channel::<()>();
    // The worker reports whether it could actually take over the keyboard, so
    // a failed start surfaces in the UI instead of silently doing nothing.
    let (ready_sender, ready_receiver) = channel::<Result<(), String>>();
    let interval = Duration::from_secs(interval_seconds);

    std::thread::spawn(move || {
        let mut enigo = match Enigo::new(&Settings::default()) {
            Ok(e) => {
                let _ = ready_sender.send(Ok(()));
                e
            }
            Err(err) => {
                let _ = ready_sender.send(Err(if is_accessibility_granted() {
                    format!("Could not access the keyboard: {err}")
                } else {
                    ERR_PERMISSION.to_string()
                }));
                return;
            }
        };

        let mut ticks: u64 = 0;
        loop {
            for segment in &segments {
                let result = match segment {
                    Segment::Text(text) => enigo.text(text),
                    Segment::Key(key) => enigo.key(*key, Direction::Click),
                };
                if let Err(e) = result {
                    eprintln!("Typing error: {e:?}");
                }
            }

            ticks += 1;
            let _ = app.emit("ticker://tick", ticks);

            // Zero CPU usage wait with immediate wake on stop signal
            match stop_receiver.recv_timeout(interval) {
                Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Interval elapsed, continue loop for next tick
                }
            }
        }
    });

    match ready_receiver.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {}
        Ok(Err(message)) => return Err(message),
        Err(_) => return Err("Timed out while starting the keyboard driver.".to_string()),
    }

    let mut app_state = state.lock().expect("state mutex poisoned");
    app_state.is_running = true;
    app_state.stop_sender = Some(stop_sender);
    Ok(())
}

#[tauri::command]
fn stop_typing(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut app_state = state.lock().expect("state mutex poisoned");
    if let Some(sender) = app_state.stop_sender.take() {
        let _ = sender.send(());
    }
    app_state.is_running = false;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(AppState {
            is_running: false,
            stop_sender: None,
        }))
        .invoke_handler(tauri::generate_handler![
            start_typing,
            stop_typing,
            accessibility_granted,
            request_accessibility
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
