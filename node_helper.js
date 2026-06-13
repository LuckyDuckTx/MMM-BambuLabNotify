/* MMM-BambuLabNotify: node_helper.js
   - MQTT over TLS to Bambu LAN broker
   - Subscribes to device/<serial>/report only (most reliable)
   - Start/Done/Error/Cancel toasts
   - Progress updates in N% buckets
*/
const NodeHelper = require("node_helper");
const mqtt = require("mqtt");

// ---------- helpers ----------
const lower = (x) => (x ?? "").toString().toLowerCase();
const pick = (...v) => v.find((x) => x !== undefined && x !== null && x !== "");
const isNum = (n) => typeof n === "number" && isFinite(n);
const BN_DEFAULT_TEXT = {
  fallbackPrinterName: "Bambu Printer",
  toast: {
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
};

function fmtMinutes(mins) {
  if (!isNum(mins) || mins < 0) return null;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function cleanErrorText(...c) {
  for (const v of c) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || /^\d+$/.test(s) || s.length < 3) continue;
    return s;
  }
  return "";
}

function mergeText(defaults, custom) {
  const merged = {};
  const source = custom && typeof custom === "object" ? custom : {};
  Object.keys(defaults).forEach((key) => {
    if (defaults[key] && typeof defaults[key] === "object" && !Array.isArray(defaults[key])) {
      merged[key] = Object.assign({}, defaults[key], source[key] || {});
    } else {
      merged[key] = source[key] !== undefined ? source[key] : defaults[key];
    }
  });
  return merged;
}

function template(text, values = {}) {
  return String(text || "").replace(/\{(\w+)\}/g, (_, key) => (
    values[key] !== undefined && values[key] !== null ? String(values[key]) : ""
  ));
}

function numOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeAmsColor(color) {
  if (!color) return "";
  const s = String(color).trim().replace(/^#/, "");
  if (/^[0-9a-f]{8}$/i.test(s) && s.slice(6, 8).toUpperCase() === "00") return "";
  return /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s) ? s.slice(0, 6).toUpperCase() : "";
}

function normalizeSlot(slot) {
  if (slot === undefined || slot === null || slot === "") return "";
  const n = Number(slot);
  return Number.isFinite(n) ? String(n + 1) : String(slot);
}

function extractTemperatures(print = {}, msg = {}) {
  const nozzle = numOrNull(pick(
    print.nozzle_temper, print.nozzle_temp, print.hotend_temper, print.hotend_temp,
    msg.nozzle_temper, msg.nozzle_temp
  ));
  const nozzleTarget = numOrNull(pick(
    print.nozzle_target_temper, print.nozzle_target_temp, print.target_nozzle_temper, print.nozzle_temper_target,
    msg.nozzle_target_temper, msg.nozzle_target_temp
  ));
  const bed = numOrNull(pick(
    print.bed_temper, print.bed_temp, print.heatbed_temper, print.heatbed_temp,
    msg.bed_temper, msg.bed_temp
  ));
  const bedTarget = numOrNull(pick(
    print.bed_target_temper, print.bed_target_temp, print.target_bed_temper, print.bed_temper_target,
    msg.bed_target_temper, msg.bed_target_temp
  ));

  if ([nozzle, nozzleTarget, bed, bedTarget].every((v) => v === null)) return null;
  return { nozzle, nozzleTarget, bed, bedTarget };
}

function mergeTemperatures(next, prev) {
  if (!next) return prev || null;
  const merged = Object.assign({}, prev || {});
  ["nozzle", "nozzleTarget", "bed", "bedTarget"].forEach((key) => {
    if (next[key] !== null && next[key] !== undefined) merged[key] = next[key];
  });

  return ["nozzle", "nozzleTarget", "bed", "bedTarget"].some((key) => isNum(merged[key])) ? merged : null;
}

