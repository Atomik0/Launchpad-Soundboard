/*
 * pad_studio.js - Pad Studio (firmware 1.3+)
 *
 * Modelo simple para el usuario:
 *   - FONDO: el pad tiene UN solo fondo, elegido en LUCES. Puede ser un efecto del
 *     firmware o una creacion de la app ("Mi texto" 100, "Mi dibujo" 101,
 *     "Mi pantalla" 102). Las creaciones las dibuja la app y se envian al pad.
 *   - ACTIVIDADES (pestana MI PAD): juegos y ritmos. Ocupan el pad mientras duran;
 *     al salir vuelve el fondo.
 *   - Ajustes del pad, gestos y memoria (guardar la config en el pad).
 *
 * Protocolo (app -> pad):
 *   G m       0 normal, 1 creacion de fondo (lo dibujado tapa al pad), 2 actividad (control total)
 *   F hex     cuadro completo RRGGBB por pad, en orden visual (fila por fila, izq -> der)
 *   B n       brillo 10..255          O 0/1  barra de progreso en la fila superior
 *   H 0/1     pulso al ritmo          U n    golpe de ritmo (0..255)
 *   SAVE      guardar la config en la flash del pad (responde SAVED)
 *   INFO      responde "INFO LAUNCHPAD <modelo> FW <version>"
 *
 * Usa funciones globales de app.js (state, sendSerial, currentPads, stopPad...).
 */
