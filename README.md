# FlexDesigner SMTC Plugin

![Idle](./assets/images/Flexbar-SMTC-Plugin-00.jpg)
![No Artwork Fallback](./assets/images/Flexbar-SMTC-Plugin-01.jpg)
![Vibrant Dynamic Theming](./assets/images/Flexbar-SMTC-Plugin-02.jpg)
![Rickroll](./assets/images/Flexbar-SMTC-Plugin-03.jpg)

A plugin for FlexDesigner that integrates Windows System Media Transport Controls (SMTC) into your Flexbar device. This allows you to view and control media playback across various Windows applications directly from your Flexbar.

## Features

- **Media Control**: Play, Pause, Skip Next, Skip Previous and Toggle Shuffle or Repeat mode (if supported by the active SMTC Client).
- **Track Information**: Real-time updates for Song Title, Artist, and playback progress.
- **Album Art & Theming**: Automatically fetches album art and extracts prominent colors using `node-vibrant` to dynamically theme the Flexbar UI.
- **Volume Control**: Integrates `native-sound-mixer` to directly adjust the app-specific volume of the current SMTC Client via the Windows Audio Mixer API.

## Project Structure

- `com.michikora.smtcplugin.plugin/`: The main plugin directory (Manifest, UI components, and Backend outputs).
- `src/`: Plugin backend source code (`plugin.js`).
- `vendor/node-windows-smtc-monitor/`: A customized, local snapshot of the Rust-based Windows SMTC monitor library compiled via NAPI-RS.

## Installation

### **Prerequisites**

- Node.js 18 or later

- FlexDesigner v1.0.0 or later

- A Flexbar device

- Install FlexCLI
  
  ```
  npm install -g @eniac/flexcli
  ```

### Clone & Setup

```
git clone https://github.com/michikora/Flexbar-SMTC-Plugin.git
cd Flexbar-SMTC-Plugin
npm install
```

## Debug

```
npm run dev
```

## Build & Pack

```
npm run build
npm run plugin:pack --path com.michikora.smtcplugin.plugin
```

## Credits & Acknowledgements

This plugin utilizes a modified version of [LeagueTavern/node-windows-smtc-monitor](https://github.com/LeagueTavern/node-windows-smtc-monitor) (published as `@coooookies/windows-smtc-monitor`), compiled via NAPI-RS to robustly interface with the Windows OS.
