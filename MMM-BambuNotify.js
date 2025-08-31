/* MMM-BambuNotify.js */
Module.register("MMM-BambuNotify", {
  defaults: {
    host: "192.168.86.100",
    port: 8883,
    user: "bblp",
    password: "",
    serial: "",

    printerName: "Bambu A1",

    displayProgress: true,
    showRemaining: true,
    progressPrecision: 0,
    progressStep: 5,
    hideProgressWhenIdle: true,

    toastStyle: "modal",   // "modal" | "corner"
    toastDurationMs: 60000,
    overlayOpacity: 0.5,

    showOnStart: true,
    showOnDone: true,
    showOnError: true,
    showOnPause: false, // FIXME: Not working
    showOnIdle: true,

    logRaw: false,
    logOnChange: true
  },

  start() {
    Log.info("[MMM-BambuNotify] start()");
    this.state = {
      percent: null,
      remaining: null,
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
    wrap.className = "bambu-wrap small light";

    if (!this.config.displayProgress) {
      wrap.innerText = this.config.printerName || "Bambu Printer";
      return wrap;
    }

    const name = this.config.printerName || "Printer";
    const status = (this.state.status || "connecting").toLowerCase();
    const statusLabel = this._statusNice(status);
    const statusColor = this._statusColor(status);
    const fileLabel = (this.state.file && !["offline","connecting"].includes(status))
      ? ` • ${this._shorten(this.state.file, 28)}`
      : "";

    const label = document.createElement("div");
    label.className = "bambu-label";
    label.innerHTML = `
      <span class="bambu-name">${this._esc(name)}</span>
      <span class="bambu-pill" style="border-color:${statusColor};color:${statusColor}">${this._esc(statusLabel)}</span>
      ${fileLabel ? `<span class="bambu-file">${this._esc(fileLabel)}</span>` : ""}
    `;
    wrap.appendChild(label);

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
        const etaText = (this.config.showRemaining && this.state.remaining) ? ` • ${this._esc(this.state.remaining)}` : "";
        meta.innerText = `${pct}%`; // FIXME: remaining time isn't always showing `${pct}%${etaText}`;
        wrap.appendChild(meta);
      } else if (status === "preparing" || status === "running") {
        const meta = document.createElement("div");
        meta.className = "bambu-meta";
        meta.style.opacity = ".8";
        meta.innerText = (status === "preparing") ? "Preparing…" : "Printing…";
        wrap.appendChild(meta);
      }
    }

    const style = document.createElement("style");
    style.textContent = `
      .bambu-wrap { min-width:220px; max-width:340px; }
      .bambu-label { opacity:.95; margin-bottom:8px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .bambu-name { font-weight:600; }
      .bambu-file { opacity:.85; }
      .bambu-pill {
        display:inline-flex; align-items:center; gap:6px;
        padding:1px 8px; border-radius:999px; border:2px solid currentColor;
        font-weight:700; font-size:90%;
      }
      .bambu-bar { position:relative; height:6px; border-radius:999px; background:rgba(255,255,255,.18); overflow:hidden; }
      .bambu-fill { position:absolute; inset:0 auto 0 0; width:0%; background:rgba(255,255,255,.75); }
      .bambu-meta { margin-top:6px; opacity:.9; }
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

  _statusNice(s) {
    switch (s) {
      case "running": return "Printing";
      case "preparing": return "Preparing";
      case "paused": return "Paused";
      case "finish": return "Finished";
      case "idle": return "Idle";
      case "offline": return "Offline";
      case "connecting": return "Connecting…";
      default: return s.charAt(0).toUpperCase() + s.slice(1);
    }
  },

  _statusColor(s) {
    return ({
      running: "#22c55e",     // green
      preparing: "#3b82f6",   // blue
      paused: "#f59e0b",      // amber
      finish: "#3b82f6",      // blue
      idle: "#94a3b8",        // slate
      offline: "#ef4444",     // red
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
      const t = document.createElement("div"); t.textContent = title || "Notification";
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
      const t = document.createElement("div"); t.textContent = title || "Notification";
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
