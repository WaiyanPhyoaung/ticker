use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::State;

struct AppState {
    is_running: bool,
    stop_sender: Option<Sender<()>>,
}

#[derive(Clone, Debug)]
enum Segment {
    Text(String),
    Key(Key),
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

#[tauri::command]
fn start_typing(
    phrase: String,
    interval_seconds: u64,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let mut app_state = state.lock().expect("state mutex poisoned");
    if app_state.is_running {
        return Err("Already running".to_string());
    }
    if interval_seconds == 0 {
        return Err("Interval must be at least 1 second".to_string());
    }

    let segments = parse_phrase(&phrase);
    if segments.is_empty() {
        return Err("Phrase cannot be empty".to_string());
    }

    let (stop_sender, stop_receiver) = channel::<()>();
    let interval = Duration::from_secs(interval_seconds);

    std::thread::spawn(move || {
        let mut enigo = match Enigo::new(&Settings::default()) {
            Ok(e) => e,
            Err(err) => {
                eprintln!("Failed to initialize Enigo: {:?}", err);
                return;
            }
        };

        loop {
            // Instant trigger on tick
            for segment in &segments {
                let result = match segment {
                    Segment::Text(text) => enigo.text(text),
                    Segment::Key(key) => enigo.key(*key, Direction::Click),
                };
                if let Err(e) = result {
                    eprintln!("Typing error: {:?}", e);
                }
            }

            // Zero CPU usage wait with immediate wake on stop signal
            match stop_receiver.recv_timeout(interval) {
                Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    break;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Interval elapsed, continue loop for next tick
                }
            }
        }
    });

    app_state.is_running = true;
    app_state.stop_sender = Some(stop_sender);
    Ok(())
}

#[tauri::command]
fn stop_typing(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut app_state = state.lock().expect("state mutex poisoned");
    if !app_state.is_running {
        return Err("Not running".to_string());
    }
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
        .invoke_handler(tauri::generate_handler![start_typing, stop_typing])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