function extractFilaments(print = {}) {
  const amsRoot = print.ams || {};
  const units = Array.isArray(amsRoot.ams) ? amsRoot.ams : [];
  const activeAms = pick(amsRoot.ams_id, amsRoot.ams_now, print.ams_id, print.ams_now);
  const activeTray = pick(
    amsRoot.tray_now,
    amsRoot.tray_tar,
    amsRoot.tray_id,
    print.tray_id,
    print.tray_now,
    print.vt_tray?.id
  );
  const filaments = [];

  const addTray = (tray, amsId, fallbackSlot, options = {}) => {
    if (!tray || typeof tray !== "object") return;
    const rawSlot = pick(tray.id, tray.tray_id, fallbackSlot);

    const type = pick(
      tray.tray_sub_brands,
      tray.tray_type,
      tray.tray_info_idx,
      tray.filament_type,
      tray.name
    );
    const color = normalizeAmsColor(pick(tray.tray_color, tray.color, tray.filament_colour, tray.filament_color));
    const hasTrayDetails = !!(type || color);
    const empty = !hasTrayDetails || (!type && !color);
    if (options.external && empty) return;

    const slot = options.slot || normalizeSlot(rawSlot);
    const active = String(activeAms ?? amsId ?? "") === String(amsId ?? "") &&
      String(activeTray ?? "") !== "" &&
      String(activeTray) === String(rawSlot ?? "");

    filaments.push({
      ams: amsId != null ? String(amsId) : "",
      slot,
      type: type ? String(type) : "",
      color,
      active,
      empty,
      external: !!options.external
    });
  };

  units.forEach((unit, unitIndex) => {
    const amsId = pick(unit.id, unit.ams_id, unitIndex);
    const trays = Array.isArray(unit.tray) ? unit.tray : [];
    trays.forEach((tray, trayIndex) => addTray(tray, amsId, trayIndex));
  });

  if (!filaments.length && Array.isArray(amsRoot.tray)) {
    amsRoot.tray.forEach((tray, trayIndex) => addTray(tray, activeAms, trayIndex));
  }

  if (print.vt_tray && typeof print.vt_tray === "object") {
    addTray(print.vt_tray, activeAms, activeTray, { external: true, slot: "Ext" });
  }

  return filaments;
}

function stableJson(value) {
  return JSON.stringify(value || null);
}

function looksIdlePrintObj(p) {
  if (!p || typeof p !== "object") return false;
  if (p.print_type === "idle") return true;
  if (p.gcode_state === "FINISH" || p.gcode_state === "IDLE") return true;
  const hasProgress = p.mc_percent !== undefined || p.mc_remaining_time !== undefined;
  const hasActiveStage = p.mc_print_stage !== undefined || p.mc_print_sub_stage !== undefined || p.layer_num !== undefined;
  return !hasProgress && !hasActiveStage;
}

function seqIsNewer(curr, last) {
  if (!Number.isFinite(curr)) return false;
  if (!Number.isFinite(last) || last < 0) return true;
  const MOD = 65536;        
  const HALF = MOD >>> 1; 
  const diff = (curr - last + MOD) % MOD;
  return diff > 0 && diff < HALF;
}

