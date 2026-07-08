# Ticker

Ticker is a cross-platform desktop application built with [Tauri](https://tauri.app/), [React](https://reactjs.org/), and [Vite](https://vitejs.dev/).

## Prerequisites

Before you can develop or build the application, make sure you have the following installed:

1. **Node.js** (v16 or newer) - [Download here](https://nodejs.org/)
2. **Rust** - [Download here](https://www.rust-lang.org/tools/install) (Required by Tauri)
3. Platform-specific dependencies (e.g., C++ build tools on Windows, Xcode on macOS, or webkit2gtk on Linux). See the [Tauri Prerequisites guide](https://tauri.app/v1/guides/getting-started/prerequisites) for more details.

## Getting Started

### 1. Install Dependencies

First, clone the repository and install the Node.js dependencies:

```bash
npm install
```

### 2. Development Mode

To run the application in development mode with hot-module replacement (HMR), use the following command:

```bash
npm run tauri dev
```

This will start the Vite frontend dev server and then automatically compile and launch the Tauri rust application.

### 3. Building the Application

To build the application for your current operating system (creating an executable or installer), run:

```bash
npm run tauri build
```

The bundled application and installers will be generated inside the `src-tauri/target/release/bundle/` directory. Note that Tauri will only build binaries for the OS you are currently compiling on (e.g., building on macOS creates a `.app` and `.dmg`, building on Windows creates an `.exe` and `.msi`).

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) 
- [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
