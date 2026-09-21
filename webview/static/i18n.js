const STRINGS = {
  tagline: "A door that hears the request, not the presence",
  connect: "Connect", disconnect: "Disconnect", refresh: "Refresh ports",
  sim: "Simulate", simStop: "Stop sim", sound: "Meow sound", soundLocked: "Click the page once to enable sound", theme: "Theme",
  connSerial: "Serial", connSim: "Simulation", connNone: "Offline",
  twin: "Digital twin", viewFront: "Front", viewIso: "Iso", viewRear: "Rear", autoRotate: "Auto-rotate",
  padHint: "Drag on the acrylic pad to scratch · drag elsewhere to orbit",
  peak: "Peak", gauge: "Gauge", servo: "Servo", opens: "Requests",
  opensSub: "opened today", threshold: "Threshold", wave: "Piezo · gauge",
  controls: "Controls", difficulty: "Cat personality",
  kitten: "Kitten", adult: "Adult", grumpy: "Grumpy",
  difficultyNote: "Every mode has the same target; only the decay differs. A harder cat wants faster tapping, not harder hits.",
  diffInfo: "{mode} · tap about {rate} times a second and it opens in {taps} · slower than {min}/s it never fills",
  mode: "Mode", exhibit: "Exhibit", real: "Real use",
  beamBlocked: "IR beam blocked", scratchAmp: "Scratch threshold",
  scratchAmpNote: "Above table knocks, below a real scratch.",
  tools: "Tools", testOpen: "Test servo", tapTable: "Knock the table", autoScratch: "Scratch 1 s",
  simNote: "One knock fills a pixel and drains. Only sustained scratching wins.",
  testNote: "Sends 'o' to the board: it must report 180 and the servo must move.",
  hw: "HW", resets: "board resets",
  log: "Request log", clear: "Clear", logEmpty: "No requests yet",
  footer: "SD-02 Rev E · 200 × 260 mm · SG90 · WS2812 × 8",
  state: {
    idle: "Idle", scratching: "Scratching", opening: "Opening",
    open: "Open", closing: "Closing", cooldown: "Cooldown",
  },
  diff: { kitten: "Kitten", adult: "Adult", grumpy: "Grumpy" },
  coat: "Cat coat",
  coats: { black: "Black", orange: "Orange tabby", siamese: "Siamese", mackerel: "Mackerel tabby", white: "White", calico: "Calico" },
  lines: "lines/s", noWebgl: "WebGL is not available in this browser.",
};

function t(key) {
  return key.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : null), STRINGS) ?? key;
}

function applyStrings() {
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
}