// ---------- module ----------
module.exports = NodeHelper.create({
  start() {
    this.client = null;
    this.config = {};
    this.connected = false;

    this.lastState = "connecting";
    this.lastStateAt = 0;
    this.lastMsgAt = 0;

    this.lastFile = "";
    this.lastPercent = null;
    this.lastEtaMins = null;
    this.layerNum = null;
    this.layerTotal = null;
    this.lastLayerStr = "";
    this.lastTemperatures = null;
    this.lastFilaments = [];
    this.lastBucket = null;
    this.lastErrorText = "";

    this.lastActiveAt = 0;
    this.lastDoneAt = 0;
    this.lastPausedAt = 0;

    // Per-stream sequence guards
    this.lastSeqStatus = -1;
    this.lastSeqCmd = -1;

    this.lastAlertAt = { start: 0, done: 0, pause: 0, error: 0, connected: 0, idle: 0, cancel: 0 };

    // Cancel/idle guards
    this._postCancelTimer = null;
    this._cancelEpoch = 0;
    this._cancelGuardUntil = 0;
    this._idleTicker = setInterval(() => this._idleWatch(), 10_000);
    this._postConnectTimer = null;
    this._lastPingReqAt = 0;
    this._lastPingRespAt = 0;
    this._lastReconnectAt = 0;
    this._lastSubscribeAt = 0;

    // After long idle, allow printer sequence_id to wrap/restart without dropping messages
    this._seqResetAfterMs = Math.max(5 * 60 * 1000, Number(this.config.seqResetAfterMs) || 60 * 60 * 1000);

    console.log("[MMM-BambuLabNotify] node_helper started");
  },

  socketNotificationReceived(n, cfg) {
    if (n !== "BN_CONNECT") return;

    this.config = Object.assign({
      host: "127.0.0.1",
      port: 8883,
      user: "bblp",
      password: "",
      serial: "",
      printerName: "BambuLab Printer",
      subscribeMode: "report",
      toastDurationMs: 60000,
      showOnStart: true,
      showOnDone: true,
      showOnError: true,
      showOnPause: true,
      showOnIdle: true,
      showOnCancel: true,

      progressStep: 1,
      debounceMs: 15000,
      logRaw: false,
      logOnChange: false,

      idleTimeoutMs: 120000,         // 2 min
      doneQuietWindowMs: 120000,     // suppress stale done/error if not recently active
      assumeIdleAfterMs: 8000,       // fallback after subscribe -> Idle
      seqResetAfterMs: 60 * 60 * 1000, // reset seq tracking if no msgs for this long
      idleAfterCancelMs: 60000,      // when to auto-reset to idle after cancel
      cancelGuardMs: 60000,          // suppress FAILED/error noise right after cancel
      text: BN_DEFAULT_TEXT
    }, cfg || {});
    this.config.text = mergeText(BN_DEFAULT_TEXT, this.config.text);

    if (!this.config.serial) {
      console.error("[MMM-BambuLabNotify] Missing 'serial' in config.");
      return;
    }

    const url = `mqtts://${this.config.host}:${this.config.port}`;
    const clientId = `mm-bambu-${Math.random().toString(16).slice(2)}`;
    const options = {
      clientId,
      clean: true,
      username: this.config.user || "bblp",
      password: this.config.password,
      keepalive: 60,
      reconnectPeriod: 5000,
      protocolVersion: 4,       // MQTT 3.1.1
      rejectUnauthorized: false,
      resubscribe: false
    };

    console.log(`[MMM-BambuLabNotify] Connecting to ${url} as ${options.username} (id ${clientId}) ...`);
    this.client = mqtt.connect(url, options);

    const topicReport = `device/${this.config.serial}/report`;
    this.client.on("connect", (connack) => {
      this.connected = true;
      this.lastState = "connecting";
      this.lastSeqStatus = -1;
      this.lastSeqCmd = -1;
      this._lastPingReqAt = 0;
      this._lastPingRespAt = 0;
      this._lastReconnectAt = Date.now();
      console.log("[MMM-BambuLabNotify] Connected...");

      setTimeout(() => {
        this.client.subscribe([topicReport], { qos: 1 }, (err) => {
          if (err) {
            console.error("[MMM-BambuLabNotify] Subscribe(report) error:", err?.message || err);
            return;
          }
          console.log(`[MMM-BambuLabNotify] Subscribed to ${topicReport}`);
          this._lastSubscribeAt = Date.now();
          this.sendSocketNotification("BN_PROGRESS", { state: "connecting", percent: null, file: "" });

          // Assume Idle if nothing meaningful arrives shortly (idle printers are quiet)
          if (this._postConnectTimer) clearTimeout(this._postConnectTimer);
          this._postConnectTimer = setTimeout(() => {
            if (this.connected && this.lastState === "connecting") {
              if (this.config.logOnChange) console.log("[MMM-BambuLabNotify] Assume-Idle fallback fired.");
              this._setIdleAndBroadcast(false);
            }
          }, Math.max(3000, Number(this.config.assumeIdleAfterMs) || 6000));
        });
      }, 250);
    });

    this.client.on("reconnect", () => {
      if (this.config.logRaw) console.log("[MMM-BambuLabNotify] Reconnecting...");
      this.connected = false;
    });

    this.client.on("close", () => {
      if (this.config.logRaw) console.log("[MMM-BambuLabNotify] Connection closed");
      this.connected = false;
      this.sendSocketNotification("BN_PROGRESS", { state: "offline", percent: null, file: "" });
    });

    // treat offline/disconnect explicitly too
    this.client.on("offline", () => {
      if (this.config.logRaw) console.log("[MMM-BambuLabNotify] MQTT offline");
      this.connected = false;
      this.sendSocketNotification("BN_PROGRESS", { state: "offline", percent: null, file: "" });
    });
    this.client.on("disconnect", (packet) => {
      if (this.config.logRaw) console.log("[MMM-BambuLabNotify] MQTT disconnect", packet?.reasonCode);
      this.connected = false;
      this.sendSocketNotification("BN_PROGRESS", { state: "offline", percent: null, file: "" });
    });

    this.client.on("error", (e) => {
      if (this.config.logRaw) console.error("[MMM-BambuLabNotify] MQTT error:", e?.message || e);
      this.connected = false;
      this.sendSocketNotification("BN_PROGRESS", { state: "offline", percent: null, file: "" });
    });

    if (this.client && this.client.stream) {
      this.client.stream.on("error", (e) => console.error("[MMM-BambuLabNotify] stream error:", e?.message || e));
      this.client.stream.on("close", () => console.log("[MMM-BambuLabNotify] stream closed"));
    }

    // ping watchdog taps
    this.client.on("packetsend", (packet) => {
      if (packet?.cmd === "pingreq") this._lastPingReqAt = Date.now();
    });
    this.client.on("packetreceive", (packet) => {
      if (packet?.cmd === "pingresp") this._lastPingRespAt = Date.now();
    });

    // ---- message handler
    this.client.on("message", (topic, buf, packet) => {
      if (this._postConnectTimer) { clearTimeout(this._postConnectTimer); this._postConnectTimer = null; }

      // Drop retained history (prevents ghost “finished/error” on reconnect)
      if (packet && packet.retain) return;

      const txt = buf.toString();
      const nowTs = Date.now();
      const prevMsgAt = this.lastMsgAt || 0;

      this.lastMsgAt = nowTs;

      if (this.config.logRaw) console.log("[MMM-BambuLabNotify] RX:", topic, txt);

      let msg;
      try { msg = JSON.parse(txt); } catch { return; }

      const print = msg.print || {};
      const command = lower(print.command || msg.command || "");

      // ----- Per-stream sequence guards -----
      if (this.lastSeqStatus === undefined) this.lastSeqStatus = -1;
      if (this.lastSeqCmd === undefined) this.lastSeqCmd = -1;

      const rawSeq = pick(print.sequence_id, msg.sequence_id, msg.sequenceId, print.seq, msg.seq);
      const seq = rawSeq != null ? Number(rawSeq) : NaN;

      const isStatusTick = lower(print.command) === "push_status" || print.msg === 1 || msg.msg === 1;
      const isCommandAck = !isStatusTick && (command === "pause" || command === "resume" || command === "stop");

      const longIdle = (nowTs - (prevMsgAt || 0)) > (this._seqResetAfterMs || 60 * 60 * 1000);

      if (Number.isFinite(seq)) {
        if (isStatusTick) {
          if (!seqIsNewer(seq, this.lastSeqStatus)) {
            if (this.config.logOnChange) {
              console.log("[MMM-BambuLabNotify] Dropping out-of-order status seq (wrap-aware):", seq, "<=~", this.lastSeqStatus);
            }
            return;
          }
          this.lastSeqStatus = seq;
        } else if (isCommandAck) {
          if (!seqIsNewer(seq, this.lastSeqCmd)) {
            if (this.config.logOnChange) {
              console.log("[MMM-BambuLabNotify] Dropping out-of-order cmd seq (wrap-aware):", seq, "<=~", this.lastSeqCmd);
            }
            return;
          }
          this.lastSeqCmd = seq;
        }
      }

      const isProjectFile = command === "project_file";
      const gcodeStateRaw = lower(print.gcode_state || "");
      const aboutToStart = gcodeStateRaw === "prepare" || gcodeStateRaw === "running";

      // Cancel any pending cancel→idle timer when a new job is observed
      if (isProjectFile || aboutToStart) {
        if (this._postCancelTimer) {
          clearTimeout(this._postCancelTimer);
          this._postCancelTimer = null;
        }
        this._cancelEpoch += 1;
        this._cancelGuardUntil = 0;
      }

      // Quick state from control acks
      let stateFromAck = "";
      if (command === "pause") stateFromAck = "paused";
      if (command === "resume") stateFromAck = "running";
      if (command === "stop") stateFromAck = "canceled";

      // ----- File / job -----
      const file = pick(print.gcode_file, print.subtask_name, msg.file, msg.job) || this.lastFile || "";
      if (file) this.lastFile = file;

      // ----- Normalize state -----
      let mcps = lower(print.mc_print_state);
      let gcs  = lower(print.gcode_state);
      let state = lower(pick(mcps, gcs, print.state, msg.print_status, msg.state));

      if (state === "printing") state = "running";
      if (state === "prepare") state = "preparing";
      if (["finished", "success", "completed", "finish"].includes(state)) state = "finish";
      if (state === "pause") state = "paused";
      if (["fail", "failed", "error"].includes(state)) state = "error";
      if (["cancel","canceled","cancelled","stopped","stop","abort","aborted"].includes(state)) {
        state = "canceled";
      }

      // Prefer control-ack state if present
      if (stateFromAck) state = stateFromAck;

      // Percent & ETA
      let percent = pick(print.mc_percent, print.percent);
      if (typeof percent === "string" && percent.trim() !== "") {
        const n = Number(percent);
        percent = isFinite(n) ? n : null;
      }
      if (!isNum(percent)) percent = null;

      const etaMinsRaw = pick(
        print.mc_remaining_time, print.remaining_time,
        msg.remaining_time, msg.time_remaining, msg.time_left
      );
      let etaMins = isNum(etaMinsRaw) ? etaMinsRaw : (this.lastEtaMins ?? null);
      if (state === "finish") etaMins = 0;
      const etaStr = fmtMinutes(etaMins);

      // Layer Counter
      let layerStr = "";
      const layer = pick(print.layer_num, msg.layer_num);
      if (layer !== undefined) this.layerNum = layer;
      const total = pick(print.total_layer_num, msg.total_layer_num);
      if (total !== undefined) this.layerTotal = total;
      if (this.layerNum !== null && this.layerTotal !== null) {
        layerStr = `${this.layerNum}/${this.layerTotal}`;
      }

      const temperatures = mergeTemperatures(extractTemperatures(print, msg), this.lastTemperatures);
      const filaments = extractFilaments(print);
      const amsFilaments = filaments.length ? filaments : this.lastFilaments;

      // Infer state from event or percent if still unknown
      const event = lower(pick(msg.event, msg.type));
      if (!state && event) {
        if (event.includes("start")) state = "preparing";
        else if (event.includes("resume")) state = "running";
        else if (event.includes("pause")) state = "paused";
        else if (event.includes("finish") || event.includes("done") || event.includes("complete")) state = "finish";
        else if (event.includes("error") || event.includes("fail")) state = "error";
      }
      if (!state && isNum(percent)) {
        if (percent > 0 && percent < 100 && this.lastState !== "running") state = "running";
        if (percent === 100) state = "finish";
      }
      if (!state && gcs) {
        if (gcs === "running") state = "running";
        else if (gcs === "finish") state = "finish";
        else if (gcs === "idle") state = "idle";
      }

      // ----- Sticky Pause logic -----
      const terminalNow =
        stateFromAck === "canceled" ||
        state === "canceled" ||
        state === "finish" ||
        state === "error" ||
        gcs === "finish" ||
        gcs === "failed" ||
        gcs === "idle";

      const pausedStrict =
        gcs === "pause" || gcs === "paused" || String(print.mc_print_stage) === "3";

      if (pausedStrict && !terminalNow) {
        state = "paused";
      } else if (this.lastState === "paused") {
        const explicitResume = (stateFromAck === "running") || (gcs === "running");
        const explicitTerminal = terminalNow;
        if (!explicitResume && !explicitTerminal) {
          state = "paused";
        }
      }

      // Connecting but only seeing idle-ish payloads? Flip to idle.
      if ((!state || state === "connecting") && this.lastState === "connecting" && looksIdlePrintObj(print)) {
        state = "idle";
      }

      // Cancel guard: suppress FAILED/error right after user cancel
      if (this._cancelGuardUntil && nowTs < this._cancelGuardUntil) {
        if (state === "error" || gcs === "failed") {
          state = "canceled";
        }
      }

      // Suppress idle→error noise
      if (this.lastState === "idle" && state === "error") {
        const idleish = looksIdlePrintObj(print) && !isNum(percent);
        const noStartHint = !(isProjectFile || aboutToStart);
        if (idleish && noStartHint) {
          if (this.config.logOnChange) console.log("[MMM-BambuLabNotify] Suppressed idle→error noise.");
          return;
        }
      }

      const stateChanged = !!state && state !== this.lastState;
      if (stateChanged) this.lastStateAt = nowTs;

      // Real activity tracking
      const isActivelyPrintingTick =
        (state === "running" || this.lastState === "running") &&
        (isNum(percent) || print.layer_num !== undefined || print.mc_print_sub_stage !== undefined);
      const isActiveState = state === "preparing" || state === "running" || state === "paused";
      if (isActiveState || isActivelyPrintingTick) {
        this.lastActiveAt = nowTs;
      }

      // Cancel flow
      if (stateChanged && state === "canceled") { 
        if (this.config.showOnCancel) {
          const Pname = this.config.printerName || this._text("fallbackPrinterName");
          this._alertOnce(
            "cancel",
            this._text("toast.cancelTitle", { printer: Pname, file: this.lastFile || "" }),
            this.lastFile ? this._text("toast.cancelMessage", { printer: Pname, file: this.lastFile }) : this._text("toast.cancelFallbackMessage", { printer: Pname }),
            8000,
            "error"
          );
        }
        const baseGuard = Math.max(30_000, Number(this.config.cancelGuardMs) || 60_000);
        const idleDelay = Math.max(30_000, Number(this.config.idleAfterCancelMs) || 120_000);
        this._cancelGuardUntil = nowTs + Math.max(baseGuard, idleDelay + 15_000);

        const myEpoch = ++this._cancelEpoch;
        if (this._postCancelTimer) clearTimeout(this._postCancelTimer);
        this._postCancelTimer = setTimeout(() => {
          if (myEpoch === this._cancelEpoch) {
            this._setIdleAndBroadcast(true);
            this.lastSeqStatus = -1;
            this._cancelGuardUntil = 0;
          }
        }, Math.max(30_000, Number(this.config.idleAfterCancelMs) || 120_000));
      }

      if (stateChanged && state !== "canceled" && state !== "error" && this._postCancelTimer) {
        clearTimeout(this._postCancelTimer);
        this._postCancelTimer = null;
        this._cancelGuardUntil = 0;
      }

      // Activity window for de-ghosting finish/error
      const recentlyActive = (Date.now() - (this.lastActiveAt || 0)) <= (this.config.doneQuietWindowMs || 120000);

      if (this.config.logOnChange && stateChanged) {
        console.log("[MMM-BambuLabNotify] State change:", this.lastState, "→", state);
      }

      if ((state === "finish" || state === "error") && !recentlyActive) {
        return;
      }

      // Toast gating (start/resume)
      const wasPaused = (this.lastState === "paused");
      const explicitResumeNow = (stateFromAck === "running") || (gcs === "running");
      const isResume = explicitResumeNow && wasPaused;
      const justPaused = nowTs - (this.lastPausedAt || 0) < 4000;

      const canStartToast =
        stateChanged &&
        (state === "preparing" || state === "running") &&
        (!wasPaused || isResume) &&
        !pausedStrict &&
        !justPaused;

      const Pname = this.config.printerName || this._text("fallbackPrinterName");

      if (this.config.showOnStart && canStartToast) {
        this._alertOnce("start",
          this._text("toast.startTitle", { printer: Pname, file }),
          file ? this._text("toast.startMessage", { printer: Pname, file }) : this._text("toast.startFallbackMessage", { printer: Pname, file }),
          this.config.toastDurationMs, "start");
      }

      const reached100 = isNum(percent) && percent >= 100;
      const isFinishState = state === "finish";
      if (this.config.showOnDone && recentlyActive && (isFinishState || (this.lastState === "running" && reached100))) {
        this._alertOnce(
          "done",
          this._text("toast.doneTitle", { printer: Pname, file: this.lastFile || "" }),
          this._text("toast.doneMessage", { printer: Pname, file: this.lastFile || this._text("toast.doneFallbackFile") }),
          this.config.toastDurationMs,
          "done"
        );
        this.lastDoneAt = Date.now();
      }

      if (stateChanged && state === "paused") {
        if (this.config.showOnPause) {
          this._alertOnce(
            "pause",
            this._text("toast.pauseTitle", { printer: Pname, file: this.lastFile || "" }),
            this.lastFile ? this._text("toast.pauseMessage", { printer: Pname, file: this.lastFile }) : this._text("toast.pauseFallbackMessage", { printer: Pname }),
            this.config.toastDurationMs,
            "info"
          );
          this.lastPausedAt = nowTs;  
        } else {
          this.lastPausedAt = nowTs; 
        }
      }

      const inCancelGuard = this._cancelGuardUntil && Date.now() < this._cancelGuardUntil;
      const errText = cleanErrorText(
        msg.error, msg.message, msg.err,
        print.msg, print.err_msg, print.error_text, print.alarm_text
      );
      const becameError = (state === "error" && this.lastState !== "error");
      const newMeaningfulErr = errText && errText !== this.lastErrorText;

      if (!inCancelGuard && this.config.showOnError && recentlyActive) {
        if (becameError && !newMeaningfulErr) {
          this._alertOnce("error", this._text("toast.errorTitle", { printer: Pname, file: file || "" }),
            this._text("toast.errorFallbackMessage", { printer: Pname, file: file || Pname }),
            this.config.toastDurationMs, "error");
        } else if (newMeaningfulErr) {
          this._alertOnce("error", this._text("toast.errorTitle", { printer: Pname, file: file || "" }),
            errText.slice(0, 200),
            this.config.toastDurationMs, "error");
          this.lastErrorText = errText;
        }
      }

      // Immediate idle reflect
      if (stateChanged && state === "idle") {
        this._setIdleAndBroadcast(true);
        this.lastSeqStatus = -1; // allow fresh status ticks after idle
        this._cancelEpoch += 1;
        this._cancelGuardUntil = 0;
        return;
      }

      // Progress buckets
      let bucket = null;
      if (isNum(percent)) {
        const step = Math.max(1, Number(this.config.progressStep) || 1);
        bucket = Math.floor(percent / step);
      }
      const bucketChanged = (bucket !== null && bucket !== this.lastBucket);
      const etaChanged = (isNum(etaMins) ? etaMins : null) !== (this.lastEtaMins ?? null);
      const layerChanged = layerStr !== (this.lastLayerStr || "");
      const tempsChanged = stableJson(temperatures) !== stableJson(this.lastTemperatures);
      const filamentsChanged = stableJson(amsFilaments) !== stableJson(this.lastFilaments);

      if (stateChanged || bucketChanged || etaChanged || layerChanged || tempsChanged || filamentsChanged) {
        const payload = {
          remaining: etaStr || null,
          layers: layerStr,
          temperatures: temperatures || null,
          filaments: amsFilaments || [],
          file: this.lastFile || "",
          state: state || this.lastState || "running"
        };
        if (isNum(percent)) {
          payload.percent = Math.min(100, Math.max(0, percent));
        } else if ((state || this.lastState) === "idle") {
          payload.percent = null;
        }
        this.sendSocketNotification("BN_PROGRESS", payload);
      }

      // Track
      if (stateChanged) this.lastState = state;
      if (isNum(percent)) this.lastPercent = percent;
      if (bucket !== null) this.lastBucket = bucket;
      if (isNum(etaMins)) this.lastEtaMins = etaMins;
      this.lastLayerStr = layerStr;
      if (temperatures) this.lastTemperatures = temperatures;
      if (filaments.length) this.lastFilaments = filaments;
      if (state && state !== "error") this.lastErrorText = "";
    });
  },

  _idleWatch() {
    const now = Date.now();
    if (!this.connected) return;

    // ---- "go idle after quiet" logic ----
    const idleTimeout = Math.max(60_000, Number(this.config.idleTimeoutMs) || 180_000);

    if (this.lastState && this.lastState !== "idle" && this.lastMsgAt > 0 && now - this.lastMsgAt > idleTimeout) {
      this._setIdleAndBroadcast(true);
      this.lastSeqStatus = -1;
      this._cancelEpoch += 1;
      this._cancelGuardUntil = 0;
    }

    if ((this.lastState === "finish" || this.lastState === "canceled") && now - this.lastStateAt > idleTimeout) {
      this._setIdleAndBroadcast(true);
      this.lastSeqStatus = -1;
      this._cancelEpoch += 1;
      this._cancelGuardUntil = 0;
      return;
    }

    // ---- STALE STREAM / WATCHDOG ----
    const quiet = this.lastMsgAt ? (now - this.lastMsgAt) : Infinity;
    const ACTIVE = new Set(["preparing", "running", "paused"]);
    const isActive = ACTIVE.has(this.lastState);

    const staleIdleMs   = 6 * 60 * 60 * 1000;  // 6h silence when NOT active
    const staleActiveMs = 45 * 60 * 1000;      // 45m total silence while active
    const noActivityMs  = 45 * 60 * 1000;      // 45m since lastActiveAt (real progress)

    // Ping watchdog: if we sent a ping but never saw a response for >2m, assume dead
    const pingRespTimeoutMs = 2 * 60 * 1000;
    const sentPingAgo = this._lastPingReqAt ? (now - this._lastPingReqAt) : Infinity;
    const respIsOld   = this._lastPingRespAt < this._lastPingReqAt;
    const pingLooksDead = sentPingAgo > pingRespTimeoutMs && respIsOld;

    // Nightly resubscribe (24h) when quiet, to refresh broker subs without tear-down
    const needsNightlyResub = (now - (this._lastSubscribeAt || 0)) > (24 * 60 * 60 * 1000);

    // Cooldown between reconnect attempts
    const reconnectCooldownMs = 30 * 60 * 1000; // 30m
    this._lastReconnectAt = this._lastReconnectAt || 0;
    const dueCooldown = (now - this._lastReconnectAt) > reconnectCooldownMs;

    let shouldReconnect = false;

    if (pingLooksDead) {
      shouldReconnect = true;
    } else if (!isActive && quiet > staleIdleMs) {
      shouldReconnect = true;
    } else if (isActive && quiet > staleActiveMs && (now - (this.lastActiveAt || 0)) > noActivityMs) {
      shouldReconnect = true;
    } else if (needsNightlyResub && quiet > 5 * 60 * 1000) {
      try {
        const topicReport = `device/${this.config.serial}/report`;
        this.client.subscribe([topicReport], { qos: 1 }, (err) => {
          if (!err) this._lastSubscribeAt = Date.now();
        });
      } catch {}
    }

    if (this.connected && dueCooldown && shouldReconnect) {
      console.log("[MMM-BambuLabNotify] MQTT stream stale; soft-reconnecting...");
      this._lastReconnectAt = now;

      // First try a gentle reconnect on the same client
      try { if (this.client) this.client.reconnect(); } catch {}

      // If that doesn't quickly restore traffic, rebuild the connection
      setTimeout(() => {
        const stillQuiet = (Date.now() - (this.lastMsgAt || 0)) > 2 * 60 * 1000; // 2m
        const stillNoPing = (Date.now() - (this._lastPingRespAt || 0)) > 2 * 60 * 1000 && this._lastPingRespAt < (this._lastPingReqAt || 0);
        if (!this.connected || stillQuiet || stillNoPing) {
          try { if (this.client) this.client.end(true); } catch {}
          this.client = null;
          // Reuse the existing config (re-subscribes to topics)
          this.socketNotificationReceived("BN_CONNECT", this.config);
        }
      }, 5000);
    }
  },

  _setIdleAndBroadcast(showToast = false) {
    const P = this.config.printerName || this._text("fallbackPrinterName");
    this.lastState = "idle";
    this.lastStateAt = Date.now();
    this.lastPercent = null;
    this.lastEtaMins = null;
    this.lastBucket = null;
    this.lastFile = "";
    this.layerNum = null;
    this.layerTotal = null;
    this.lastLayerStr = "";
    this.lastActiveAt = 0;

    if (showToast && this.config.showOnIdle) {
      this._alertOnce(
        "idle",
        this._text("toast.idleTitle", { printer: P }),
        this._text("toast.idleMessage", { printer: P }),
        6000,
        "connected"
      );
    }
    this.sendSocketNotification("BN_PROGRESS", {
      percent: null,
      remaining: null,
      file: "",
      state: "idle",
      layers: "",
      temperatures: this.lastTemperatures || null,
      filaments: this.lastFilaments || []
    });
  },

  _alertOnce(key, title, message, timer = 8000, kind = "info") {
    const now = Date.now();
    if (now - (this.lastAlertAt[key] || 0) < this.config.debounceMs) return;
    this.lastAlertAt[key] = now;
    console.log(`[MMM-BambuLabNotify] ALERT → ${title}: ${message}`);
    this.sendSocketNotification("BN_ALERT", { title, message, timer, kind });
  },

  _text(path, values = {}) {
    const parts = path.split(".");
    let value = this.config.text || BN_DEFAULT_TEXT;
    for (const part of parts) {
      value = value && value[part];
    }
    if (value === undefined || value === null || value === "") value = path;
    return template(value, values);
  },

  stop() {
    try { if (this._idleTicker) clearInterval(this._idleTicker); } catch {}
    try { if (this._postConnectTimer) clearTimeout(this._postConnectTimer); } catch {}
    try { if (this._postCancelTimer) clearTimeout(this._postCancelTimer); } catch {}
    try { if (this.client) this.client.end(true); } catch {}
    console.log("[MMM-BambuLabNotify] node_helper stopped");
  }
});
