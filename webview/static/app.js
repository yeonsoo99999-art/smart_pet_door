import { DoorScene } from "./scene.js";

const $ = id => document.getElementById(id);
const NUM_LEDS = 8;
const SPAN_S = 15;

let snap = null;
let prevState = "idle";
let history = [];
let lastEvents = [];
let simOn = false;
let connected = false;
let soundOn = true;
let lineCount = 0;
let lastSynced = "";

const params = new URLSearchParams(location.search);

// ---- theme --------------------------------------------------------------

function initTheme() {
  let theme = params.get("theme");
  try { theme = theme || localStorage.getItem("theme"); } catch (_) {}
  if (!theme) theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  setTheme(theme);
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("themeBtn").innerHTML = theme === "dark" ? "&#x2600;" : "&#x263E;";
  try { localStorage.setItem("theme", theme); } catch (_) {}
  if (scene) scene.setTheme(theme === "dark");
}
$("themeBtn").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

// ---- 3D scene ---------------------------------------------------------

const scene = createScene();

function createScene() {
  const el = $("scene");
  try {
    return new DoorScene(el, peak => { if (simOn) api("POST", "/api/scratch", { peak: Math.round(peak) }); });
  } catch (err) {
    el.innerHTML = `<p class="scene-error">${t("noWebgl")}</p>`;
    const noop = () => {};
    return { update: noop, setView: noop, setAutoRotate: noop, setTheme: noop, setCoat: noop, simOn: false };
  }
}

$("viewSeg").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  $("viewSeg").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
  scene.setView(b.dataset.view);
};
function initCoat() {
  let coat = params.get("coat");
  try { coat = coat || localStorage.getItem("coat"); } catch (_) {}
  coat = coat || "black";
  $("coatSelect").value = coat;
  scene.setCoat(coat);
}
$("coatSelect").onchange = e => {
  scene.setCoat(e.target.value);
  try { localStorage.setItem("coat", e.target.value); } catch (_) {}
};

$("rotateBtn").onclick = () => {
  const on = !$("rotateBtn").classList.contains("on");
  $("rotateBtn").classList.toggle("on", on);
  scene.setAutoRotate(on);
};

// ---- render loop (2D parts) -------------------------------------------

function render() {
  requestAnimationFrame(render);
  if (!snap) return;
  const s = snap;
  scene.update(s);

  $("statPeak").textContent = s.peak;
  $("statGauge").textContent = Math.round(s.gauge);
  $("statGaugeSub").textContent = `${s.lit} / ${NUM_LEDS} · ${Math.min(100, Math.round(s.gauge / s.target * 100))}%`;
  $("statServo").textContent = `${Math.round(s.angle)}°`;
  $("statRise").textContent = `↑ ${s.rise.toFixed(1)} mm` + (s.hw_servo != null ? ` · ${t("hw")} ${s.hw_servo}°` : "");
  $("resetWarn").hidden = !s.board_resets;
  $("resetWarn").textContent = s.board_resets ? `${t("resets")} ${s.board_resets} ·` : "";
  $("statOpens").textContent = s.open_count;

  const badge = $("stateBadge");
  badge.textContent = t(`state.${s.state}`);
  badge.className = `badge ${s.state}`;

  if (s.state === "opening" && prevState !== "opening") { meow(); loadEvents(); }
  prevState = s.state;

  drawWave();
}

// ---- waveform ---------------------------------------------------------

const canvas = $("wave");
const ctx = canvas.getContext("2d");

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawWave() {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!snap || history.length < 2) return;

  const now = snap.t;
  const x = tt => w - (now - tt) / SPAN_S * w;
  const pad = 4;
  const yOf = v => h - pad - v * (h - pad * 2);

  ctx.strokeStyle = cssVar("--border");
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = h * i / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const yAmp = yOf(snap.scratch_amp / 1023);
  ctx.setLineDash([4, 4]); ctx.strokeStyle = cssVar("--orange");
  ctx.beginPath(); ctx.moveTo(0, yAmp); ctx.lineTo(w, yAmp); ctx.stroke();
  ctx.setLineDash([]);

  const trace = (pick, close) => {
    ctx.beginPath();
    let started = false;
    for (const row of history) {
      const px = x(row[0]); if (px < -2) continue;
      const py = yOf(pick(row));
      if (!started) { if (close) { ctx.moveTo(px, h); ctx.lineTo(px, py); } else ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    if (close) { ctx.lineTo(w, h); ctx.closePath(); }
  };

  const accent = cssVar("--accent");
  trace(r => r[1] / 1023, true); ctx.fillStyle = accent + "33"; ctx.fill();
  trace(r => r[1] / 1023, false); ctx.strokeStyle = accent; ctx.lineWidth = 1.4; ctx.stroke();
  trace(r => Math.min(1, r[2] / snap.target), false); ctx.strokeStyle = cssVar("--blue"); ctx.lineWidth = 1.8; ctx.stroke();
}

// ---- data -------------------------------------------------------------

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}

