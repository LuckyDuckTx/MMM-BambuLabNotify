/* MMM-BambuNotify: node_helper.js 
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

function looksIdlePrintObj(p) {
  if (!p || typeof p !== "object") return false;
  if (p.print_type === "idle") return true;
  if (p.gcode_state === "FINISH" || p.gcode_state === "IDLE") return true;
  const hasProgress = p.mc_percent !== undefined || p.mc_remaining_time !== undefined;
  const hasActiveStage = p.mc_print_stage !== undefined || p.mc_print_sub_stage !== undefined || p.layer_num !== undefined;
  return !hasProgress && !hasActiveStage;
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
    this.lastBucket = null;
    this.lastErrorText = "";

    this.lastActiveAt = 0;
    this.lastDoneAt = 0;

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

    console.log("[MMM-BambuNotify] node_helper started");
  },

  socketNotificationReceived(n, cfg) {
    if (n !== "BN_CONNECT") return;

    this.config = Object.assign({
      host: "127.0.0.1",
      port: 8883,
      user: "bblp",
      password: "",
      serial: "",
      printerName: "Bambu A1",

      subscribeMode: "report",

      toastDurationMs: 60000,
      showOnStart: true,
      showOnDone: true,
      showOnError: true,
      showOnPause: false, // FIXME: Not working
      showOnIdle: true,

      progressStep: 5,
      debounceMs: 15000,
      logRaw: false,
      logOnChange: true,

      idleTimeoutMs: 120000,         // 2 min
      doneQuietWindowMs: 120000,     // suppress stale done/error if not recently active
      assumeIdleAfterMs: 8000,       // fallback after subscribe -> Idle
      idleAfterCancelMs: 60000,
      cancelGuardMs: 60000           // suppress FAILED/error noise right after cancel
    }, cfg || {});

    if (!this.config.serial) {
      console.error("[MMM-BambuNotify] Missing 'serial' in config.");
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

    console.log(`[MMM-BambuNotify] Connecting to ${url} as ${options.username} (id ${clientId}) ...`);
    this.client = mqtt.connect(url, options);

    const topicReport = `device/${this.config.serial}/report`;
    const P = this.config.printerName || "Printer";

    this.client.on("connect", (connack) => {
      this.connected = true;
      this.lastState = "connecting";
      console.log("[MMM-BambuNotify] Connected:", connack);

      setTimeout(() => {
        this.client.subscribe([topicReport], { qos: 1 }, (err) => {
          if (err) {
            console.error("[MMM-BambuNotify] Subscribe(report) error:", err?.message || err);
            return;
          }
          console.log(`[MMM-BambuNotify] Subscribed to ${topicReport}`);
          this.sendSocketNotification("BN_PROGRESS", { state: "connecting", percent: null, file: "" });

          // Assume Idle if nothing meaningful arrives shortly (idle printers are quiet)
          if (this._postConnectTimer) clearTimeout(this._postConnectTimer);
          this._postConnectTimer = setTimeout(() => {
            if (this.connected && this.lastState === "connecting") {
              console.log("[MMM-BambuNotify] Assume-Idle fallback fired.");
              this._setIdleAndBroadcast(false);
            }
          }, Math.max(3000, Number(this.config.assumeIdleAfterMs) || 6000));
        });
      }, 250);
    });

    this.client.on("reconnect", () => {
      console.log("[MMM-BambuNotify] Reconnecting...");
      this.connected = false;
      this.sendSocketNotification("BN_PROGRESS", { state: "connecting", percent: null, file: "" });
    });

    this.client.on("close", () => {
      console.log("[MMM-BambuNotify] Connection closed");
      this.connected = false;
      this.sendSocketNotification("BN_PROGRESS", { state: "offline", percent: null, file: "" });
    });

    this.client.on("error", (e) => {
      console.error("[MMM-BambuNotify] MQTT error:", e?.message || e);
      this.connected = false;
      this.sendSocketNotification("BN_PROGRESS", { state: "offline", percent: null, file: "" });
    });

    if (this.client && this.client.stream) {
      this.client.stream.on("error", (e) => console.error("[MMM-BambuNotify] stream error:", e?.message || e));
      this.client.stream.on("close", () => console.log("[MMM-BambuNotify] stream closed"));
    }

    // ---- message handler
    this.client.on("message", (topic, buf, packet) => {
      if (this._postConnectTimer) { clearTimeout(this._postConnectTimer); this._postConnectTimer = null; }

      // Drop retained history (prevents ghost “finished/error” on reconnect)
      if (packet && packet.retain) return;

      const txt = buf.toString();
      this.lastMsgAt = Date.now();
      if (this.config.logRaw) console.log("[MMM-BambuNotify] RX:", topic, txt);

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

      if (Number.isFinite(seq)) {
        if (isStatusTick) {
          if (seq <= this.lastSeqStatus) return; 
          this.lastSeqStatus = seq;
        } else if (isCommandAck) {
          if (seq <= this.lastSeqCmd) return;
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

      // Hard pause markers from A1
      const pausedStrict =
        gcs === "pause" || gcs === "paused" || String(print.mc_print_stage) === "3";

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
      const etaMins = isNum(etaMinsRaw) ? etaMinsRaw : Number(etaMinsRaw);
      const etaStr = fmtMinutes(isNum(etaMins) ? etaMins : null);

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
      // If explicit pause markers are present, force paused.
      if (pausedStrict) {
        state = "paused";
      } else {
        // Only allow leaving "paused" on explicit signals (ack or gcode_state: running).
        if (this.lastState === "paused") {
          const explicitResume = (stateFromAck === "running") || (gcs === "running");
          if (!explicitResume) {
            // Do NOT infer resume from percent/layer ticks.
            state = "paused";
          }
        }
      }

      // Connecting but only seeing idle-ish payloads? Flip to idle so panel leaves “Connecting…”
      if ((!state || state === "connecting") && this.lastState === "connecting" && looksIdlePrintObj(print)) {
        state = "idle";
      }

      // --- Cancel guard: suppress FAILED/error right after user cancel
      const nowTs = Date.now();
      if (this._cancelGuardUntil && nowTs < this._cancelGuardUntil) {
        if (state === "error" || gcs === "failed") {
          state = "canceled"; // stay canceled during guard window
        }
      }

      const stateChanged = !!state && state !== this.lastState;
      if (stateChanged) this.lastStateAt = nowTs;

      // ---- Real activity tracking
      const isActivelyPrintingTick =
        (state === "running" || this.lastState === "running") &&
        (isNum(percent) || print.layer_num !== undefined || print.mc_print_sub_stage !== undefined);
      const isActiveState = state === "preparing" || state === "running" || state === "paused";
      if (isActiveState || isActivelyPrintingTick) {
        this.lastActiveAt = nowTs;  // refresh on every meaningful tick while active
      }

      // ---- Cancel flow
      if (stateChanged && state === "canceled") {
        // Show cancel immediately
        this._alertOnce("cancel",
          `${this.config.printerName || "Printer"} Print Canceled`,
          this.lastFile ? `${this.lastFile} was canceled.` : "Print job canceled.",
          8000,
          "error"
        );

        // Guard against immediate FAILED/error chatter
        this._cancelGuardUntil = nowTs + Math.max(5000, Number(this.config.cancelGuardMs) || 20000);

        // Schedule return-to-idle
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

      // If we transitioned *away* from canceled, kill any pending cancel timer
      if (stateChanged && state !== "canceled" && this._postCancelTimer) {
        clearTimeout(this._postCancelTimer);
        this._postCancelTimer = null;
        this._cancelGuardUntil = 0;
      }

      // Activity window (uses frequently refreshed lastActiveAt)
      const recentlyActive = (Date.now() - (this.lastActiveAt || 0)) <= (this.config.doneQuietWindowMs || 120000);

      if (this.config.logOnChange && stateChanged) {
        console.log("[MMM-BambuNotify] State change:", this.lastState, "→", state);
      }

      // Suppress stale finish/error after *long* idle (reconnect noise)
      if ((state === "finish" || state === "error") && !recentlyActive) {
        return;
      }

      // --- Toast gating (start/resume) ---
      const wasPaused = (this.lastState === "paused");
      const explicitResumeNow = (stateFromAck === "running") || (gcs === "running");
      const isResume = explicitResumeNow && wasPaused;
      const justPaused = nowTs - (this.lastAlertAt.pause || 0) < 4000;

      const canStartToast =
        stateChanged &&
        (state === "preparing" || state === "running") &&
        (!wasPaused || isResume) &&
        !pausedStrict &&
        !justPaused;

      // Toasts
      const Pname = this.config.printerName || "Printer";

      if (this.config.showOnStart && canStartToast) {
        this._alertOnce("start", `${Pname} Print Started`,
          file ? `${file} started` : "Print job started",
          this.config.toastDurationMs, "start");
      }

      // Done / finish
      const reached100 = isNum(percent) && percent >= 100;
      const isFinishState = state === "finish";
      if (this.config.showOnDone && recentlyActive && (isFinishState || (this.lastState === "running" && reached100))) {
        this._alertOnce(
          "done",
          `${Pname} Print Complete`,
          `${(this.lastFile || "Job")} finished (100%).`,
          this.config.toastDurationMs,
          "done"
        );
        this.lastDoneAt = Date.now();
      }

      // Mark explicit pause toast (optional, only gating future start toast)
      if (stateChanged && state === "paused") {
        this.lastAlertAt.pause = nowTs;
        if (this.config.showOnPause) {
          this._alertOnce("pause", `${Pname} Paused`,
            this.lastFile ? `${this.lastFile} paused.` : "Print paused.",
            8000, "info");
        }
      }

      // Error toasts (skip if in cancel guard window)
      const inCancelGuard = this._cancelGuardUntil && Date.now() < this._cancelGuardUntil;
      const errText = cleanErrorText(
        msg.error, msg.message, msg.err,
        print.msg, print.err_msg, print.error_text, print.alarm_text
      );
      const becameError = (state === "error" && this.lastState !== "error");
      const newMeaningfulErr = errText && errText !== this.lastErrorText;

      if (!inCancelGuard && this.config.showOnError && recentlyActive) {
        if (becameError && !newMeaningfulErr) {
          this._alertOnce("error", `${Pname} Error`,
            `${file || "Printer"} reported an error state.`,
            this.config.toastDurationMs, "error");
        } else if (newMeaningfulErr) {
          this._alertOnce("error", `${Pname} Error`,
            errText.slice(0, 200),
            this.config.toastDurationMs, "error");
          this.lastErrorText = errText;
        }
      }

      // Immediate idle reflect
      if (stateChanged && state === "idle") {
        this._setIdleAndBroadcast(true);
        this.lastSeqStatus = -1; // allow fresh status ticks after idle
        // reset cancel epoch; we are definitely out of any cancel flow
        this._cancelEpoch += 1;
        this._cancelGuardUntil = 0;
        return;
      }

      // Progress buckets
      let bucket = null;
      if (isNum(percent)) {
        const step = Math.max(1, Number(this.config.progressStep) || 5);
        bucket = Math.floor(percent / step);
      }
      const bucketChanged = (bucket !== null && bucket !== this.lastBucket);
      const etaChanged = (isNum(etaMins) ? etaMins : null) !== (this.lastEtaMins ?? null);

      if (stateChanged || bucketChanged || etaChanged) {
        const payload = {
          remaining: etaStr || null,
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
      if (state && state !== "error") this.lastErrorText = "";
    });
  },

  _idleWatch() {
    const now = Date.now();
    const idleTimeout = Math.max(60_000, Number(this.config.idleTimeoutMs) || 180_000);
    if (!this.connected) return;

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
  },

  _setIdleAndBroadcast(showToast = false) {
    const P = this.config.printerName || "Printer";
    this.lastState = "idle";
    this.lastStateAt = Date.now();
    this.lastPercent = null;
    this.lastEtaMins = null;
    this.lastBucket = null;
    this.lastFile = "";

    if (showToast && this.config.showOnIdle) {
      this._alertOnce("idle", `${P} Idle`, "Ready for next job.", 6000, "connected");
    }
    this.sendSocketNotification("BN_PROGRESS", {
      percent: null, remaining: null, file: "", state: "idle"
    });
  },

  _alertOnce(key, title, message, timer = 8000, kind = "info") {
    const now = Date.now();
    if (now - (this.lastAlertAt[key] || 0) < this.config.debounceMs) return;
    this.lastAlertAt[key] = now;
    console.log(`[MMM-BambuNotify] ALERT → ${title}: ${message}`);
    this.sendSocketNotification("BN_ALERT", { title, message, timer, kind });
  },

  stop() {
    try { if (this._idleTicker) clearInterval(this._idleTicker); } catch {}
    try { if (this._postConnectTimer) clearTimeout(this._postConnectTimer); } catch {}
    try { if (this._postCancelTimer) clearTimeout(this._postCancelTimer); } catch {}
    try { if (this.client) this.client.end(true); } catch {}
    console.log("[MMM-BambuNotify] node_helper stopped");
  }
});
