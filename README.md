# MMM-BambuLabNotify

[![MagicMirror² Module](https://img.shields.io/badge/MagicMirror²-Module-blue)](https://magicmirror.builders/)
[![Version](https://img.shields.io/badge/version-1.5.1-brightgreen.svg)]()
[![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)]()

A [MagicMirror²](https://magicmirror.builders/) module that provides **real-time notifications and status updates** from your **Bambu Lab printer**.  

It connects to the printer’s local MQTT broker and shows toast notifications and a status panel for print events like **started, paused, canceled, finished, and error states**.

---

## ✨ Features

- 📡 Real-time printer status via MQTT over TLS  
- 🔔 Toast notifications for:
  - Print started
  - Print paused
  - Print canceled  
  - Print finished  
  - Error conditions  
- 📊 Inline status panel:
  - Current state (Idle, Preparing, Printing, Paused, Canceled, Error, Finished)  
  - Job progress bar (%)  
  - Layer countdown
  - Current file name
  - Nozzle and bed temperatures
  - AMS and external spool filament type and color, with active filament indication
- 🌐 Customizable status, panel, and toast text for alternate wording or languages

---

## Screenshots
![screenshot](./screenshots/screenshot.png)

### Toast Messages
![started](./screenshots/screenshot-started.png)

![complete](./screenshots/screenshot-complete.png)

![canceled](./screenshots/screenshot-canceled.png)

### Panel display
![preparing](./screenshots/screenshot-preparing-p.png)

![printing](./screenshots/screenshot-printing-p.png)

![paused](./screenshots/screenshot-paused-p.png)

![finished](./screenshots/screenshot-finished-p.png)

--- 

## 📦 Installation

To install in MagicMirror `modules` folder:

```bash
cd ~/MagicMirror/modules
git clone https://github.com/LuckyDuckTx/MMM-BambuLabNotify.git
cd MMM-BambuLabNotify
npm install
```

---

## 🛠️ Update

Need to update your BambuLabNofity module? 

```bash
cd ~/MagicMirror/modules/MMM-BambuLabNotify
git pull
npm install
```

---

## Upgrading from 1.0

Version 1.5 is backward compatible with existing configurations. No config changes are required after updating, but these new optional settings are available:

- `displayTemperatures` - Show or hide nozzle and bed temperature chips.
- `displayAms` - Show or hide AMS filament chips.
- `temperatureUnit` - Use `"C"` or `"F"` for panel temperature display.
- `text` - Customize panel labels, status labels, and toast messages.

Restart MagicMirror after updating the module or changing its config.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes in version 1.5.

---

## ⚙️ Configuration
**Add the Module to `config.js`**:
- 🔑 **Getting your credentials**
  - **IP Address:** Found in your Bambu printer’s settings (Settings > Lan Only section).
  - **Access Code:** Found in your Bambu printer’s settings (Settings > Lan Only section).
  - **Serial Number:** Printed on your printer label and in Bambu Studio (under > Device > Update ), or in the Bambu Handy app (Settings > Firmware Version).

- Edit your `MagicMirror/config/config.js` file and add the following configuration:


```javascript
{
  module: "MMM-BambuLabNotify",
  position: "bottom_right",
  config: {
    printerName: "BambuLab A1", 
    host: "192.168.x.xxx",          // Printer IP address
    password: "YOUR-ACCESS-CODE",   // Access Code from printer
    serial: "YOUR-PRINTER-SERIAL",  // Serial Number from printer
  }
}
```

## Configuration Options
| Option              | Type    | Default      | Description                                                                                           |
| ------------------- | ------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `printerName`       | String  | `BambuLab Printer`| Name shown in the panel and toasts.                                                              |
| `host`              | String  | `127.0.0.1`  | IP Address - Found in your Bambu printer’s settings (Settings > Lan Only section).                    |
| `password`          | String  |              | Access Code - Found in your Bambu printer’s settings (Settings > Lan Only section).                   |
| `serial`            | String  |              | Serial Number - Printed on your printer label and in the Bambu Handy app (Settings > Firmware Version). |
| `hideWhileOff`      | Boolean   | `false`     | Hide status when the printer is offline |
| `hideWhileIdle`      | Boolean   | `false`    | Hide status when the printer is idle |
| `displayTemperatures` | Boolean | `true`      | Show nozzle and bed temperatures in the status panel.                                                  |
| `displayAms`        | Boolean | `true`       | Show detected AMS filament type and color in the status panel.                                         |
| `temperatureUnit`   | String  | `C`          | Temperature unit used in the panel. Use `"C"` for Celsius or `"F"` for Fahrenheit.                     |
| `textSize`          | String  | `medium`     | Panel text size. Use `"small"`, `"medium"`, or `"large"`.                                              |
| `text`              | Object  | See below  | Optional labels and toast text overrides. Supports `{printer}` and `{file}` placeholders in toast text. |
| ** Toast Messages ** ||||
| `toastDurationMs`   | Number  | `60000`      | How long toast notifications remain visible (milliseconds).                                           |
| `toastStyle`        | String  | `modal`      | Where the toast messages display. "modal" (center + overlay) or "corner" (top-right)                  |
| `showOnStart`       | Boolean  | `true`       | Show Toast while connecting                                                                           |
| `showOnDone`        | Boolean  | `true`       | Show Toast when print is finished                                                                     |
| `showOnError`       | Boolean  | `true`       | Show Toast when an error or cancel occurs                                                             |
| `showOnIdle`        | Boolean  | `true`       | Show Toast when printer becomes idle                                                                  |
| `showOnPause`       | Boolean  | `true`       | Show Toast when printer is paused                                                                     |
| `showOnCancel`      | Boolean  | `true`       | Show Toast when print is canceled                                                                     |
| ** Advanced Settings  **   ||| You shouldn't need to change these unless you're debugging |
| `port`              | Number  | `8883`       | MQTT Port on printer                                                                                  |
| `user`              | String  | `bblp`       | MQTT user on printer                                                                                  |
| `idleAfterCancelMs` | Number  | `60000`      | Time after cancel before panel resets to Idle (milliseconds).                                         |
| `progressStep`      | Number  | `1`          | Bucket size for percent progress updates. Example: `5` → percent redraws at 0%, 5%, 10% … Other panel data can refresh independently. |
| `debounceMs`        | Number  | `15000`      | Minimum time between identical toast notifications (prevents spam).                                   |
| `logRaw`            | Boolean | `false`      | If `true`, logs every raw MQTT message to console (very noisy).                                       |
| `logOnChange`       | Boolean | `false`      | Logs only when state changes (recommended for debugging).                                            |
| `idleTimeoutMs`     | Number  | `120000`     | Auto-reset to idle if no messages received for this duration (ms).                                    |
| `doneQuietWindowMs` | Number  | `120000`     | Suppresses ghost finish/error events if printer hasn’t been recently active (helps after reconnects). |
| `assumeIdleAfterMs` | Number  | `8000`       | Fallback: if nothing arrives after connect, assume Idle to clear “Connecting…” state.                 |

---

## 🌐 Custom Text and Language

You can customize panel labels, status text, and toast messages by adding a `text` object inside the module `config`. You only need to include the keys you want to change; omitted keys use the defaults below.

Toast text supports these placeholders:
- `{printer}` - The configured `printerName`
- `{file}` - The current print file/job name when available

Example:

```javascript
{
  module: "MMM-BambuLabNotify",
  position: "bottom_right",
  config: {
    printerName: "BambuLab A1",
    host: "192.168.x.xxx",
    password: "YOUR-ACCESS-CODE",
    serial: "YOUR-PRINTER-SERIAL",

    text: {
      panel: {
        nozzle: "Buse:",
        bed: "Plateau:",
        empty: "Vide",
        job: "Travail:"
      },
      toast: {
        doneTitle: "{printer} Impression terminee",
        idleMessage: "Pret pour la prochaine impression."
      }
    }
  }
}
```

All available text keys:

```javascript
text: {
  fallbackPrinterName: "Bambu Printer",

  status: {
    running: "Printing",
    preparing: "Preparing",
    paused: "Paused",
    finish: "Finished",
    idle: "Idle",
    canceled: "Canceled",
    error: "Error",
    offline: "Offline",
    connecting: "Connecting..."
  },

  panel: {
    layers: "Layers:",
    complete: "complete",
    remaining: "remaining",
    preparing: "Preparing...",
    printing: "Printing...",
    nozzle: "Nozzle:",
    bed: "Bed:",
    empty: "Empty",
    external: "Ext",
    job: "Job:",
    tray: "Tray"
  },

  toast: {
    notification: "Notification",
    startTitle: "{printer} Print Started",
    startMessage: "{file} started",
    startFallbackMessage: "Print job started",
    doneTitle: "{printer} Print Complete",
    doneMessage: "{file} finished (100%).",
    doneFallbackFile: "Job",
    pauseTitle: "{printer} Paused",
    pauseMessage: "{file} paused.",
    pauseFallbackMessage: "Print paused.",
    cancelTitle: "{printer} Print Canceled",
    cancelMessage: "{file} was canceled.",
    cancelFallbackMessage: "Print job canceled.",
    errorTitle: "{printer} Error",
    errorFallbackMessage: "{file} reported an error state.",
    idleTitle: "{printer} Idle",
    idleMessage: "Ready for next job."
  }
}
```

---

## Temperature Units

Bambu Lab printer payloads report temperatures in Celsius. The `temperatureUnit` option only changes how temperatures are displayed in the MagicMirror panel; it does not change printer, slicer, or MQTT values. While printing, the display will show current and target temps, such as: `Nozzle: 220C/220C` otherwise, only the current temp will be displayed. 

```javascript
temperatureUnit: "C" // Celsius
temperatureUnit: "F" // Fahrenheit
```

---

## AMS Compatibility

AMS details are shown when the printer includes AMS tray data in its status payload. External spool details are shown when the printer includes a populated `vt_tray` object. This release was tested against A1/AMS Lite-style payloads.

Note: If the MagicMirror was (re)started while the printer is idle/offline, the AMS information may not show up until a print has been started. 
If AMS information does not appear at all, enable `logRaw: true`, restart MagicMirror, start a print, and capture a `push_status` payload from the logs.

---

## 🔧 Troubleshooting

- Restart MagicMirror after changing module configuration.
- If the panel stays offline, confirm the printer IP, access code, and serial number.
- If the printer IP changes after being powered off, assign it a reserved/static IP on your network.
- If AMS data does not show, enable `logRaw: true` and check whether the printer payload includes an `ams` object.
- If notifications repeat too often, increase `debounceMs`.
- Use `logOnChange: true` for lighter debugging, or `logRaw: true` only when you need full MQTT payloads.

---

## ⚠️ Known Issues

- During filament/color changes, the active AMS slot indicator may lag behind the printer for a short time. The module can only update after the printer sends refreshed AMS tray state in its MQTT status payload.
- If a printer is turned off for a while, some networks may assign it a different IP address when it comes back online. If the module stops connecting after power cycling the printer, reserve a static IP for the printer in your router/DHCP settings and update `host` if needed.
- If your External filament slot retains the last (ghost) filament data, even though you're no longer using that slot. This is on the printer side. You can clear that slot info from your printer by using Bambu Studio. Simply go to the Device tab in Bambu Studio, and select your printer. In the filament/AMS area, click the External filament slot and click Reset.

---

## 🛠 Notes

- Works on local LAN only - MagicMirror and Printer must be on same LAN. 
- Printer does NOT need to be in `LAN Only Mode`. 
- Tested with Bambu Lab A1 (Aug 2025 firmware version 01.06.00.00).
- All state changes and notifications can be logged. See `logRaw` and `logOnChange` configs. 


## License
This project is licensed under the MIT License.

---
   