function connectStream() {
  const es = new EventSource("/api/stream");
  es.onmessage = e => {
    const s = JSON.parse(e.data);
    snap = s;
    lineCount++;
    history.push([s.t, s.peak, s.gauge]);
    const cutoff = s.t - SPAN_S - 1;
    while (history.length && history[0][0] < cutoff) history.shift();
    syncControls(s);
  };
  es.onerror = () => { es.close(); setTimeout(connectStream, 1500); };
}

async function loadEvents() { renderEvents(await api("GET", "/api/events")); }

function renderEvents(ev) {
  if (ev) lastEvents = ev;
  const ul = $("events");
  ul.innerHTML = "";
  $("eventsEmpty").hidden = lastEvents.length > 0;
  for (const e of lastEvents) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="time">${e.t.slice(11, 19)}</span><span class="pill">${t("diff." + e.difficulty)}</span><span class="mono small">peak ${e.peak}</span>`;
    ul.appendChild(li);
  }
}
$("clearLog").onclick = async () => { await api("DELETE", "/api/events"); loadEvents(); };

// ---- controls ---------------------------------------------------------

function syncControls(s) {
  const key = `${s.difficulty}|${s.exhibit}|${s.beam_blocked}|${s.scratch_amp}|${s.source}`;
  if (key === lastSynced) return;
  lastSynced = key;
  $("diffSeg").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.diff === s.difficulty));
  $("modeSeg").querySelectorAll("button").forEach(b => b.classList.toggle("active", (b.dataset.exhibit === "1") === s.exhibit));
  $("beamToggle").checked = s.beam_blocked;
  renderDiffInfo(s);
  if (document.activeElement !== $("ampRange")) { $("ampRange").value = s.scratch_amp; $("ampVal").textContent = s.scratch_amp; }
  simOn = s.source === "sim";
  connected = s.source === "serial";
  scene.simOn = simOn;
  refreshLabels();
}

// At twice the minimum rate every mode takes the same number of taps, so the
// difficulty a visitor feels is purely how fast they have to go.
function renderDiffInfo(s) {
  const rate = Math.round(s.min_rate * 2);
  $("diffInfo").textContent = t("diffInfo")
    .replace("{mode}", t(s.difficulty))
    .replace("{rate}", rate)
    .replace("{taps}", s.open_taps)
    .replace("{min}", s.min_rate);
}

function refreshLabels() {
  const s = snap || {};
  $("connDot").className = `dot ${s.source || ""}`;
  $("connLabel").textContent = s.source === "serial" ? `${t("connSerial")} · ${s.port}` : s.source === "sim" ? t("connSim") : t("connNone");
  $("connectBtn").textContent = connected ? t("disconnect") : t("connect");
  $("connectBtn").classList.toggle("primary", !connected);
  $("simBtn").textContent = simOn ? t("simStop") : t("sim");
  $("simBtn").classList.toggle("on", simOn);
  $("simBtn").disabled = connected;
  $("portSelect").disabled = connected;
  document.querySelectorAll(".sim-only").forEach(el => { el.hidden = !simOn; });
  $("toolsNote").textContent = simOn ? t("simNote") : t("testNote");
  $("testOpenBtn").disabled = !simOn && !connected;
  $("padHint").hidden = !simOn;
  const blocked = soundOn && (!audio || audio.state !== "running");
  $("soundBtn").classList.toggle("on", soundOn);
  $("soundBtn").classList.toggle("blocked", blocked);
  $("soundBtn").title = blocked ? t("soundLocked") : t("sound");
}

$("diffSeg").onclick = e => { const b = e.target.closest("button"); if (b) api("POST", "/api/settings", { difficulty: b.dataset.diff }); };
$("modeSeg").onclick = e => { const b = e.target.closest("button"); if (b) api("POST", "/api/settings", { exhibit: b.dataset.exhibit === "1" }); };
$("beamToggle").onchange = e => api("POST", "/api/settings", { beam_blocked: e.target.checked });
$("ampRange").oninput = e => { $("ampVal").textContent = e.target.value; };
$("ampRange").onchange = e => api("POST", "/api/settings", { scratch_amp: +e.target.value });

// ---- serial -----------------------------------------------------------

async function loadPorts() {
  const r = await api("GET", "/api/ports");
  const sel = $("portSelect");
  const cur = sel.value;
  sel.innerHTML = "";
  for (const p of r.ports) {
    const o = document.createElement("option");
    o.value = p.device; o.textContent = `${p.device} · ${p.description}`.slice(0, 48);
    sel.appendChild(o);
  }
  if (!r.ports.length) { const o = document.createElement("option"); o.textContent = "—"; o.value = ""; sel.appendChild(o); }
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  if (r.port) sel.value = r.port;
}
$("refreshPorts").onclick = loadPorts;
$("connectBtn").onclick = async () => {
  if (connected) { await api("POST", "/api/disconnect"); return; }
  const port = $("portSelect").value; if (!port) return;
  const r = await api("POST", "/api/connect", { port });
  if (!r.ok) alert(r.error);
};
$("simBtn").onclick = () => api("POST", "/api/sim", { enable: !simOn });

// ---- simulation helpers -----------------------------------------------

const sendPeak = peak => { if (simOn) api("POST", "/api/scratch", { peak: Math.round(peak) }); };
$("tapBtn").onclick = () => sendPeak(650);
$("testOpenBtn").onclick = async () => { const r = await api("POST", "/api/test_open"); if (!r.ok) alert(r.error); };
$("autoBtn").onclick = () => {
  const t0 = performance.now();
  const tick = () => {
    if (performance.now() - t0 > 1000) return;
    sendPeak(380 + Math.random() * 200);
    setTimeout(tick, 25);
  };
  tick();
};

// ---- sound ------------------------------------------------------------

// One voice per cat personality. Pitch alone carries the difficulty: the kitten
// squeaks, the adult asks, the grumpy one demands.
const MEOWS = {
  kitten: { url: "/static/sound/meow_kitten.wav", gain: 0.78 },
  adult:  { url: "/static/sound/meow_adult.wav",  gain: 0.90 },
  grumpy: { url: "/static/sound/meow_grumpy.wav", gain: 0.90 },
};
let audio = null;        // AudioContext, created lazily
let meowBufs = {};       // decoded wavs keyed by mode
let meowFailed = false;  // nothing decoded: fall back to the synth tone

function audioCtx() {
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume();
  return audio;
}

async function loadMeows() {
  const ctx = audioCtx();
  await Promise.all(Object.entries(MEOWS).map(async ([mode, m]) => {
    try {
      const r = await fetch(m.url);
      if (!r.ok) return;
      meowBufs[mode] = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch (_) {}
  }));
  meowFailed = Object.keys(meowBufs).length === 0;
}

// Browsers keep audio suspended until the page is touched. resume() is async and
// only succeeds inside a gesture, so retry on every one until the context runs.
async function unlockAudio() {
  const ctx = audioCtx();
  if (ctx.state !== "running") {
    try { await ctx.resume(); } catch (_) {}
  }
  refreshLabels();
  return ctx;
}
addEventListener("pointerdown", unlockAudio);
addEventListener("keydown", unlockAudio);

// While the browser still blocks audio the button only lifts that block, so a first
// press never mutes what the user is trying to switch on.
$("soundBtn").onclick = async () => {
  const wasBlocked = !audio || audio.state !== "running";
  await unlockAudio();
  if (wasBlocked && soundOn) { meow(); return; }
  soundOn = !soundOn;
  refreshLabels();
  if (soundOn) meow();
};

function meow() {
  if (!soundOn) return;
  try {
    const ctx = audioCtx();
    const want = snap && snap.difficulty;
    const mode = meowBufs[want] ? want : Object.keys(meowBufs)[0];
    if (mode) {
      const src = ctx.createBufferSource();
      src.buffer = meowBufs[mode];
      src.playbackRate.value = 0.97 + Math.random() * 0.06;   // never twice exactly alike
      const gain = ctx.createGain();
      gain.gain.value = MEOWS[mode].gain;
      src.connect(gain).connect(ctx.destination);
      src.start();
    } else if (meowFailed) {
      synthMeow(ctx);
    }
  } catch (_) {}
}

// Stand-in used only when the wav cannot be loaded.
function synthMeow(ctx) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator(), osc2 = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = "sawtooth"; osc2.type = "triangle";
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.linearRampToValueAtTime(880, now + 0.22);
  osc.frequency.exponentialRampToValueAtTime(420, now + 0.7);
  osc2.frequency.setValueAtTime(1040, now);
  osc2.frequency.linearRampToValueAtTime(1760, now + 0.22);
  osc2.frequency.exponentialRampToValueAtTime(840, now + 0.7);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.08);
  gain.gain.setValueAtTime(0.18, now + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2200;
  osc.connect(lp); osc2.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
  osc.start(now); osc2.start(now); osc.stop(now + 0.8); osc2.stop(now + 0.8);
}

// ---- boot -------------------------------------------------------------

setInterval(() => { $("lineRate").textContent = `${lineCount} ${t("lines")}`; lineCount = 0; }, 1000);

initTheme();
applyStrings();
initCoat();
loadMeows();
loadPorts();
api("GET", "/api/state").then(s => { snap = s; syncControls(s); });
api("GET", "/api/history").then(h => { history = h; connectStream(); });
loadEvents();
refreshLabels();
requestAnimationFrame(render);
