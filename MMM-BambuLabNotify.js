/* MMM-BambuLabNotify.js */
const BN_DEFAULT_TEXT = {
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
    notification: "Notification"
  }
};

Module.register("MMM-BambuLabNotify", {
  defaults: {
    host: "192.168.86.100",
    port: 8883,
    user: "bblp",
    password: "",
    serial: "",

    printerName: "BambuLab Printer",

    displayProgress: true,
    displayTemperatures: true,
    displayAms: true,
    temperatureUnit: "C",
    textSize: "medium",
    progressPrecision: 0,
    progressStep: 1,
    hideProgressWhenIdle: true,
    hideWhileOff: false,
    hideWhileIdle: false,

    toastStyle: "modal",   // "modal" | "corner"
    toastDurationMs: 60000,
    overlayOpacity: 0.5,

    showOnStart: true,
    showOnDone: true,
    showOnError: true,
    showOnPause: true,
    showOnIdle: true,
    showOnCancel: true,

    logRaw: false,
    logOnChange: false,

    text: BN_DEFAULT_TEXT
  },

  start() {
    Log.info("[MMM-BambuLabNotify] start()");
    this.text = this._mergeText(BN_DEFAULT_TEXT, this.config.text);
    this.state = {
      percent: null,
      remaining: null,
      layers: null,
      temperatures: null,
      filaments: [],
      file: "",
      status: "connecting"
    };
    this.sendSocketNotification("BN_CONNECT", this.config);
  },

  socketNotificationReceived(n, payload) {
    if (n === "BN_ALERT") {
      const p = payload || {};
      const kind = p.kind || "info";
      const duration = this.config.toastDurationMs || 120000;
      this._showToast(kind, p.title || "", p.message || "", duration);
      return;
    }

    if (n === "BN_PROGRESS" && this.config.displayProgress) {
      const p = payload || {};
      const incomingState = typeof p.state === "string" ? p.state : (this.state.status || "connecting");

      if (typeof p.percent === "number") {
        this.state.percent = p.percent;
      } else if (["idle", "offline", "connecting"].includes(incomingState)) {
        this.state.percent = null;
      }

      if (p.remaining !== undefined) this.state.remaining = p.remaining || null;

      if (p.layers !== undefined) this.state.layers = p.layers || null;
      if (p.temperatures && this._hasTemperatures(p.temperatures)) this.state.temperatures = p.temperatures;
      if (p.filaments !== undefined) this.state.filaments = Array.isArray(p.filaments) ? p.filaments : [];

      if (typeof p.file === "string") {
        this.state.file = ["offline", "connecting"].includes(incomingState) ? "" : p.file;
      }

      this.state.status = incomingState;
      this.updateDom(0);
      return;
    }
  },

  getDom() {
    const wrap = document.createElement("div");
    wrap.className = `bambu-wrap small light bambu-text-${this._textSize()}`;

    const status = (this.state.status || "connecting").toLowerCase();

    if ((this.config.hideWhileOff && ["offline","connecting"].includes(status)) || (this.config.hideWhileIdle && status === "idle")) {
      wrap.style.display = "none";
      return wrap;
    }

    if (!this.config.displayProgress) {
      wrap.innerText = this.config.printerName || this._text("fallbackPrinterName");
      return wrap;
    }

    const name = this.config.printerName || this._text("fallbackPrinterName");
    const statusLabel = this._statusNice(status);
    const statusColor = this._statusColor(status);

    const label = document.createElement("div");
    label.className = "bambu-label";
    label.innerHTML = `
      <div class="bambu-title-row">
        <span class="bambu-name">${this._esc(name)}</span>
        <span class="bambu-pill" style="border-color:${statusColor};color:${statusColor}">${this._esc(statusLabel)}</span>
      </div>
    `;
    wrap.appendChild(label);

    if (this.state.file && !["offline","connecting","idle"].includes(status)) {
      const file = document.createElement("div");
      file.className = "bambu-file";
      file.innerText = `${this._text("panel.job")} ${this._shorten(this.state.file, 52)}`;
      wrap.appendChild(file);
    }

    const hideForStatus = ["offline","connecting"].includes(status);
    const isIdle = (status === "idle");
    const shouldShowProgress = !(hideForStatus || (this.config.hideProgressWhenIdle && isIdle));

    if (shouldShowProgress) {
      const pct = this._fmtPercent(this.state.percent, this.config.progressPrecision);
      const hasPct = (pct != null);

      if (hasPct) {
        const bar = document.createElement("div");
        bar.className = "bambu-bar";
        const fill = document.createElement("div");
        fill.className = "bambu-fill";
        fill.style.width = `${pct}%`;
        bar.appendChild(fill);
        wrap.appendChild(bar);

        const meta = document.createElement("div");
        meta.className = "bambu-meta";
        meta.setAttribute("style", "display:flex; justify-content:space-between; width:100%;");

        const leftSpan = document.createElement("span");
        leftSpan.setAttribute("style", "text-align:left;");
        leftSpan.innerText = this.state.layers ? `${this._text("panel.layers")} ${this.state.layers}` : "";

        const rightSpan = document.createElement("span");
        rightSpan.setAttribute("style", "text-align:right; padding-left: 10px;");
        const pctText = pct ? ` ${pct}% ${this._text("panel.complete")}` : "";
        const etaText = this.state.remaining ? ` • ${this._esc(this.state.remaining)} ${this._text("panel.remaining")}` : "";
        rightSpan.innerText = `${pctText}${etaText}`;

        meta.appendChild(leftSpan);
        meta.appendChild(rightSpan);
        wrap.appendChild(meta);
      } else if (status === "preparing" || status === "running") {
        const meta = document.createElement("div");
        meta.className = "bambu-meta";
        meta.style.opacity = ".8";
        meta.innerText = (status === "preparing") ? this._text("panel.preparing") : this._text("panel.printing");
        wrap.appendChild(meta);
      }
    }

    if (!hideForStatus) {
      const detailRows = [];

      if (this.config.displayTemperatures && this.state.temperatures) {
        const tempText = this._formatTemperatures(this.state.temperatures, !isIdle);
        if (tempText) detailRows.push(tempText);
      }

      if (this.config.displayAms && this.state.filaments && this.state.filaments.length) {
        detailRows.push(this._renderFilaments(this.state.filaments, !isIdle));
      }

      detailRows.forEach((row) => wrap.appendChild(row));
    }

    const style = document.createElement("style");
    style.textContent = `
      .bambu-wrap { min-width:220px; max-width:340px; color:rgba(255,255,255,.96); }
      .bambu-text-small { font-size:70%; }
      .bambu-text-large { font-size:110%; }
      .bambu-label { opacity:1; margin-bottom:4px; }
      .bambu-title-row {
        display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:center; gap:10px;
        width:100%;
      }
      .bambu-name {
        color:#fff; font-size:110%; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        justify-self:start; text-align:left;
      }
      .bambu-file {
        display:block; width:100%; max-width:100%; opacity:.94; margin-bottom:10px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left;
      }
      .bambu-pill {
        display:inline-flex; align-items:center; gap:6px;
        padding:1px 8px; border-radius:999px; border:2px solid currentColor;
        font-weight:700; font-size:90%; justify-self:end;
      }
      .bambu-bar { position:relative; height:6px; border-radius:999px; background:rgba(255,255,255,.18); overflow:hidden; }
      .bambu-fill { position:absolute; inset:0 auto 0 0; width:0%; background:#22c55e; }
      .bambu-meta { margin-top:6px; opacity:.95; }
      .bambu-detail { margin-top:7px; opacity:.95; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .bambu-temp.bambu-detail { margin-top:12px; }
      .bambu-temp { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px; }
      .bambu-temp-item {
        display:flex; align-items:center; gap:5px; min-width:0;
        padding:1px 6px; border-radius:999px; border:1px solid rgba(255,255,255,.18);
        background:rgba(255,255,255,.06); line-height:1.35;
      }
      .bambu-temp-label { opacity:.85; font-weight:700; flex:0 0 auto; }
      .bambu-temp-value { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .bambu-filaments { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px; }
      .bambu-filament {
        display:flex; align-items:center; gap:5px; min-width:0;
        padding:1px 6px; border-radius:999px; border:1px solid rgba(255,255,255,.28);
        background:rgba(255,255,255,.08); line-height:1.35;
      }
      .bambu-filament-active { border-color:rgba(255,255,255,.75); background:rgba(255,255,255,.16); }
      .bambu-filament-empty { opacity:.70; border-style:dashed; }
      .bambu-swatch {
        width:10px; height:10px; flex:0 0 10px; border-radius:50%;
        border:1px solid rgba(255,255,255,.75); box-shadow:0 0 0 1px rgba(0,0,0,.25);
      }
      .bambu-filament-active .bambu-swatch { animation:bambu-pulse 2.4s ease-in-out infinite; }
      .bambu-slot { opacity:.85; font-weight:700; flex:0 0 auto; }
      .bambu-filament-label { max-width:96px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      @keyframes bambu-pulse {
        0%, 100% { transform:scale(1); box-shadow:0 0 0 1px rgba(0,0,0,.25), 0 0 0 0 rgba(255,255,255,.42); }
        50% { transform:scale(1.22); box-shadow:0 0 0 1px rgba(0,0,0,.25), 0 0 0 5px rgba(255,255,255,0); }
      }
    `;
    wrap.appendChild(style);

    return wrap;
  },

  _fmtPercent(n, precision=0) {
    if (typeof n !== "number" || !isFinite(n)) return null;
    n = Math.min(100, Math.max(0, n));
    const p = precision > 0 ? n.toFixed(precision) : Math.round(n);
    return Number(p);
  },

  _shorten(s, max=28) {
    s = String(s || "");
    if (s.length <= max) return s;
    const half = Math.floor((max - 1) / 2);
    return s.slice(0, half) + "…" + s.slice(-half);
  },

  _esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  },

  _formatTemperatures(temps, showTargets = true) {
    const row = document.createElement("div");
    row.className = "bambu-detail bambu-temp";

    [
      [this._text("panel.nozzle"), this._formatTempPair(temps.nozzle, temps.nozzleTarget, showTargets)],
      [this._text("panel.bed"), this._formatTempPair(temps.bed, temps.bedTarget, showTargets)]
    ].forEach(([label, value]) => {
      if (!value) return;

      const item = document.createElement("span");
      item.className = "bambu-temp-item";

      const labelEl = document.createElement("span");
      labelEl.className = "bambu-temp-label";
      labelEl.innerText = label;
      item.appendChild(labelEl);

      const valueEl = document.createElement("span");
      valueEl.className = "bambu-temp-value";
      valueEl.innerText = value;
      item.appendChild(valueEl);

      row.appendChild(item);
    });

    if (!row.children.length) return null;
    return row;
  },

  _hasTemperatures(temps) {
    return !!temps && ["nozzle", "nozzleTarget", "bed", "bedTarget"].some((key) => (
      typeof temps[key] === "number" && isFinite(temps[key])
    ));
  },

  _formatTempPair(current, target, showTarget = true) {
    const currentText = this._formatTemp(current);
    const targetText = showTarget && target > 0 ? this._formatTemp(target) : "";
    if (currentText && targetText) return `${currentText}/${targetText}`;
    return currentText || targetText || "";
  },

  _formatTemp(value) {
    if (typeof value !== "number" || !isFinite(value)) return "";
    const unit = String(this.config.temperatureUnit || "C").toUpperCase();
    if (unit === "F" || unit === "FAHRENHEIT") {
      return `${Math.round((value * 9 / 5) + 32)}°F`;
    }
    return `${Math.round(value)}°C`;
  },

  _renderFilaments(filaments, pulseActive = true) {
    const row = document.createElement("div");
    row.className = "bambu-detail bambu-filaments";

    filaments.forEach((filament) => {
      const chip = document.createElement("span");
      chip.className = [
        "bambu-filament",
        filament.active && pulseActive ? "bambu-filament-active" : "",
        filament.empty ? "bambu-filament-empty" : ""
      ].filter(Boolean).join(" ");

      const swatch = document.createElement("span");
      swatch.className = "bambu-swatch";
      swatch.style.background = filament.empty ? "transparent" : (this._cssColor(filament.color) || "transparent");
      chip.appendChild(swatch);

      const slot = document.createElement("span");
      slot.className = "bambu-slot";
      const slotLabel = filament.external ? this._text("panel.external") : filament.slot;
      slot.innerText = slotLabel ? `${slotLabel}:` : "";
      chip.appendChild(slot);

      const label = document.createElement("span");
      label.className = "bambu-filament-label";
      label.innerText = filament.empty ? this._text("panel.empty") : (filament.type || filament.name || `${this._text("panel.tray")} ${filament.slot || "?"}`);
      chip.appendChild(label);

      row.appendChild(chip);
    });

    return row;
  },

  _cssColor(color) {
    if (!color) return "";
    const s = String(color).trim();
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return s.slice(0, 7);
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return `#${s.slice(0, 6)}`;
    return "";
  },

  _textSize() {
    const size = String(this.config.textSize || "medium").toLowerCase();
    return ["small", "medium", "large"].includes(size) ? size : "medium";
  },

  _mergeText(defaults, custom) {
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
  },

  _text(path) {
    const parts = path.split(".");
    let value = this.text || BN_DEFAULT_TEXT;
    for (const part of parts) {
      value = value && value[part];
    }
    return value !== undefined && value !== null && value !== "" ? String(value) : String(path);
  },

  _statusNice(s) {
    return this._text(`status.${s}`) !== `status.${s}`
      ? this._text(`status.${s}`)
      : s.charAt(0).toUpperCase() + s.slice(1);
  },

  _statusColor(s) {
    return ({
      running: "#22c55e",     // green
      preparing: "#3b82f6",   // blue
      paused: "#f59e0b",      // amber
      finish: "#3b82f6",      // blue
      idle: "#94a3b8",        // slate
      offline: "#999999",     // gray
      connecting: "#f59e0b",  // amber
      error: "#ef4444"
    }[s] || "#94a3b8");
  },

  // --- Toasts (white UI; modal or corner) ---
  _showToast(kind, title, message, timer) {
    const isModal = (this.config.toastStyle || "modal") === "modal";
    const border = this._borderColor(kind);
    const iconUrl = this._iconPath(kind);

    if (isModal) {
      document.getElementById("bn-modal-overlay")?.remove();

      const overlay = document.createElement("div");
      overlay.id = "bn-modal-overlay";
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 99998;
        background: rgba(0,0,0,${Math.min(1, Math.max(0, this.config.overlayOpacity ?? 0.5))});
        display: flex; align-items: center; justify-content: center;
      `;

      const box = document.createElement("div");
      box.className = `bn-modal bambu-${kind}`;
      box.style.cssText = `
        display: flex; align-items: center; gap: 14px;
        max-width: 70vw; min-width: 320px;
        padding: 16px 18px; border-radius: 12px;
        background: #fff; color: #0b1220; border: 3px solid ${border};
        box-shadow: 0 16px 40px rgba(0,0,0,.35);
        font-weight: 600; text-align: left;
      `;

      const icon = document.createElement("div");
      icon.style.cssText = `
        width: 56px; height: 56px; flex: 0 0 56px;
        background: url("${iconUrl}") center/contain no-repeat;
      `;

      const text = document.createElement("div");
      text.style.cssText = "display:flex; flex-direction:column; gap:6px; max-width: 56vw;";
      const t = document.createElement("div"); t.textContent = title || this._text("toast.notification");
      const m = document.createElement("div"); m.textContent = message || ""; m.style.fontWeight = "500";
      text.appendChild(t); text.appendChild(m);

      box.appendChild(icon); box.appendChild(text);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      const esc = (e) => { if (e.key === "Escape") { close(); window.removeEventListener("keydown", esc); } };
      window.addEventListener("keydown", esc);

      setTimeout(() => {
        if (overlay.isConnected) {
          overlay.style.transition = "opacity 240ms ease";
          overlay.style.opacity = "0";
          setTimeout(() => overlay.remove(), 260);
        }
      }, Math.max(2000, timer));

    } else {
      if (!this._bnToastHost) {
        this._bnToastHost = document.createElement("div");
        this._bnToastHost.id = "bn-toast-host";
        this._bnToastHost.style.cssText = `
          position:fixed; top:16px; right:16px; z-index:99999;
          display:flex; flex-direction:column; gap:10px; pointer-events:none;
        `;
        document.body.appendChild(this._bnToastHost);
      }

      const el = document.createElement("div");
      el.className = `bn-toast bambu-${kind}`;
      el.style.cssText = `
        pointer-events:auto; display:flex; align-items:center; gap:10px;
        min-width:240px; max-width:380px; padding:10px 12px; border-radius:10px;
        background:#fff; color:#0b1220; border:2px solid ${border};
        box-shadow:0 8px 24px rgba(0,0,0,0.25); font-weight:600;
      `;

      const icon = document.createElement("div");
      icon.style.cssText = `
        width:48px; height:48px; flex:0 0 48px;
        background: url("${iconUrl}") center/contain no-repeat;
      `;

      const text = document.createElement("div");
      text.style.cssText = "display:flex; flex-direction:column; gap:2px;";
      const t = document.createElement("div"); t.textContent = title || this._text("toast.notification");
      const m = document.createElement("div"); m.textContent = message || ""; m.style.fontWeight = "500";
      text.appendChild(t); text.appendChild(m);

      el.appendChild(icon); el.appendChild(text);
      this._bnToastHost.appendChild(el);

      setTimeout(() => {
        el.style.transition = "opacity 240ms ease, transform 240ms ease";
        el.style.opacity = "0";
        el.style.transform = "translateY(-6px)";
        setTimeout(() => el.remove(), 280);
      }, Math.max(2000, timer));
    }
  },

  _borderColor(kind) {
    return ({
      start: "#22c55e",
      done: "#3b82f6",
      pause: "#f59e0b",
      error: "#ef4444",
      connected: "#94a3b8",
      info: "#94a3b8"
    }[kind] || "#94a3b8");
  },

  _iconPath(kind) {
    const map = { start: "start", done: "done", pause: "pause", error: "error", connected: "connected" };
    const name = map[kind] || "connected";
    let p = this.file(`icons/${name}.svg`);  // or .png if you used PNGs
    if (!p.startsWith("/")) p = "/" + p;
    return p;
  }
});
