# Ticker

Ticker is a lightweight, cross-platform desktop application designed specifically for remote workers who need to keep their computer "active." 

Whether you're reading a long document, stepping away for a coffee, or just need to prevent your screen from sleeping and your messaging apps (like Teams or Slack) from showing you as "Away", Ticker has you covered. It allows you to input any custom text and specify an exact time interval. Ticker will then automatically simulate keyboard events typing that text at your chosen interval, safely keeping your machine awake.

Built with [Tauri](https://tauri.app/), [React](https://reactjs.org/), and [Vite](https://vitejs.dev/), Ticker is blazing fast, memory efficient, and runs seamlessly on Windows, macOS, and Linux.

## Download the App

You can download the latest version of Ticker for your operating system from our [Releases page](https://github.com/WaiyanPhyoaung/ticker/releases/latest).

- **Windows**: Download the `.msi` or `.exe` installer.
- **macOS**: Download the `.dmg` or `.app.tar.gz` file.
- **Linux**: Download the `.AppImage` or `.deb` file.

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