(function () {
  'use strict';

  const STORE_KEY = 'padstudio_v1';
  const MIN_FW = [1, 3, 0];

  // Fondos creados en la app: aparecen en LUCES junto a los efectos del firmware
  const CREATIONS = [
    { id: 100, mode: 'text', category: 'mine', name: 'Mi texto', badge: 'TEXTO', desc: 'Un mensaje o la hora en el pad' },
    { id: 101, mode: 'pixel', category: 'mine', name: 'Mi dibujo', badge: 'DIBUJO', desc: 'Dibuja y anima tus propias luces' },
    { id: 102, mode: 'mirror', category: 'mine', name: 'Mi pantalla', badge: 'PANTALLA', desc: 'El pad copia los colores de tu pantalla' }
  ];
  const ACTIVITY_NAMES = { mole: 'TOPO', simon: 'SIMON', snake: 'VIBORITA', seq: 'RITMOS' };

  // ---------------------------------------------------------------- estado --
  const S = {
    activity: null,          // null | mole | simon | snake | seq  (ocupa el pad)
    selected: 'mole',        // actividad elegida en la pestana MI PAD
    effective: 'off',        // lo que se esta dibujando: off | text | pixel | mirror | seq | game
    fw: { model: null, version: null, ok: false },
    settings: {
      brightness: 220,
      progressBar: false,
      beatSync: false,
      gestureHold: true,
      gestureDouble: false,
      fnLight: false          // luz de la tecla FN en reposo (FN sigue funcionando igual)
    },
    pixel: {},               // por tipo de grilla: { frames: [[hex...]], fps, cur }
    text: {
      value: 'HOLA', speed: 8, clock: false,
      style: 'auto',          // auto | scroll | letters
      size: 'auto',           // auto | small | large (grande solo entra en el 8x8)
      dir: 'left',            // left | right (al desplazar)
      pos: 'center',          // top | center | bottom (letra chica en el 8x8)
      colorMode: 'rainbow',   // solid | rainbow | gradient
      color: '#c3ea2b', color2: '#ff2fd0',
      bg: 'none', bgColor: '#1a0033',
      effect: 'none'          // none | pulse | blink
    },
    seq: {},                 // por tipo de grilla: { pattern, bpm, rowPad }
    game: { id: 'mole' }
  };

  let lastFrameHex = '';
  let lastFrameSent = 0;
  let lastModeSent = 0;
  let lastStatsAsk = 0;
  let lastBadFrames = 0;
  let frameTimer = null;
  let currentFrame = null;   // [[r,g,b], ...] orden visual (lo que se ve ahora en el pad)
  let creationFrame = null;  // ultimo cuadro de la creacion de fondo (para las vistas previas)

  function dims() {
    return { rows: state.gridRows || 8, cols: state.gridCols || 8, key: state.gridType || '8x8' };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      Object.assign(S.settings, d.settings || {});
      Object.assign(S.text, d.text || {});
      if (d.text && d.text.colorMode === undefined && d.text.rainbow === false) S.text.colorMode = 'solid';
      delete S.text.rainbow;
      S.pixel = d.pixel || {};
      S.seq = d.seq || {};
      if (d.selected && ACTIVITY_NAMES[d.selected]) S.selected = d.selected;
    } catch (e) { }
  }

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          settings: S.settings, text: S.text, pixel: S.pixel, seq: S.seq, selected: S.selected
        }));
      } catch (e) { }
    }, 300);
  }

  // --------------------------------------------------------------- helpers --
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);

  function hexToArr(hex) {
    const h = String(hex || '#000000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function arrToHex(c) {
    return '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  function blank(rows, cols) {
    return Array.from({ length: rows * cols }, () => [0, 0, 0]);
  }
  function scale(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

  function fwAtLeast(v, min) {
    const a = String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((a[i] || 0) > min[i]) return true;
      if ((a[i] || 0) < min[i]) return false;
    }
    return true;
  }

  function connected() { return !!(state.isConnected && state.serialPort); }

  function padColor(idx) {
    const pad = currentPads()[idx];
    if (!pad) return [0, 240, 255];
    return pad.rgb || hexToRgb(pad.color) || [195, 234, 43];
  }
  function padHasSound(pad) { return !!(pad && (pad.audioBuffer || pad.synthType)); }

  // Sonidos cortos para los juegos (solo auriculares)
  function beep(freq, dur = 0.12, type = 'square', vol = 0.12) {
    try {
      const ctx = getHeadphonesCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol * (state.masterVolume || 1), ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur + 0.02);
    } catch (e) { }
  }

  // ------------------------------------------------ que se dibuja en el pad --
  function creationMode() {
    const id = parseInt(state.idleEffect, 10);
    const c = CREATIONS.find((x) => x.id === id);
    return c ? c.mode : null;
  }

  function effectiveMode() {
    if (S.activity) return S.activity === 'seq' ? 'seq' : 'game';
    return creationMode() || 'off';
  }

  function padLayer(mode) {
    if (mode === 'seq' || mode === 'game') return 2;
    if (mode === 'off') return 0;
    return 1;
  }

  function sendMode() {
    if (!connected() || !S.fw.ok) return;
    sendSerial(`G ${padLayer(S.effective)}`);
    lastModeSent = performance.now();
    lastFrameHex = '';
  }

  function sendFrame(frame) {
    if (!connected() || !S.fw.ok || S.effective === 'off') return;
    if (state.hwModel && state.hwModel !== state.gridType) return;   // la grilla abierta no es la del pad
    const now = performance.now();
    // Reafirma el modo cada segundo: si el pad vuelve a lo normal por un corte, se recupera solo
    if (now - lastModeSent > 1000) sendMode();
    let sum = 0;
    const hex = frame.map((c) => c.map((v) => {
      const b = clamp(Math.round(v), 0, 255);
      sum += b;
      return b.toString(16).padStart(2, '0');
    }).join('')).join('');
    // Reenviar aunque no cambie (cada 400 ms) para que el pad no vuelva a lo normal
    if (hex === lastFrameHex && now - lastFrameSent < 400) return;
    // No acumular cuadros: si el USB va atrasado, se salta este (llega el siguiente)
    if (typeof _serialQueue !== 'undefined' && _serialQueue.length > 2) return;
    lastFrameHex = hex;
    lastFrameSent = now;
    // Codigo de control al final: el pad descarta cuadros danados (firmware 1.3.2+; los
    // anteriores lo ignoran). Cada 5 s se le pregunta cuantos descarto (ver la consola).
    sendSerial('F ' + hex + (sum & 255).toString(16).padStart(2, '0'));
    if (now - lastStatsAsk > 5000) { lastStatsAsk = now; sendSerial('STATS'); }
  }

  function frameLoop() {
    const { rows, cols } = dims();
    const now = performance.now();
    let frame = null;
    try {
      switch (S.effective) {
        case 'mirror': frame = Mirror.render(rows, cols); break;
        case 'pixel': frame = Pixel.render(rows, cols, now); break;
        case 'text': frame = Text.render(rows, cols, now); break;
        case 'seq': frame = Seq.render(rows, cols); break;
        case 'game': frame = Games.render(rows, cols, now); break;
      }
    } catch (e) {
      console.warn('[STUDIO] error al dibujar:', e);
    }
    if (!frame) frame = blank(rows, cols);
    currentFrame = frame;
    if (S.effective === 'text' || S.effective === 'pixel' || S.effective === 'mirror') creationFrame = frame;
    sendFrame(frame);
    if (S.effective === 'pixel') drawEditor();
  }

  // Revisa (4 veces por segundo) que se debe dibujar: asi cualquier cambio de fondo,
  // de capa o de tamano de grilla se refleja solo, sin que el usuario haga nada.
  let lastGridKey = '';
  function reconcile() {
    // Al cambiar entre 5x5 y 8x8, las opciones del texto cambian (p. ej. letra grande)
    const gk = dims().key;
    if (gk !== lastGridKey) { lastGridKey = gk; updateTextUI(); }
    const m = effectiveMode();
    if (m !== S.effective) {
      const prev = S.effective;
      if (prev === 'mirror') Mirror.stop();
      S.effective = m;
      if (m === 'mirror') Mirror.start();
      clearInterval(frameTimer);
      frameTimer = null;
      if (m !== 'off') frameTimer = setInterval(frameLoop, m === 'mirror' ? 50 : 33);
      else currentFrame = null;
      sendMode();
      updatePersonalizeUI();
      updateActivityUI();
    }
  }

  // ------------------------------------------------------------- actividades --
  function startActivity(id) {
    if (!ACTIVITY_NAMES[id]) return;
    if (S.activity === 'seq' && id !== 'seq') Seq.stop();
    S.selected = id;
    persist();
    if (id === 'seq') {
      Games.stop();
    } else {
      S.game.id = id;
      Games.start(id);
    }
    S.activity = id;
    reconcile();
    updateActivityUI();
  }

  function exitActivity() {
    if (!S.activity) return;
    Seq.stop();
    Games.stop();
    S.activity = null;
    reconcile();
    updateActivityUI();
  }

  // ------------------------------------------------------ espejo de pantalla --
  const Mirror = {
    stream: null, video: null, canvas: null, ctx: null, starting: false,
    async start() {
      if (this.stream || this.starting) return;
      this.starting = true;
      try {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          audio: false,
          video: { width: 320, height: 180, frameRate: 20 }
        });
        this.video = document.createElement('video');
        this.video.muted = true;
        this.video.srcObject = this.stream;
        await this.video.play();
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (S.effective !== 'mirror') this.stop();   // se cambio de fondo mientras arrancaba
      } catch (e) {
        console.warn('[STUDIO] no se pudo capturar la pantalla:', e);
        showToast('No se pudo capturar la pantalla', 'error');
        this.stop();
      } finally {
        this.starting = false;
      }
    },
    stop() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.video = null;
    },
    render(rows, cols) {
      if (!this.video || this.video.readyState < 2) return null;
      const sub = 6;
      const w = cols * sub, h = rows * sub;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.ctx.drawImage(this.video, 0, 0, w, h);
      const px = this.ctx.getImageData(0, 0, w, h).data;
      const out = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let R = 0, G = 0, B = 0;
          for (let y = 0; y < sub; y++) {
            for (let x = 0; x < sub; x++) {
              const i = ((r * sub + y) * w + (c * sub + x)) * 4;
              R += px[i]; G += px[i + 1]; B += px[i + 2];
            }
          }
          const n = sub * sub;
          R /= n; G /= n; B /= n;
          // Mas saturacion: los LED se ven lavados con colores de pantalla
          const avg = (R + G + B) / 3;
          const sat = 1.5;
          out.push([avg + (R - avg) * sat, avg + (G - avg) * sat, avg + (B - avg) * sat]);
        }
      }
      return out;
    }
  };

  // -------------------------------------------------------------- pixel art --
  let editingPixel = false;
  const Pixel = {
    tool: 'paint',
    color: '#ff2fd0',
    data() {
      const { rows, cols, key } = dims();
      let d = S.pixel[key];
      if (!d || !Array.isArray(d.frames) || !d.frames.length || d.frames[0].length !== rows * cols) {
        d = S.pixel[key] = { frames: [this.starter(rows, cols)], fps: 4, cur: 0 };
      }
      d.cur = clamp(d.cur || 0, 0, d.frames.length - 1);
      return d;
    },
    // Dibujo inicial (un corazon) para que no arranque vacio
    starter(rows, cols) {
      const f = Array(rows * cols).fill('#000000');
      const heart = rows >= 8
        ? ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........']
        : ['.#.#.', '#####', '#####', '.###.', '..#..'];
      heart.forEach((row, r) => row.split('').forEach((ch, c) => { if (ch === '#' && r < rows && c < cols) f[r * cols + c] = '#ff2060'; }));
      return f;
    },
    render(rows, cols, now) {
      const d = this.data();
      let idx = d.cur;
      if (d.frames.length > 1 && !editingPixel) {
        idx = Math.floor(now / (1000 / clamp(d.fps || 4, 1, 30))) % d.frames.length;
      }
      return d.frames[idx].map(hexToArr);
    },
    paint(i) {
      const d = this.data();
      const f = d.frames[d.cur];
      f[i] = this.tool === 'erase' ? '#000000' : this.color;
      persist();
      updatePixelUI();
    }
  };

  // ----------------------------------------------------------- texto y hora --
  // Fuentes proporcionales: cada glifo es una lista de filas ('#' = encendido)
  const FONT5 = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
    J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
    P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
    V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
    0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
    3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '##.'],
    ' ': ['..', '..', '..', '..', '..'], '!': ['#', '#', '#', '.', '#'], '?': ['##.', '..#', '.#.', '...', '.#.'],
    '.': ['.', '.', '.', '.', '#'], ',': ['..', '..', '..', '.#', '#.'], ':': ['.', '#', '.', '#', '.'],
    '-': ['...', '...', '###', '...', '...'], '+': ['...', '.#.', '###', '.#.', '...'], '/': ['..#', '..#', '.#.', '#..', '#..'],
    "'": ['#', '#', '.', '.', '.'], '#': ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'], '*': ['.....', '.#.#.', '..#..', '.#.#.', '.....'],
    '<3': ['.#.#.', '#####', '#####', '.###.', '..#..']
  };
  const FONT7 = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'], J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'], X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], 1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], 3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'], 5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'], 7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], 9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
    ' ': ['...', '...', '...', '...', '...', '...', '...'], '!': ['#', '#', '#', '#', '#', '.', '#'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'], '.': ['.', '.', '.', '.', '.', '.', '#'],
    ',': ['..', '..', '..', '..', '..', '.#', '#.'], ':': ['.', '.', '#', '.', '#', '.', '.'],
    '-': ['...', '...', '...', '###', '...', '...', '...'], '+': ['...', '...', '.#.', '###', '.#.', '...', '...'],
    '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'], "'": ['#', '#', '.', '.', '.', '.', '.'],
    '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'], '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
    '<3': ['.....', '.#.#.', '#####', '#####', '.###.', '..#..', '.....']
  };

  function normalizeText(t) {
    return String(t || '').toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita tildes (N con tilde -> N)
      .replace(/[¡]/g, '!').replace(/[¿]/g, '?');
  }

  // Devuelve columnas: cada columna es un array de booleanos (alto de la fuente)
  function textColumns(text, font, h) {
    const cols = [];
    const t = normalizeText(text);
    for (let i = 0; i < t.length; i++) {
      let g = null;
      if (t[i] === '<' && t[i + 1] === '3') { g = font['<3']; i++; } else g = font[t[i]] || font['?'];
      const w = g[0].length;
      for (let x = 0; x < w; x++) cols.push(Array.from({ length: h }, (_, y) => g[y][x] === '#'));
      cols.push(Array(h).fill(false));   // espacio entre letras
    }
    return cols;
  }

  function glyphTokens(text) {
    const t = normalizeText(text);
    const out = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '<' && t[i + 1] === '3') { out.push('<3'); i++; } else out.push(t[i]);
    }
    return out;
  }

  const Text = {
    cache: { key: '', cols: [] },
    currentText() {
      if (S.text.clock) {
        const d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      }
      return (S.text.value || '').trim() || ' ';
    },
    // "Automatico": en el 5x5 una letra a la vez (se lee mucho mejor), en el 8x8 desplazando
    style(cols) {
      if (S.text.style === 'scroll' || S.text.style === 'letters') return S.text.style;
      return cols <= 5 ? 'letters' : 'scroll';
    },
    // La letra grande (7 de alto) solo entra en el 8x8
    big(rows) { return rows >= 7 && S.text.size !== 'small'; },
    top(rows, fh) {
      const free = rows - fh;
      if (free <= 0) return 0;
      if (S.text.pos === 'top') return 0;
      if (S.text.pos === 'bottom') return free;
      return Math.floor(free / 2);
    },
    // i = indice de la letra/columna del texto, x = posicion horizontal en el pad (0..1)
    color(i, x, now) {
      const mode = S.text.colorMode || 'rainbow';
      if (mode === 'rainbow') return hsl(i * 40 + now * 0.06, 1, 0.5);
      const a = hexToArr(S.text.color);
      if (mode !== 'gradient') return a;
      const b = hexToArr(S.text.color2);
      return [a[0] + (b[0] - a[0]) * x, a[1] + (b[1] - a[1]) * x, a[2] + (b[2] - a[2]) * x];
    },
    // Brillo del efecto: 1 = normal, 0 = apagado
    effect(now) {
      if (S.text.effect === 'pulse') return 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * 0.006));
      if (S.text.effect === 'blink') return Math.floor(now / 450) % 2 ? 0 : 1;
      return 1;
    },
    render(rows, cols, now) {
      const big = this.big(rows);
      const font = big ? FONT7 : FONT5;
      const fh = big ? 7 : 5;
      const top = this.top(rows, fh);
      const speed = clamp(S.text.speed || 8, 1, 30);
      const txt = this.currentText();
      const bg = S.text.bg === 'color' ? hexToArr(S.text.bgColor) : [0, 0, 0];
      const out = Array.from({ length: rows * cols }, () => bg.slice());
      const k = this.effect(now);
      const xOf = (c) => (cols > 1 ? c / (cols - 1) : 0);
      const put = (r, c, col) => {
        out[r * cols + c] = [bg[0] + (col[0] - bg[0]) * k, bg[1] + (col[1] - bg[1]) * k, bg[2] + (col[2] - bg[2]) * k];
      };

      if (this.style(cols) === 'letters') {
        const tokens = glyphTokens(txt);
        const showMs = clamp(6400 / speed, 250, 3000);   // velocidad 8 -> 0,8 s por letra
        const gapMs = 140;                                // apagado corto: se distinguen letras repetidas
        const slot = showMs + gapMs;
        const cycle = tokens.length * slot + 700;         // pausa al final del mensaje
        const t = now % cycle;
        const i = Math.floor(t / slot);
        if (i >= tokens.length || t % slot >= showMs) return out;
        const g = font[tokens[i]] || font['?'];
        const w = g[0].length;
        const left = Math.floor((cols - w) / 2);
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < w; x++) {
            const c = left + x;
            if (g[y][x] === '#' && c >= 0 && c < cols) put(top + y, c, this.color(i, xOf(c), now));
          }
        }
        return out;
      }

      const key = txt + '|' + fh;
      if (this.cache.key !== key) this.cache = { key, cols: textColumns(txt, font, fh) };
      const tc = this.cache.cols;
      const L = tc.length;
      const total = L + cols;                    // entra por un lado y sale por el otro
      const pos = Math.floor(now / 1000 * speed) % Math.max(1, total);
      const toRight = S.text.dir === 'right';
      for (let c = 0; c < cols; c++) {
        const src = toRight ? (c + L - pos) : (pos + c - cols);
        if (src < 0 || src >= L) continue;
        for (let y = 0; y < fh; y++) {
          if (tc[src][y]) put(top + y, c, this.color(src / 4, xOf(c), now));
        }
      }
      return out;
    }
  };

  // ------------------------------------------------------------ secuenciador --
  const Seq = {
    playing: false, step: 0, nextTime: 0, timer: null, shownStep: -1, queue: [], voices: [],
    data() {
      const { rows, cols, key } = dims();
      let d = S.seq[key];
      if (!d || !Array.isArray(d.pattern) || d.pattern.length !== rows || d.pattern[0].length !== cols) {
        d = S.seq[key] = {
          bpm: 110,
          pattern: Array.from({ length: rows }, () => Array(cols).fill(false)),
          rowPad: this.defaultRows(rows)
        };
      }
      // Sin filas asignadas (p. ej. se creo antes de cargar sonidos): asignarlas solas
      if (!Array.isArray(d.rowPad) || d.rowPad.length !== rows || d.rowPad.every((v) => v < 0)) {
        d.rowPad = this.defaultRows(rows);
      }
      return d;
    },
    defaultRows(rows) {
      const pads = currentPads();
      const withSound = [];
      pads.forEach((p, i) => { if (padHasSound(p)) withSound.push(i); });
      return Array.from({ length: rows }, (_, r) => (r < withSound.length ? withSound[r] : -1));
    },
    stepDur() { return 60 / clamp(this.data().bpm || 110, 40, 240) / 4; },   // semicorcheas
    start() {
      if (this.playing) return;
      const ctx = getHeadphonesCtx();
      this.playing = true;
      this.step = 0;
      this.queue = [];
      this.nextTime = ctx.currentTime + 0.08;
      this.timer = setInterval(() => this.schedule(), 25);
      updateSeqUI();
    },
    stop() {
      this.playing = false;
      clearInterval(this.timer);
      this.timer = null;
      this.queue = [];
      this.shownStep = -1;
      updateSeqUI();
    },
    schedule() {
      const ctx = getHeadphonesCtx();
      const d = this.data();
      const steps = d.pattern[0].length;
      while (this.nextTime < ctx.currentTime + 0.12) {
        for (let r = 0; r < d.pattern.length; r++) {
          if (d.pattern[r][this.step]) this.playRow(r, d.rowPad[r], this.nextTime);
        }
        this.queue.push({ step: this.step, time: this.nextTime });
        this.step = (this.step + 1) % steps;
        this.nextTime += this.stepDur();
      }
    },
    playRow(r, padIdx, when) {
      const pad = currentPads()[padIdx];
      if (!pad) return;
      const hCtx = getHeadphonesCtx();
      if (!pad.audioBuffer) {
        if (pad.synthType) setTimeout(() => playSynthTone(padIdx), Math.max(0, (when - hCtx.currentTime) * 1000));
        return;
      }
      // Corta la voz anterior de la misma fila (como una caja de ritmos)
      const prev = this.voices[r];
      if (prev) prev.forEach((v) => { try { v.src.stop(v.when); } catch (e) { } });
      const offset = (typeof pad.trimStart === 'number' && pad.trimStart > 0) ? pad.trimStart : 0;
      const dur = (typeof pad.trimEnd === 'number' && pad.trimEnd > offset) ? pad.trimEnd - offset : undefined;
      const vol = (pad.volume !== undefined ? pad.volume : 1) * (state.masterVolume || 1);
      const voices = [];
      const play = (ctx, at, toMaster) => {
        const src = ctx.createBufferSource();
        src.buffer = pad.audioBuffer;
        const g = ctx.createGain();
        g.gain.value = vol;
        src.connect(g);
        if (toMaster) g.connect(getMasterAudioDestination());
        g.connect(ctx.destination);
        src.start(Math.max(at, ctx.currentTime), offset, dur);
        voices.push({ src, when: at });
      };
      try { play(hCtx, when, true); } catch (e) { }
      if (state.selectedDiscordId) {
        try {
          const dCtx = getDiscordCtx();
          play(dCtx, dCtx.currentTime + (when - hCtx.currentTime), false);
        } catch (e) { }
      }
      this.voices[r] = voices;
    },
    currentStep() {
      if (!this.playing) return -1;
      const t = getHeadphonesCtx().currentTime;
      while (this.queue.length > 1 && this.queue[1].time <= t) this.queue.shift();
      return (this.queue.length && this.queue[0].time <= t) ? this.queue[0].step : -1;
    },
    toggle(r, c) {
      const d = this.data();
      if (!d.pattern[r] || c >= d.pattern[r].length) return;
      d.pattern[r][c] = !d.pattern[r][c];
      if (d.pattern[r][c] && !this.playing && d.rowPad[r] >= 0) this.playRow(r, d.rowPad[r], getHeadphonesCtx().currentTime);
      persist();
    },
    render(rows, cols) {
      const d = this.data();
      const cur = this.currentStep();
      const out = blank(rows, cols);
      for (let r = 0; r < rows; r++) {
        const col = d.rowPad[r] >= 0 ? padColor(d.rowPad[r]) : [60, 60, 60];
        for (let c = 0; c < cols; c++) {
          const on = d.pattern[r][c];
          let px = on ? col : scale(col, d.rowPad[r] >= 0 ? 0.06 : 0.02);
          if (c === cur) px = on ? [255, 255, 255] : [px[0] + 40, px[1] + 40, px[2] + 40];
          else if (c % 4 === 0 && !on) px = [px[0] + 6, px[1] + 6, px[2] + 6];   // marca de tiempo
          out[r * cols + c] = px;
        }
      }
      return out;
    }
  };

  // ------------------------------------------------------------------ juegos --
  const Games = {
    g: null,          // juego en curso
    best: {},
    start(id) {
      const { rows, cols } = dims();
      S.game.id = id;
      persist();
      const factory = { mole: newMole, simon: newSimon, snake: newSnake }[id];
      this.g = factory ? factory(rows, cols) : null;
      updateGameUI();
    },
    stop() { this.g = null; updateGameUI(); },
    key(r, c) { if (this.g && !this.g.over) this.g.key(r, c, performance.now()); },
    render(rows, cols, now) {
      if (!this.g) return idleGameScreen(rows, cols, now);
      const f = this.g.render(rows, cols, now);
      if (this.g.over && !this.g.reported) {
        this.g.reported = true;
        const id = S.game.id;
        if (!this.best[id] || this.g.score > this.best[id]) this.best[id] = this.g.score;
        updateGameUI();
      }
      return f;
    }
  };

  function idleGameScreen(rows, cols, now) {
    const out = blank(rows, cols);
    for (let i = 0; i < rows * cols; i++) {
      const k = 0.1 + 0.08 * Math.sin(now * 0.003 + i * 0.6);
      out[i] = hsl(now * 0.05 + i * 9, 1, Math.max(0, k));
    }
    return out;
  }

  function gameOverFrame(rows, cols, now, since) {
    const t = (now - since) / 1000;
    const out = blank(rows, cols);
    const k = t < 1.2 ? (Math.floor(t * 6) % 2 ? 0.15 : 0.9) : 0.15;
    for (let i = 0; i < rows * cols; i++) out[i] = [255 * k, 20 * k, 30 * k];
    return out;
  }

  // Golpea al topo: aparecen luces, hay que tocarlas antes de que se apaguen
  function newMole(rows, cols) {
    const game = {
      score: 0, misses: 0, over: false, overAt: 0, startAt: performance.now(), length: 30000,
      moles: [], flashes: [],
      spawn(now) {
        const free = [];
        for (let i = 0; i < rows * cols; i++) if (!this.moles.some((m) => m.i === i)) free.push(i);
        const i = free[Math.floor(Math.random() * free.length)];
        const life = Math.max(450, 1300 - this.score * 30);
        this.moles.push({ i, born: now, life, hue: Math.random() * 360 });
      },
      key(r, c, now) {
        const i = r * cols + c;
        const m = this.moles.findIndex((x) => x.i === i);
        if (m >= 0) {
          this.moles.splice(m, 1);
          this.score++;
          this.flashes.push({ i, at: now, ok: true });
          beep(880 + this.score * 20, 0.08);
        } else {
          this.flashes.push({ i, at: now, ok: false });
          beep(140, 0.15, 'sawtooth');
        }
      },
      render(rows, cols, now) {
        if (this.over) return gameOverFrame(rows, cols, now, this.overAt);
        const left = this.length - (now - this.startAt);
        if (left <= 0) { this.over = true; this.overAt = now; beep(220, 0.5, 'triangle'); return gameOverFrame(rows, cols, now, now); }
        this.moles = this.moles.filter((m) => {
          if (now - m.born > m.life) { this.misses++; return false; }
          return true;
        });
        const target = this.score > 12 ? 3 : (this.score > 5 ? 2 : 1);
        while (this.moles.length < target) this.spawn(now);
        const out = blank(rows, cols);
        // ultimos 5 s: el fondo parpadea
        if (left < 5000 && Math.floor(now / 250) % 2) for (let i = 0; i < out.length; i++) out[i] = [12, 4, 0];
        this.moles.forEach((m) => {
          const k = 1 - (now - m.born) / m.life;
          out[m.i] = scale(hsl(m.hue, 1, 0.5), 0.35 + 0.65 * k);
        });
        this.flashes = this.flashes.filter((f) => now - f.at < 250);
        this.flashes.forEach((f) => { out[f.i] = f.ok ? [255, 255, 255] : [255, 0, 0]; });
        return out;
      }
    };
    return game;
  }

  // Simon dice: cuatro cuadrantes de colores, repite la secuencia
  function newSimon(rows, cols) {
    const COLORS = [[0, 230, 60], [255, 20, 20], [255, 200, 0], [0, 90, 255]];
    const TONES = [392, 330, 262, 196];
    const halfR = rows / 2, halfC = cols / 2;
    const quad = (r, c) => {
      if ((rows % 2 && r === Math.floor(halfR)) || (cols % 2 && c === Math.floor(halfC))) return -1;  // cruz central en 5x5
      return (r < halfR ? 0 : 2) + (c < halfC ? 0 : 1);
    };
    const game = {
      score: 0, over: false, overAt: 0, seq: [], input: 0, phase: 'show', phaseAt: performance.now() + 600, lit: -1, litUntil: 0,
      next() { this.seq.push(Math.floor(Math.random() * 4)); this.input = 0; this.phase = 'show'; this.phaseAt = performance.now() + 700; },
      key(r, c, now) {
        if (this.phase !== 'input') return;
        const q = quad(r, c);
        if (q < 0) return;
        this.lit = q; this.litUntil = now + 220;
        if (q === this.seq[this.input]) {
          beep(TONES[q], 0.2, 'triangle', 0.18);
          this.input++;
          if (this.input >= this.seq.length) { this.score = this.seq.length; this.phase = 'wait'; this.phaseAt = now + 500; }
        } else {
          beep(110, 0.6, 'sawtooth', 0.18);
          this.over = true; this.overAt = now;
        }
      },
      render(rows, cols, now) {
        if (this.over) return gameOverFrame(rows, cols, now, this.overAt);
        if (this.phase === 'wait' && now >= this.phaseAt) this.next();
        let active = -1;
        if (this.phase === 'show' && now >= this.phaseAt) {
          const step = 550, on = 380;
          const t = now - this.phaseAt;
          const i = Math.floor(t / step);
          if (i >= this.seq.length) { this.phase = 'input'; }
          else if (t % step < on) {
            active = this.seq[i];
            if (this._beeped !== i) { this._beeped = i; beep(TONES[active], 0.3, 'triangle', 0.18); }
          }
        }
        if (this.phase !== 'show') this._beeped = -1;
        if (now < this.litUntil) active = this.lit;
        const out = blank(rows, cols);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const q = quad(r, c);
            if (q < 0) { out[r * cols + c] = this.phase === 'input' ? [30, 30, 30] : [0, 0, 0]; continue; }
            out[r * cols + c] = scale(COLORS[q], q === active ? 1 : 0.1);
          }
        }
        return out;
      }
    };
    game.next();
    return game;
  }

  // Viborita: toca un pad para girar hacia ese lado; los bordes dan la vuelta
  function newSnake(rows, cols) {
    const mid = Math.floor(rows / 2);
    const game = {
      score: 0, over: false, overAt: 0,
      body: [{ r: mid, c: 2 }, { r: mid, c: 1 }, { r: mid, c: 0 }],
      dir: { r: 0, c: 1 }, nextDir: null, food: null, lastMove: performance.now(),
      placeFood() {
        const free = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          if (!this.body.some((b) => b.r === r && b.c === c)) free.push({ r, c });
        }
        this.food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
      },
      key(r, c) {
        const h = this.body[0];
        const dr = r - h.r, dc = c - h.c;
        if (dr === 0 && dc === 0) return;
        const d = Math.abs(dr) >= Math.abs(dc) ? { r: Math.sign(dr), c: 0 } : { r: 0, c: Math.sign(dc) };
        if (d.r === -this.dir.r && d.c === -this.dir.c) return;    // no dar media vuelta
        this.nextDir = d;
      },
      render(rows, cols, now) {
        if (this.over) return gameOverFrame(rows, cols, now, this.overAt);
        const speed = Math.max(130, 420 - this.score * 18);
        if (now - this.lastMove >= speed) {
          this.lastMove = now;
          if (this.nextDir) { this.dir = this.nextDir; this.nextDir = null; }
          const h = this.body[0];
          const n = { r: (h.r + this.dir.r + rows) % rows, c: (h.c + this.dir.c + cols) % cols };
          const eat = this.food && n.r === this.food.r && n.c === this.food.c;
          const bodyToCheck = eat ? this.body : this.body.slice(0, -1);
          if (bodyToCheck.some((b) => b.r === n.r && b.c === n.c)) {
            this.over = true; this.overAt = now; beep(110, 0.6, 'sawtooth', 0.18);
            return gameOverFrame(rows, cols, now, now);
          }
          this.body.unshift(n);
          if (eat) { this.score++; beep(660 + this.score * 30, 0.08); this.placeFood(); } else this.body.pop();
        }
        const out = blank(rows, cols);
        if (this.food) out[this.food.r * cols + this.food.c] = Math.floor(now / 200) % 2 ? [255, 30, 30] : [140, 0, 0];
        this.body.forEach((b, i) => {
          const k = 1 - i / (this.body.length + 2);
          out[b.r * cols + b.c] = i === 0 ? [200, 255, 120] : [0, 255 * k, 70 * k];
        });
        return out;
      }
    };
    game.placeFood();
    return game;
  }

  // ------------------------------------------------- deteccion de ritmo (BPM) --
  const Beat = {
    hist: [], last: 0, intervals: [], bpm: 0,
    frame(freq) {
      if (!S.settings.beatSync) return;
      let e = 0;
      const n = Math.min(6, freq.length - 1);
      for (let i = 1; i <= n; i++) e += freq[i];
      e /= n * 255;
      this.hist.push(e);
      if (this.hist.length > 45) this.hist.shift();
      const avg = this.hist.reduce((a, b) => a + b, 0) / this.hist.length;
      const now = performance.now();
      if (e > 0.18 && e > avg * 1.25 + 0.02 && now - this.last > 240) {
        if (this.last) {
          const dt = now - this.last;
          if (dt < 2000) {
            this.intervals.push(dt);
            if (this.intervals.length > 12) this.intervals.shift();
            const sorted = this.intervals.slice().sort((a, b) => a - b);
            let bpm = 60000 / sorted[Math.floor(sorted.length / 2)];
            while (bpm < 70) bpm *= 2;
            while (bpm > 180) bpm /= 2;
            this.bpm = Math.round(bpm);
          }
        }
        this.last = now;
        const strength = clamp(Math.round((0.55 + (e - avg) * 3) * 255), 120, 255);
        if (connected() && S.fw.ok) sendSerial(`U ${strength}`);
        const el = $('studio-bpm');
        if (el) el.textContent = this.bpm ? `${this.bpm} BPM` : 'ESCUCHANDO...';
      }
    }
  };

  // ---------------------------------------------------------------- gestos --
  const Gest = { lastTap: {}, pressAt: {}, holdTimer: {} };

  function makeHeldLoop(idx) {
    const pad = currentPads()[idx];
    if (!pad || !pad.isPlaying || !pad.activeNodes || !pad.audioBuffer) return;
    const nodes = pad.activeNodes;
    const offset = (typeof pad.trimStart === 'number' && pad.trimStart > 0) ? pad.trimStart : 0;
    const end = (typeof pad.trimEnd === 'number' && pad.trimEnd > offset) ? pad.trimEnd : pad.audioBuffer.duration;
    const elapsed = (performance.now() - (Gest.pressAt[idx] || performance.now())) / 1000;
    const remaining = Math.max(0.02, (end - offset) - elapsed);

    // Nueva fuente en loop que arranca justo cuando termina la actual (sin cortes)
    const swap = (ctx, oldSrc, gain) => {
      if (!oldSrc || !gain) return oldSrc;
      const src = ctx.createBufferSource();
      src.buffer = pad.audioBuffer;
      src.loop = true;
      src.loopStart = offset;
      src.loopEnd = end;
      src.connect(gain);
      oldSrc.onended = null;
      src.start(ctx.currentTime + remaining, offset);
      try { oldSrc.stop(ctx.currentTime + remaining + 0.01); } catch (e) { }
      return src;
    };
    try {
      nodes.srcH = swap(getHeadphonesCtx(), nodes.srcH, nodes.gainH);
      if (nodes.srcD) nodes.srcD = swap(getDiscordCtx(), nodes.srcD, nodes.gainD);
    } catch (e) {
      console.warn('[STUDIO] no se pudo activar el loop:', e);
      return;
    }
    if (pad.finishTimer) { clearTimeout(pad.finishTimer); pad.finishTimer = null; }
    pad._heldLoop = true;
    sendSerial(`A ${getHwLedIndex(pad.row, pad.col)} 1 0`);
    showToast('Loop activado: vuelve a tocar el pad para detenerlo', 'refresh', 2200);
  }

  function gesture(type, idx) {
    if (state.appMode === 'edit') return false;
    const pad = currentPads()[idx];
    if (!pad) return false;
    const now = performance.now();
    if (type === 'P') {
      if (pad._heldLoop && pad.isPlaying) {
        pad._heldLoop = false;
        stopPad(idx, true);
        return true;
      }
      pad._heldLoop = false;
      if (S.settings.gestureDouble && pad.isPlaying && Gest.lastTap[idx] && now - Gest.lastTap[idx] < 320) {
        Gest.lastTap[idx] = 0;
        stopPad(idx, true);
        return true;
      }
      Gest.lastTap[idx] = now;
      Gest.pressAt[idx] = now;
      clearTimeout(Gest.holdTimer[idx]);
      if (S.settings.gestureHold && (pad.mode || 'oneshot') === 'oneshot') {
        Gest.holdTimer[idx] = setTimeout(() => makeHeldLoop(idx), 650);
      }
    } else if (type === 'R') {
      clearTimeout(Gest.holdTimer[idx]);
    }
    return false;
  }

  // ----------------------------------------------------- hooks desde app.js --
  function onHardwareMessage(msg) {
    if (msg.startsWith('INFO LAUNCHPAD')) {
      const m = msg.match(/^INFO LAUNCHPAD (\S+) FW (\S+)/);
      if (m) {
        S.fw.model = m[1];
        S.fw.version = m[2];
        S.fw.ok = fwAtLeast(m[2], MIN_FW);
        updateFwUI();
        if (S.fw.ok) sendSettings();
      }
      return true;
    }
    if (msg.startsWith('STATS ')) {
      const m = msg.match(/bad_frames=(\d+)/);
      if (m) {
        const bad = parseInt(m[1], 10);
        if (bad > lastBadFrames) console.warn(`[STUDIO] El pad descarto ${bad - lastBadFrames} cuadro(s) que llegaron danados (total ${bad})`);
        lastBadFrames = bad;
      }
      return true;
    }
    if (msg === 'SAVED') {
      showToast('Listo: la configuracion quedo guardada en el pad', 'check', 3000);
      const b = $('studio-btn-save');
      if (b) b.disabled = false;
      return true;
    }

    const parts = msg.split(' ');
    const type = parts[0];
    if (type !== 'P' && type !== 'R') return false;
    const { rows, cols } = dims();
    const row = parseInt(parts[1], 10);
    const hwCol = parseInt(parts[2], 10);
    if (isNaN(row) || isNaN(hwCol) || row < 0 || row >= rows || hwCol < 0 || hwCol >= cols) return false;
    const col = (cols - 1) - hwCol;   // columna visual

    // Durante un juego o los ritmos, las teclas son el control (no suenan los pads)
    if (S.activity) {
      if (type === 'P') activityKey(row, col);
      return true;
    }
    return gesture(type, row * cols + col);
  }

  function activityKey(r, c) {
    if (S.activity === 'seq') Seq.toggle(r, c);
    else Games.key(r, c);
  }

  // Clic en la grilla de la app: durante una actividad funciona como el pad fisico
  function onScreenPad(index) {
    if (!S.activity) return false;
    const { cols } = dims();
    activityKey(Math.floor(index / cols), index % cols);
    return true;
  }

  function activityFrame() { return S.activity ? currentFrame : null; }

  function creationPixel(r, c, rows, cols) {
    if (!creationMode() || !creationFrame || creationFrame.length !== rows * cols) return [0, 0, 0];
    return creationFrame[r * cols + c] || [0, 0, 0];
  }

  function sendSettings() {
    if (!connected() || !S.fw.ok) return;
    sendSerial(`B ${S.settings.brightness}`);
    sendSerial(`O ${S.settings.progressBar ? 1 : 0}`);
    sendSerial(`H ${S.settings.beatSync ? 1 : 0}`);
    sendSerial(`N ${S.settings.fnLight ? 1 : 0}`);   // firmware 1.3.1+ (los anteriores lo ignoran)
    sendMode();
  }

  function onHardwareSync() {
    if (!connected()) return;
    sendSerial('INFO');           // el pad responde su version; con 1.3+ se envian los ajustes
    if (S.fw.ok) sendSettings();
  }

  function onDisconnect() {
    S.fw = { model: null, version: null, ok: false };
    updateFwUI();
  }

  function onAudioFrame(freq) { Beat.frame(freq); }

  function wantsSystemAudio() { return !!S.settings.beatSync; }

  // ---------------------------------------------------------------------- UI --
  function updateFwUI() {
    const tag = $('studio-fw-tag');
    if (!tag) return;
    if (!connected()) {
      tag.textContent = 'PAD DESCONECTADO';
      tag.className = 'studio-fw-tag';
    } else if (!S.fw.version) {
      tag.textContent = 'FIRMWARE ANTIGUO';
      tag.className = 'studio-fw-tag warn';
    } else {
      tag.textContent = `${(S.fw.model || '').toUpperCase()} - FW ${S.fw.version}`;
      tag.className = 'studio-fw-tag' + (S.fw.ok ? ' ok' : ' warn');
    }
    const warn = $('studio-fw-warn');
    if (warn) warn.style.display = (connected() && !S.fw.ok) ? '' : 'none';
  }

  // Caja "Personaliza tu fondo" en LUCES: aparece solo con una creacion elegida
  function updatePersonalizeUI() {
    const mode = creationMode();
    const box = $('studio-personalize');
    if (box) {
      box.style.display = mode ? '' : 'none';
      box.querySelectorAll('.studio-panel').forEach((p) => { p.style.display = p.dataset.panel === mode ? '' : 'none'; });
    }
    const title = $('studio-personalize-title');
    if (title) {
      title.textContent = { text: 'PERSONALIZA TU TEXTO', pixel: 'PERSONALIZA TU DIBUJO', mirror: 'MI PANTALLA' }[mode] || 'PERSONALIZA TU FONDO';
    }
    // Con una creacion, "como se combinan los colores" no aplica: lo dibujado va encima
    const blend = $('blend-segmented-control');
    const blendSection = blend ? blend.closest('.lights-card-section') : null;
    if (blendSection) blendSection.classList.toggle('studio-locked', !!mode);
    if (mode === 'pixel') { updatePixelUI(); drawEditor(); }
    if (mode === 'text') updateTextUI();
  }

  function updateTextUI() {
    const { rows, cols } = dims();
    const txt = $('studio-text-value');
    if (txt && document.activeElement !== txt) txt.value = S.text.value;
    const clock = $('studio-text-clock');
    if (clock) clock.checked = !!S.text.clock;
    const spd = $('studio-text-speed');
    if (spd) spd.value = S.text.speed;
    const sv = $('studio-text-speed-val');
    if (sv) sv.textContent = `${S.text.speed}`;
    [['studio-text-color', 'color'], ['studio-text-color2', 'color2'], ['studio-text-bg', 'bgColor']].forEach(([id, key]) => {
      const el = $(id);
      if (el && document.activeElement !== el) el.value = S.text[key];
    });

    // Grupos de botones: se marca el elegido
    document.querySelectorAll('#studio-personalize [data-opt]').forEach((g) => {
      g.querySelectorAll('.studio-chip').forEach((b) => b.classList.toggle('active', b.dataset.val === String(S.text[g.dataset.opt])));
    });

    // La letra grande solo entra en el 8x8
    const large = document.querySelector('#studio-personalize [data-opt="size"] [data-val="large"]');
    if (large) large.disabled = rows < 7;
    const sizeHint = $('studio-text-size-hint');
    if (sizeHint) sizeHint.textContent = rows < 7 ? 'En el 5x5 solo entra la letra chica (el pad tiene 5 de alto).' : '';

    // Mostrar solo las opciones que aplican
    const show = (sel, on) => document.querySelectorAll(`#studio-personalize ${sel}`).forEach((el) => { el.style.display = on ? '' : 'none'; });
    const big = Text.big(rows);
    show('[data-row="dir"]', Text.style(cols) === 'scroll');
    show('[data-row="pos"]', rows >= 7 && !big);
    show('[data-row="colors"]', (S.text.colorMode || 'rainbow') !== 'rainbow');
    show('#studio-text-color2', S.text.colorMode === 'gradient');
    show('[data-row="bgcolor"]', S.text.bg === 'color');
    const bgHint = $('studio-text-bg-hint');
    if (bgHint) bgHint.textContent = S.text.bg === 'color' ? 'Con fondo de color, tus botones quedan tapados mientras se ve el texto.' : '';
  }

  function updatePixelUI() {
    const d = Pixel.data();
    const lbl = $('studio-px-frame');
    if (lbl) lbl.textContent = `CUADRO ${d.cur + 1}/${d.frames.length}`;
    const fps = $('studio-px-fps');
    if (fps) fps.value = d.fps;
    const fpsVal = $('studio-px-fps-val');
    if (fpsVal) fpsVal.textContent = `${d.fps} FPS`;
    document.querySelectorAll('#studio-px-tools .studio-chip').forEach((b) => b.classList.toggle('active', b.dataset.tool === Pixel.tool));
    drawEditor();
  }

  // Editor de dibujo: muestra el cuadro que se esta editando
  function drawEditor() {
    const cv = $('studio-editor');
    if (!cv || !cv.offsetParent) return;
    const { rows, cols } = dims();
    const d = Pixel.data();
    const frame = d.frames[d.cur];
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const gap = 4;
    const cw = (W - gap * (cols + 1)) / cols;
    const ch = (H - gap * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = frame[r * cols + c] || '#000000';
        const x = gap + c * (cw + gap), y = gap + r * (ch + gap);
        ctx.fillStyle = col === '#000000' ? '#16161c' : col;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, cw, ch, 4); else ctx.rect(x, y, cw, ch);
        ctx.fill();
      }
    }
  }

  function editorCellAt(ev) {
    const cv = $('studio-editor');
    const rect = cv.getBoundingClientRect();
    const { rows, cols } = dims();
    const c = Math.floor(((ev.clientX - rect.left) / rect.width) * cols);
    const r = Math.floor(((ev.clientY - rect.top) / rect.height) * rows);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return -1;
    return r * cols + c;
  }

  function updateSeqUI() {
    const btn = $('studio-seq-play');
    if (btn) btn.textContent = Seq.playing ? 'PAUSAR' : 'REPRODUCIR';
    const box = $('studio-seq-rows');
    if (!box || S.selected !== 'seq') return;
    const d = Seq.data();
    const bpm = $('studio-seq-bpm');
    if (bpm) bpm.value = d.bpm;
    const bpmVal = $('studio-seq-bpm-val');
    if (bpmVal) bpmVal.textContent = `${d.bpm} BPM`;
    const pads = currentPads();
    const opts = ['<option value="-1">(sin sonido)</option>'];
    pads.forEach((p, i) => {
      if (padHasSound(p)) opts.push(`<option value="${i}">${i + 1}. ${escapeHtml(p.name || 'Pad ' + (i + 1))}</option>`);
    });
    box.innerHTML = d.rowPad.map((v, r) =>
      `<div class="studio-seq-row"><span class="studio-seq-dot" style="background:${arrToHex(v >= 0 ? padColor(v) : [60, 60, 60])}"></span>` +
      `<span class="studio-seq-label">FILA ${r + 1}</span>` +
      `<select class="select-input studio-seq-select" data-row="${r}">${opts.join('')}</select></div>`).join('');
    box.querySelectorAll('select').forEach((sel) => {
      sel.value = String(d.rowPad[+sel.dataset.row]);
      sel.addEventListener('change', () => {
        d.rowPad[+sel.dataset.row] = parseInt(sel.value, 10);
        persist();
        updateSeqUI();
      });
    });
  }

  function activityStatus() {
    const best = Games.best[S.game.id] || 0;
    if (S.activity === 'seq') return Seq.playing ? 'SONANDO' : 'EN PAUSA';
    const g = Games.g;
    if (!g) return '';
    if (g.over) return `FIN - ${g.score} PUNTOS (RECORD ${Math.max(best, g.score)})`;
    return `PUNTOS: ${g.score}`;
  }

  function updateActivityUI() {
    document.querySelectorAll('#studio-activity-list .studio-activity-card').forEach((b) => {
      b.classList.toggle('active', b.dataset.activity === S.selected);
      b.classList.toggle('running', b.dataset.activity === S.activity);
    });
    const help = $('studio-activity-help');
    if (help) {
      help.textContent = {
        mole: 'Toca las luces antes de que se apaguen. Tienes 30 segundos.',
        simon: 'Mira la secuencia de colores y repitela tocando los cuadrantes.',
        snake: 'Toca un pad para que la viborita gire hacia ese lado. Come las luces rojas.',
        seq: 'El pad se convierte en una caja de ritmos con tus sonidos.'
      }[S.selected] || '';
    }
    const btn = $('studio-activity-start');
    if (btn) {
      if (S.activity === S.selected) {
        const over = S.activity !== 'seq' && Games.g && Games.g.over;
        btn.textContent = over ? 'JUGAR DE NUEVO' : 'SALIR';
      } else {
        btn.textContent = 'EMPEZAR ' + ACTIVITY_NAMES[S.selected];
      }
    }
    const st = $('studio-game-status');
    if (st) {
      const best = Games.best[S.selected] || 0;
      st.textContent = (S.selected !== 'seq' && best) ? `Tu record: ${best}` : '';
    }
    const seqPanel = $('studio-seq-panel');
    if (seqPanel) seqPanel.style.display = (S.selected === 'seq') ? '' : 'none';
    if (S.selected === 'seq') updateSeqUI();

    const banner = $('studio-activity-banner');
    if (banner) banner.style.display = S.activity ? '' : 'none';
    updateBannerText();
  }
  // Los juegos llaman a esto al empezar y terminar
  const updateGameUI = updateActivityUI;

  function updateBannerText() {
    const el = $('studio-activity-text');
    if (!el || !S.activity) return;
    const status = activityStatus();
    el.textContent = `${S.activity === 'seq' ? 'RITMOS' : 'JUGANDO ' + ACTIVITY_NAMES[S.activity]} EN EL PAD` + (status ? ` - ${status}` : '');
  }

  function bindUI() {
    // Actividades
    document.querySelectorAll('#studio-activity-list .studio-activity-card').forEach((b) => b.addEventListener('click', () => {
      S.selected = b.dataset.activity;
      persist();
      updateActivityUI();
    }));
    const startBtn = $('studio-activity-start');
    if (startBtn) startBtn.addEventListener('click', () => {
      if (S.activity === S.selected) {
        if (S.activity !== 'seq' && Games.g && Games.g.over) startActivity(S.selected);
        else exitActivity();
      } else {
        startActivity(S.selected);
        if (connected() && !S.fw.ok) showToast('Para jugar en el pad necesitas el firmware 1.3 o superior', 'alert', 4000);
      }
    });
    const exitBtn = $('studio-activity-exit');
    if (exitBtn) exitBtn.addEventListener('click', exitActivity);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S.activity) exitActivity();
    });

    // Editor de dibujo
    const cv = $('studio-editor');
    if (cv) {
      let painting = false;
      const act = (ev) => { const i = editorCellAt(ev); if (i >= 0) Pixel.paint(i); };
      cv.addEventListener('mousedown', (ev) => { painting = true; editingPixel = true; act(ev); });
      cv.addEventListener('mousemove', (ev) => { if (painting) act(ev); });
      window.addEventListener('mouseup', () => { painting = false; editingPixel = false; });
    }
    const pxColor = $('studio-px-color');
    if (pxColor) pxColor.addEventListener('input', () => { Pixel.color = pxColor.value; Pixel.tool = 'paint'; updatePixelUI(); });
    document.querySelectorAll('#studio-px-tools .studio-chip').forEach((b) => b.addEventListener('click', () => {
      Pixel.tool = b.dataset.tool;
      updatePixelUI();
    }));
    const pxAction = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { fn(Pixel.data()); persist(); updatePixelUI(); }); };
    pxAction('studio-px-prev', (d) => { d.cur = (d.cur - 1 + d.frames.length) % d.frames.length; });
    pxAction('studio-px-next', (d) => { d.cur = (d.cur + 1) % d.frames.length; });
    pxAction('studio-px-add', (d) => { d.frames.splice(d.cur + 1, 0, d.frames[d.cur].slice()); d.cur++; });
    pxAction('studio-px-del', (d) => { if (d.frames.length > 1) { d.frames.splice(d.cur, 1); d.cur = Math.max(0, d.cur - 1); } });
    pxAction('studio-px-fill', (d) => { d.frames[d.cur] = d.frames[d.cur].map(() => Pixel.color); });
    pxAction('studio-px-clear', (d) => { d.frames[d.cur] = d.frames[d.cur].map(() => '#000000'); });
    pxAction('studio-px-frompads', (d) => {
      const pads = currentPads();
      d.frames[d.cur] = d.frames[d.cur].map((_, i) => (pads[i] && (padHasSound(pads[i]) || pads[i].audioPath) ? arrToHex(padColor(i)) : '#000000'));
    });
    const fps = $('studio-px-fps');
    if (fps) fps.addEventListener('input', () => { Pixel.data().fps = parseInt(fps.value, 10); persist(); updatePixelUI(); });

    // Texto
    const txt = $('studio-text-value');
    if (txt) txt.addEventListener('input', () => { S.text.value = txt.value.slice(0, 60); persist(); });
    const clock = $('studio-text-clock');
    if (clock) clock.addEventListener('change', () => { S.text.clock = clock.checked; persist(); });
    const spd = $('studio-text-speed');
    if (spd) spd.addEventListener('input', () => { S.text.speed = parseInt(spd.value, 10); persist(); updateTextUI(); });
    [['studio-text-color', 'color'], ['studio-text-color2', 'color2'], ['studio-text-bg', 'bgColor']].forEach(([id, key]) => {
      const el = $(id);
      if (el) el.addEventListener('input', () => { S.text[key] = el.value; persist(); });
    });
    // Cada grupo de botones guarda su valor en S.text[data-opt]
    document.querySelectorAll('#studio-personalize [data-opt]').forEach((g) => {
      g.querySelectorAll('.studio-chip').forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        S.text[g.dataset.opt] = b.dataset.val;
        persist();
        updateTextUI();
      }));
    });

    // Ritmos
    const sp = $('studio-seq-play');
    if (sp) sp.addEventListener('click', () => {
      if (S.activity !== 'seq') startActivity('seq');
      if (Seq.playing) Seq.stop(); else Seq.start();
      updateBannerText();
    });
    const sbpm = $('studio-seq-bpm');
    if (sbpm) sbpm.addEventListener('input', () => {
      Seq.data().bpm = parseInt(sbpm.value, 10);
      const v = $('studio-seq-bpm-val');
      if (v) v.textContent = `${Seq.data().bpm} BPM`;
      persist();
    });
    const sclear = $('studio-seq-clear');
    if (sclear) sclear.addEventListener('click', () => {
      const d = Seq.data();
      d.pattern = d.pattern.map((row) => row.map(() => false));
      persist();
    });
    const sauto = $('studio-seq-auto');
    if (sauto) sauto.addEventListener('click', () => {
      const d = Seq.data();
      d.rowPad = Seq.defaultRows(d.pattern.length);
      persist();
      updateSeqUI();
    });

    // Ajustes del pad
    const br = $('studio-brightness');
    const brVal = $('studio-brightness-val');
    let brTimer = null;
    if (br) {
      br.value = S.settings.brightness;
      if (brVal) brVal.textContent = `${Math.round(S.settings.brightness / 2.55)}%`;
      br.addEventListener('input', () => {
        S.settings.brightness = parseInt(br.value, 10);
        if (brVal) brVal.textContent = `${Math.round(S.settings.brightness / 2.55)}%`;
        persist();
        clearTimeout(brTimer);
        brTimer = setTimeout(() => { if (connected() && S.fw.ok) sendSerial(`B ${S.settings.brightness}`); }, 60);
      });
    }
    const check = (id, key, onChange) => {
      const el = $(id);
      if (!el) return;
      el.checked = !!S.settings[key];
      el.addEventListener('change', () => {
        S.settings[key] = el.checked;
        persist();
        if (onChange) onChange(el.checked);
      });
    };
    check('studio-progress', 'progressBar', (v) => { if (connected() && S.fw.ok) sendSerial(`O ${v ? 1 : 0}`); });
    check('studio-beat', 'beatSync', (v) => {
      if (connected() && S.fw.ok) sendSerial(`H ${v ? 1 : 0}`);
      const el = $('studio-bpm');
      if (el) el.textContent = v ? 'ESCUCHANDO...' : '';
      Beat.intervals = [];
      Beat.bpm = 0;
    });
    check('studio-fn-light', 'fnLight', (v) => { if (connected() && S.fw.ok) sendSerial(`N ${v ? 1 : 0}`); });
    check('studio-gesture-hold', 'gestureHold');
    check('studio-gesture-double', 'gestureDouble');

    const save = $('studio-btn-save');
    if (save) save.addEventListener('click', () => {
      if (!connected()) { showToast('Conecta el pad primero', 'alert'); return; }
      if (!S.fw.ok) { showToast('Para guardar en el pad necesitas el firmware 1.3 o superior', 'alert', 4000); return; }
      save.disabled = true;
      syncAllPadsToHardware().then(() => {
        sendSettings();
        setTimeout(() => sendSerial('SAVE'), 400);
        showToast('Guardando en el pad...', 'zap', 2000);
        setTimeout(() => { save.disabled = false; }, 5000);
      });
    });

    updateTextUI();
    updatePersonalizeUI();
    updateActivityUI();
    updateFwUI();
  }

  // Las creaciones aparecen en LUCES como un fondo mas (antes de que se arme el catalogo)
  if (typeof IDLE_EFFECTS_META !== 'undefined' && !IDLE_EFFECTS_META.some((e) => e.id === CREATIONS[0].id)) {
    IDLE_EFFECTS_META.unshift(...CREATIONS.map(({ id, category, name, badge, desc }) => ({ id, category, name, badge, desc })));
  }

  function init() {
    load();
    bindUI();
    setInterval(() => {
      reconcile();
      if (S.activity) updateBannerText();
    }, 250);
    setInterval(updateFwUI, 1000);
  }

  window.PadStudio = {
    onHardwareMessage, onHardwareSync, onDisconnect, onAudioFrame, wantsSystemAudio,
    onScreenPad, activityFrame, creationPixel,
    get activity() { return S.activity; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
