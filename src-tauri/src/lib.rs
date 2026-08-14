use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::State;

struct AppState {
    is_running: bool,
    cancel_token: Option<Arc<AtomicBool>>,
}

/// A single step to perform when the timer ticks: either literal text to type,
/// or a special key to press (arrow keys, space, ...).
enum Segment {
    Text(String),
    Key(Key),
}

/// Map a `{token}` name to a special key. Returns `None` for unknown tokens so
/// they can be treated as literal text instead.
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

/// Parse a phrase into a sequence of segments. `{up}`, `{down}`, `{left}`,
/// `{right}` and `{space}` (case-insensitive) become key presses; everything
/// else, including unrecognized `{tokens}`, is kept as literal text.
fn parse_phrase(phrase: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut literal = String::new();
    let mut chars = phrase.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '{' {
            // Collect everything up to the closing brace.
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
                // Unknown token: keep it verbatim as literal text.
                literal.push('{');
                literal.push_str(&token);
                literal.push('}');
            } else {
                // No closing brace: treat the rest as literal text.
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

    let cancel_token = Arc::new(AtomicBool::new(false));
    let cancel_token_clone = Arc::clone(&cancel_token);
    let phrase_clone = phrase.clone();
    let interval = Duration::from_secs(interval_seconds);

    std::thread::spawn(move || {
        let mut enigo = Enigo::new(&Settings::default()).expect("Failed to init Enigo");
        println!(
            "Timer started: phrase='{}' interval={} sec",
            phrase_clone, interval_seconds
        );
        loop {
            if cancel_token_clone.load(Ordering::Relaxed) {
                println!("Timer stopped");
                break;
            }

            println!("Tick: typing -> {}", phrase_clone);
            for segment in parse_phrase(&phrase_clone) {
                let result = match segment {
                    Segment::Text(ref text) => enigo.text(text),
                    Segment::Key(key) => enigo.key(key, Direction::Click),
                };
                if let Err(e) = result {
                    eprintln!("Typing error: {:?}", e);
                }
            }

            // Sleep in 100ms chunks to remain responsive to cancel token
            let chunks = interval_seconds * 10;
            for _ in 0..chunks {
                std::thread::sleep(Duration::from_millis(100));
                if cancel_token_clone.load(Ordering::Relaxed) {
                    break;
                }
            }
        }
    });

    app_state.is_running = true;
    app_state.cancel_token = Some(cancel_token);
    Ok(())
}

#[tauri::command]
fn stop_typing(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut app_state = state.lock().expect("state mutex poisoned");
    if !app_state.is_running {
        return Err("Not running".to_string());
    }
    if let Some(token) = &app_state.cancel_token {
        token.store(true, Ordering::Relaxed);
    }
    app_state.cancel_token = None;
    app_state.is_running = false;
    println!("User stopped typing");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(AppState {
            is_running: false,
            cancel_token: None,
        }))
        .invoke_handler(tauri::generate_handler![start_typing, stop_typing])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
