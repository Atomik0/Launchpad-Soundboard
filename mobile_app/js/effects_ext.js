/*
 * effects_ext.js - Efectos de luz extendidos (v1.2)
 * GENERADO desde la misma fuente que el firmware (effects.dsl.py): no editar a mano.
 * Idle 17..40, pulsacion 13..24, efectos "mientras suena" 0..8.
 * Lo usan la app de escritorio (grilla, vista previa) y la app movil.
 */
(function (global) {
  'use strict';

  const EXT_IDLE_EFFECTS_META = [
  { id: 17, category: "nature", name: "Starfield", badge: "ESTRELLAS", desc: "Cielo nocturno con estrellas titilando" },
  { id: 18, category: "nature", name: "Thunderstorm", badge: "TORMENTA", desc: "Nubes oscuras con relampagos al azar" },
  { id: 19, category: "psycho", name: "DNA Helix", badge: "ADN", desc: "Doble helice girando en 3D" },
  { id: 20, category: "retro", name: "Radar", badge: "RADAR", desc: "Barrido de radar con blancos detectados" },
  { id: 21, category: "nature", name: "Snowfall", badge: "NIEVE", desc: "Copos de nieve cayendo suavemente" },
  { id: 22, category: "nature", name: "Rain Drops", badge: "LLUVIA", desc: "Gotas cayendo sobre un lago" },
  { id: 23, category: "nature", name: "Northern Lights", badge: "BOREAL", desc: "Cortinas de aurora boreal verde y violeta" },
  { id: 24, category: "energy", name: "Magma", badge: "MAGMA", desc: "Roca fundida burbujeando" },
  { id: 25, category: "retro", name: "Checker Pulse", badge: "TABLERO", desc: "Tablero de ajedrez que alterna colores" },
  { id: 26, category: "retro", name: "KITT Scanner", badge: "SCANNER", desc: "Barrido rojo ida y vuelta estilo auto fantastico" },
  { id: 27, category: "retro", name: "Retro Snake", badge: "SNAKE", desc: "La viborita clasica recorriendo la grilla" },
  { id: 28, category: "energy", name: "Confetti", badge: "CONFETI", desc: "Destellos de colores apareciendo al azar" },
  { id: 29, category: "fluid", name: "Heartbeat", badge: "LATIDO", desc: "Latido rojo doble desde el centro" },
  { id: 30, category: "fluid", name: "Sunset", badge: "ATARDECER", desc: "Degradado de atardecer violeta, rosa y naranja" },
  { id: 31, category: "psycho", name: "Color Wheel", badge: "RUEDA", desc: "Rueda de color girando desde el centro" },
  { id: 32, category: "energy", name: "Police Lights", badge: "POLICIA", desc: "Balizas rojo y azul alternadas" },
  { id: 33, category: "energy", name: "Tesla Coil", badge: "BOBINA", desc: "Nucleo electrico con rayos ramificados" },
  { id: 34, category: "fluid", name: "Rainbow Breathing", badge: "RESPIRA", desc: "Toda la grilla respira cambiando de color" },
  { id: 35, category: "audio", name: "Spectrum Bars", badge: "ESPECTRO", desc: "Barras de frecuencia por columna" },
  { id: 36, category: "audio", name: "VU Center", badge: "VUMETRO", desc: "Vumetro circular desde el centro" },
  { id: 37, category: "audio", name: "Bass Strobe", badge: "BAJOS", desc: "Destello de toda la grilla con cada golpe de bajo" },
  { id: 38, category: "audio", name: "Spectrum Mirror", badge: "ESPEJO", desc: "Espectro reflejado desde la linea central" },
  { id: 39, category: "audio", name: "Audio Fire", badge: "LLAMAS", desc: "Llamas cuya altura sigue la musica" },
  { id: 40, category: "audio", name: "Beat Rainbow", badge: "BEAT", desc: "Arcoiris que se enciende con el volumen" }
  ];

  const EXT_PRESS_EFFECTS_META = [
  { id: 13, title: "WATER DROP", short: "GOTA", name: "Water Drop", desc: "Gota de agua con doble onda", color: "#50beff" },
  { id: 14, title: "COMETS", short: "COMETAS", name: "Comet Burst", desc: "Cuatro cometas saliendo en diagonal", color: "#ffd166" },
  { id: 15, title: "PIXELS", short: "PIXELES", name: "Pixel Explosion", desc: "Explosion de pixeles de colores", color: "#ff4fd8" },
  { id: 16, title: "SQUARE", short: "CUADRADO", name: "Square Wave", desc: "Onda cuadrada que se expande", color: "#7cff6b" },
  { id: 17, title: "IMPLOSION", short: "IMPLOSION", name: "Implosion", desc: "Anillo que colapsa hacia el pad y estalla", color: "#a78bfa" },
  { id: 18, title: "SCANLINE", short: "SCAN", name: "Scanline", desc: "Lineas horizontales que barren arriba y abajo", color: "#22d3ee" },
  { id: 19, title: "ORBIT", short: "ORBITA", name: "Orbit Trail", desc: "Punto que orbita en espiral dejando estela", color: "#f472b6" },
  { id: 20, title: "FIREWORK", short: "COHETE", name: "Firework", desc: "Cohete que sube y explota en el pad", color: "#fb923c" },
  { id: 21, title: "GLITCH", short: "GLITCH", name: "Glitch", desc: "Interferencia digital en fila y columna", color: "#00ffff" },
  { id: 22, title: "COLOR BOMB", short: "BOMBA", name: "Color Bomb", desc: "La grilla entera se tine del color del pad", color: "#facc15" },
  { id: 23, title: "ECHO", short: "ECO", name: "Pulse Echo", desc: "Tres anillos en eco que se desvanecen", color: "#34d399" },
  { id: 24, title: "MATRIX", short: "MATRIX", name: "Matrix Burst", desc: "Lluvia verde cayendo desde el pad", color: "#22c55e" }
  ];

  const PLAYING_EFFECTS_META = [
  { id: 0, name: "Destello blanco", desc: "Parpadeo blanco rapido (el de siempre)" },
  { id: 1, name: "Respiracion", desc: "El pad respira con su propio color" },
  { id: 2, name: "Arcoiris", desc: "El pad recorre todos los colores" },
  { id: 3, name: "Latido", desc: "Doble pulso como un corazon" },
  { id: 4, name: "Parpadeo de color", desc: "Prende y apaga con su color" },
  { id: 5, name: "Cuenta regresiva", desc: "Se va apagando hasta que termina el sonido" },
  { id: 6, name: "Brillo suave", desc: "Mezcla suave entre su color y blanco" },
  { id: 7, name: "Sin efecto", desc: "Mantiene el color normal mientras suena" },
  { id: 8, name: "Nivel de audio", desc: "El brillo del pad sigue el volumen del sonido" }
  ];

  const PRESS_DURATIONS = { 13: 1000, 14: 900, 15: 800, 16: 900, 17: 900, 18: 800, 19: 1100, 20: 1300, 21: 700, 22: 900, 23: 1100, 24: 1000 };
  const AUDIO_IDLE_IDS = [16, 35, 36, 37, 38, 39, 40];

  const fx_sin = Math.sin, fx_cos = Math.cos, fx_abs = Math.abs, fx_floor = Math.floor, fx_atan2 = Math.atan2;
  const fx_sqrt = (x) => Math.sqrt(x > 0 ? x : 0);
  const fx_fract = (x) => x - Math.floor(x);
  const fx_mod = (a, b) => { const m = a % b; return m < 0 ? m + b : m; };
  const fx_min = (a, b) => (a < b ? a : b);
  const fx_max = (a, b) => (a > b ? a : b);
  const fx_pow = (a, b) => Math.pow(a > 0 ? a : 0, b);
  function fx_hash_u(n) {
    n = n >>> 0;
    n ^= n >>> 16; n = Math.imul(n, 0x7feb352d) >>> 0;
    n ^= n >>> 15; n = Math.imul(n, 0x846ca68b) >>> 0;
    n ^= n >>> 16;
    return (n >>> 8) / 16777216;
  }
  const fx_hash = (x) => fx_hash_u(x | 0);
  const fx_hash2 = (a, b) => fx_hash_u(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
  const fx_byte = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const fx_rgb = (r, g, b) => [fx_byte(r), fx_byte(g), fx_byte(b)];
  function fx_hsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [fx_byte((r + m) * 255), fx_byte((g + m) * 255), fx_byte((b + m) * 255)];
  }
  function fx_hslk(h, s, l, k) {
    const c = fx_hsl(h, s, l);
    k = Math.max(0, Math.min(1, k));
    return [fx_byte(c[0] * k), fx_byte(c[1] * k), fx_byte(c[2] * k)];
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, isNaN(v) ? 0 : v));
  const fx_fx = (i) => ({ intensity: clamp01(i), rgb: null });
  const fx_fxc = (i, r, g, b) => ({ intensity: clamp01(i), rgb: [fx_byte(r), fx_byte(g), fx_byte(b)] });
  const fx_fxh = (i, h) => ({ intensity: clamp01(i), rgb: fx_hsl(h, 1, 0.55) });

  function fxIdleExt(id, r, c, rows, cols, t, vu) {
    const bands = (vu && vu.length >= 8) ? vu : (global.fxVuBands || [0, 0, 0, 0, 0, 0, 0, 0]);
    const fx_vu = (i) => { let k = i | 0; if (k < 0) k = 0; if (k > 7) k = 7; return bands[k] || 0; };
    const R8 = rows > 1 ? r * 7 / (rows - 1) : 0;
    const C8 = cols > 1 ? c * 7 / (cols - 1) : 0;
    const CR = (rows - 1) * 0.5, CC = (cols - 1) * 0.5;
    let LEVEL = 0;
    for (let i = 0; i < 8; i++) LEVEL += (bands[i] || 0);
    LEVEL *= 0.125;
    const BASS = ((bands[0] || 0) + (bands[1] || 0)) * 0.5;
    void CR; void CC;
    switch (id) {
      case 17: { // Starfield
        let ph = fx_hash2(r, c);
        let sp = 0.6 + fx_hash2(r + 17.0, c + 31.0) * 1.4;
        let tw = fx_max(0.0, fx_sin(t * sp * 3.0 + ph * 6.2832));
        let b = fx_pow(tw, 6.0);
        let warm = fx_hash2(r + 5.0, c + 9.0);
        return fx_rgb(8.0 + b * (200.0 + warm * 55.0), 10.0 + b * (210.0 + warm * 30.0), 26.0 + b * 229.0);
      }
      case 18: { // Thunderstorm
        let slot = fx_floor(t * 1.1);
        let f = fx_fract(t * 1.1);
        let strike = fx_hash(slot);
        let base = 0.4 + 0.2 * fx_sin(t * 0.7 + C8 * 0.6 + R8 * 0.3);
        let flash = 0.0;
        if (strike > 0.55) {
          let fl1 = fx_max(0.0, 1.0 - f * 9.0);
          let fl2 = (f > 0.16) ? fx_max(0.0, 1.0 - (f - 0.16) * 12.0) : 0.0;
          flash = fx_max(fl1, fl2 * 0.8);
          let boltC = fx_floor(fx_hash(slot + 7.0) * 8.0);
          let near = fx_max(0.0, 1.0 - fx_abs(C8 - boltC - fx_sin(R8 * 1.7 + slot) * 0.8) * 0.6);
          flash = flash * (0.35 + 0.65 * near);
        }
        return fx_rgb(8.0 * base + flash * 230.0, 11.0 * base + flash * 235.0, 28.0 * base + flash * 255.0);
      }
      case 19: { // DNA Helix
        let ph = t * 2.2 + R8 * 0.85;
        let amp = 2.95;
        let x1 = 3.5 + fx_sin(ph) * amp;
        let x2 = 3.5 - fx_sin(ph) * amp;
        let depth = fx_cos(ph);
        let b1 = fx_max(0.0, 1.0 - fx_abs(C8 - x1) * 0.8) * (0.55 + 0.45 * depth);
        let b2 = fx_max(0.0, 1.0 - fx_abs(C8 - x2) * 0.8) * (0.55 - 0.45 * depth);
        let rung = 0.0;
        if (fx_mod(r + fx_floor(t * 2.0), 2.0) < 1.0 && C8 > fx_min(x1, x2) && C8 < fx_max(x1, x2)) {
          rung = 0.18;
        }
        return fx_rgb(b2 * 255.0 + rung * 120.0, b1 * 230.0 + rung * 120.0, b1 * 255.0 + b2 * 200.0 + rung * 160.0);
      }
      case 20: { // Radar
        let dx = C8 - 3.5;
        let dy = R8 - 3.5;
        let ang = fx_atan2(dy, dx);
        let sweep = fx_mod(t * 2.4, 6.2832);
        let diff = fx_mod(sweep - ang, 6.2832);
        let trail = fx_max(0.0, 1.0 - diff / 2.2);
        let blip = 0.0;
        let bh = fx_hash2(r * 3.0 + fx_floor(t * 0.25), c * 7.0);
        if (bh > 0.92) {
          blip = 0.3 + 0.7 * fx_max(0.0, 1.0 - diff / 4.0);
        }
        let g = trail * trail;
        return fx_rgb(blip * 255.0, 20.0 + g * 235.0 + blip * 80.0, 8.0 + g * 60.0 + blip * 40.0);
      }
      case 21: { // Snowfall
        let sp = 0.9 + fx_hash(c * 13.0) * 0.9;
        let off = fx_hash(c * 29.0 + 3.0) * 20.0;
        let wrap = rows + 2.5;
        let p1 = fx_mod(t * sp * 1.6 + off, wrap) - 1.0;
        let p2 = fx_mod(t * sp * 1.6 + off + wrap * 0.5, wrap) - 1.0;
        let d = fx_min(fx_abs(r - p1), fx_abs(r - p2));
        let b = fx_max(0.0, 1.0 - d * 1.4);
        let ground = (r == rows - 1.0) ? 0.18 : 0.0;
        return fx_rgb(10.0 + b * 220.0 + ground * 200.0, 14.0 + b * 225.0 + ground * 210.0, 30.0 + b * 225.0 + ground * 225.0);
      }
      case 22: { // Rain Drops
        let best = 0.0;
        for (let k = 0.0; k < 3.0; k = k + 1.0) {
          let ph = t / 1.6 + k * 0.333;
          let slot = fx_floor(ph);
          let f = fx_fract(ph);
          let cx = fx_floor(fx_hash(slot * 3.0 + k * 101.0) * 8.0);
          let cy = fx_floor(fx_hash(slot * 5.0 + k * 57.0 + 11.0) * 8.0);
          let d = fx_sqrt((R8 - cy) * (R8 - cy) + (C8 - cx) * (C8 - cx));
          let ring = f * 5.5;
          let w = fx_max(0.0, 1.0 - fx_abs(d - ring) * 0.9) * (1.0 - f);
          best = fx_max(best, w);
        }
        return fx_rgb(4.0 + best * 90.0, 20.0 + best * 170.0, 50.0 + best * 205.0);
      }
      case 23: { // Northern Lights
        let band = fx_sin(C8 * 0.55 + t * 0.6) + 0.6 * fx_sin(C8 * 1.27 - t * 0.9 + 1.3);
        let top = 1.0 - R8 / 7.0;
        let curtain = fx_max(0.0, 1.0 - fx_abs(top - (0.55 + band * 0.22)) * 2.6);
        let shimmer = 0.75 + 0.25 * fx_sin(t * 3.1 + C8 * 1.7 + R8 * 0.4);
        let hue = 120.0 + band * 40.0 + top * 80.0;
        return fx_hslk(hue, 1.0, 0.5, curtain * shimmer);
      }
      case 24: { // Magma
        let dc = fx_sqrt((R8 - 3.5) * (R8 - 3.5) + (C8 - 3.5) * (C8 - 3.5));
        let v = fx_sin(C8 * 0.7 + t * 0.8) + fx_sin(R8 * 0.9 - t * 0.6) + fx_sin((R8 + C8) * 0.45 + t * 1.1) + fx_sin(dc * 1.3 - t * 1.4);
        let n = (v + 4.0) / 8.0;
        let heat = fx_pow(fx_max(0.0, n), 1.6);
        return fx_rgb(60.0 + heat * 195.0, heat * heat * 170.0, heat * heat * heat * 40.0);
      }
      case 25: { // Checker Pulse
        let chk = fx_mod(r + c + fx_floor(t * 1.5), 2.0);
        let hue = fx_mod(t * 40.0, 360.0) + chk * 180.0;
        let br = 0.35 + 0.15 * fx_sin(t * 4.712);
        return fx_hsl(hue, 1.0, 0.06 + chk * br);
      }
      case 26: { // KITT Scanner
        let pos = (fx_sin(t * 2.6) * 0.5 + 0.5) * 7.0;
        let d = C8 - pos;
        let dir = fx_cos(t * 2.6);
        let trail = (d * dir < 0.0) ? fx_max(0.0, 1.0 - fx_abs(d) / 3.2) : fx_max(0.0, 1.0 - fx_abs(d) / 0.9);
        let rowMask = (fx_abs(R8 - 3.5) < 1.2) ? 1.0 : 0.22;
        let b = fx_pow(trail, 1.5) * rowMask;
        return fx_rgb(18.0 + b * 237.0, b * 30.0, b * 12.0);
      }
      case 27: { // Retro Snake
        let n = rows * cols;
        let idx = (fx_mod(r, 2.0) < 1.0) ? (r * cols + c) : (r * cols + (cols - 1.0 - c));
        let step = fx_floor(t * 9.0);
        let head = fx_mod(step, n);
        let behind = fx_mod(head - idx + n, n);
        let len = (cols == 5.0) ? 5.0 : 9.0;
        let food = fx_floor(fx_hash(fx_floor(step / n)) * n);
        if (behind < len) {
          let k = 1.0 - behind / len;
          return fx_hsl(fx_mod(100.0 + behind * 12.0, 360.0), 1.0, 0.18 + 0.4 * k);
        }
        if (idx == food) {
          let blink = (fx_fract(t * 3.0) < 0.5) ? 1.0 : 0.5;
          return fx_rgb(255.0 * blink, 40.0 * blink, 60.0 * blink);
        }
        return fx_rgb(3.0, 6.0, 10.0);
      }
      case 28: { // Confetti
        let off = fx_hash2(r, c) * 3.0;
        let slot = fx_floor(t * 3.0 + off);
        let f = fx_fract(t * 3.0 + off);
        let on = fx_hash2(r * 31.0 + slot, c * 17.0);
        if (on > 0.72) {
          let hue = fx_hash2(slot, r * 8.0 + c) * 360.0;
          return fx_hslk(hue, 1.0, 0.5, 1.0 - f);
        }
        return fx_rgb(4.0, 4.0, 8.0);
      }
      case 29: { // Heartbeat
        let ph = fx_mod(t, 1.1) / 1.1;
        let p1 = fx_max(0.0, 1.0 - fx_abs(ph - 0.08) / 0.07);
        let p2 = fx_max(0.0, 1.0 - fx_abs(ph - 0.30) / 0.09) * 0.75;
        let beat = fx_max(p1, p2);
        let d = fx_sqrt((R8 - 3.5) * (R8 - 3.5) + (C8 - 3.5) * (C8 - 3.5));
        let spread = fx_max(0.0, 1.0 - d / (1.5 + beat * 3.5));
        let b = 0.08 + beat * spread * 0.92;
        return fx_rgb(255.0 * b, 20.0 * b, 50.0 * b);
      }
      case 30: { // Sunset
        let y = R8 / 7.0 + 0.12 * fx_sin(C8 * 0.6 + t * 0.5);
        let shift = fx_sin(t * 0.15) * 0.15;
        let h = 270.0 + (y + shift) * 130.0;
        let l = 0.30 + y * 0.25;
        return fx_hsl(fx_mod(h, 360.0), 1.0, l);
      }
      case 31: { // Color Wheel
        let ang = fx_atan2(R8 - 3.5, C8 - 3.5);
        let d = fx_sqrt((R8 - 3.5) * (R8 - 3.5) + (C8 - 3.5) * (C8 - 3.5));
        let hue = fx_mod(ang * 57.2958 + t * 90.0 + 360.0, 360.0);
        return fx_hsl(hue, 1.0, fx_min(0.55, 0.15 + d * 0.09));
      }
      case 32: { // Police Lights
        let seg = fx_mod(t * 2.0, 2.0);
        let strobe = (fx_fract(t * 12.0) < 0.5) ? 1.0 : 0.0;
        let redOn = (seg < 1.0 && C8 < 3.5) ? strobe : 0.0;
        let blueOn = (seg >= 1.0 && C8 >= 3.5) ? strobe : 0.0;
        return fx_rgb(10.0 + redOn * 245.0, 4.0, 10.0 + blueOn * 245.0);
      }
      case 33: { // Tesla Coil
        let dx = C8 - 3.5;
        let dy = R8 - 3.5;
        let d = fx_sqrt(dx * dx + dy * dy);
        let ang = fx_atan2(dy, dx);
        let core = fx_max(0.0, 1.0 - d / 1.4);
        let arm = 0.0;
        for (let k = 0.0; k < 4.0; k = k + 1.0) {
          let a0 = fx_hash(fx_floor(t * 8.0) + k * 13.0) * 6.2832;
          let da = fx_abs(fx_mod(ang - a0 + 3.1416, 6.2832) - 3.1416);
          let wig = da * d;
          arm = fx_max(arm, fx_max(0.0, 1.0 - wig * 1.4) * fx_max(0.0, 1.0 - d / 5.5));
        }
        let b = fx_max(core, arm);
        return fx_rgb(150.0 * b + core * 105.0, 120.0 * b + core * 135.0, 255.0 * b);
      }
      case 34: { // Rainbow Breathing
        let hue = fx_mod(t * 25.0, 360.0) + (R8 + C8) * 4.0;
        let l = 0.08 + 0.42 * (fx_sin(t * 1.8) * 0.5 + 0.5);
        return fx_hsl(hue, 1.0, l);
      }
      case 35: { // Spectrum Bars
        let lv = fx_vu(fx_floor(c * 8.0 / cols));
        let h = lv * rows;
        let fromBottom = rows - 1.0 - r;
        if (fromBottom < h) {
          let ratio = fromBottom / (rows - 1.0);
          return fx_hsl(120.0 - ratio * 120.0, 1.0, 0.5);
        }
        return fx_rgb(4.0, 6.0, 10.0);
      }
      case 36: { // VU Center
        let d = fx_sqrt((R8 - 3.5) * (R8 - 3.5) + (C8 - 3.5) * (C8 - 3.5)) / 5.0;
        if (d < LEVEL * 1.05) {
          return fx_hsl(120.0 - d * 130.0, 1.0, 0.5);
        }
        return fx_rgb(3.0, 4.0, 8.0);
      }
      case 37: { // Bass Strobe
        let b = fx_pow(BASS, 2.2);
        return fx_hslk(fx_mod(t * 60.0, 360.0), 1.0, 0.5, 0.04 + b * 0.96);
      }
      case 38: { // Spectrum Mirror
        let lv = fx_vu(fx_floor(c * 8.0 / cols));
        let half = (rows - 1.0) * 0.5;
        let d = fx_abs(r - half);
        if (d <= lv * (half + 0.5)) {
          return fx_hsl(190.0 + d / half * 130.0, 1.0, 0.55 - d / half * 0.15);
        }
        return fx_rgb(3.0, 3.0, 8.0);
      }
      case 39: { // Audio Fire
        let lv = fx_vu(fx_floor(c * 8.0 / cols));
        let flick = 0.15 * fx_sin(t * 9.0 + c * 2.1);
        let h = (lv + flick) * rows;
        let fromBottom = rows - 1.0 - r;
        if (fromBottom < h) {
          let k = fromBottom / fx_max(1.0, h);
          if (k > 0.75) {
            return fx_rgb(255.0, 230.0, 80.0);
          }
          if (k > 0.45) {
            return fx_rgb(255.0, 120.0, 0.0);
          }
          return fx_rgb(220.0, 30.0, 0.0);
        }
        return fx_rgb(15.0, 2.0, 0.0);
      }
      case 40: { // Beat Rainbow
        let hue = fx_mod(t * 70.0 + (R8 + C8) * 22.0, 360.0);
        return fx_hsl(hue, 1.0, 0.05 + LEVEL * 0.5);
      }
      default: return null;
    }
    return [0, 0, 0];
  }

  // Devuelve {intensity, color} con la misma forma que usa la app; null si el id no es extendido.
  function fxPressRaw(id, T, DR, DC, DIST, SEED, ER, EC, r, c, rows, cols) {
    const KS = (cols === 5) ? 0.65 : 1.0;
    void EC;
    switch (id) {
      case 13: { // Water Drop
        let core = (DIST < 0.7 && T < 0.25) ? (1.0 - T / 0.25) : 0.0;
        let r1 = T * 7.0 * KS;
        let r2 = fx_max(0.0, (T - 0.3) * 7.0 * KS);
        let w1 = fx_max(0.0, 1.0 - fx_abs(DIST - r1) / 1.1) * (1.0 - T);
        let w2 = fx_max(0.0, 1.0 - fx_abs(DIST - r2) / 1.1) * (1.0 - T) * 0.6;
        return fx_fxc(fx_max(core, fx_max(w1, w2)), 80.0, 190.0, 255.0);
      }
      case 14: { // Comet Burst
        let best = 0.0;
        for (let k = 0.0; k < 4.0; k = k + 1.0) {
          let a = 0.7854 + k * 1.5708 + SEED * 0.6;
          let along = DC * fx_cos(a) + DR * fx_sin(a);
          let perp = fx_abs(DR * fx_cos(a) - DC * fx_sin(a));
          let behind = T * 9.0 * KS - along;
          if (perp < 0.7 && behind >= -0.5 && behind < 3.0) {
            best = fx_max(best, (1.0 - behind / 3.0) * (1.0 - perp / 0.7) * (1.0 - T * 0.6));
          }
        }
        return fx_fx(best);
      }
      case 15: { // Pixel Explosion
        let slot = fx_floor(T * 10.0);
        let h = fx_hash2(r * 13.0 + slot * 7.0 + fx_floor(SEED * 1000.0), c * 29.0);
        let reach = T * 6.0 * KS + 0.6;
        if (DIST < reach && h > 0.55) {
          return fx_fxh((1.0 - T) * (1.0 - DIST / (reach + 0.01) * 0.5), fx_hash2(r + slot, c + 99.0) * 360.0);
        }
        return fx_fx(0.0);
      }
      case 16: { // Square Wave
        let cheb = fx_max(fx_abs(DR), fx_abs(DC));
        let d = fx_abs(cheb - T * 8.0 * KS);
        if (d < 1.0) {
          return fx_fx((1.0 - d) * (1.0 - T * 0.9));
        }
        return fx_fx(0.0);
      }
      case 17: { // Implosion
        if (T < 0.75) {
          let rr = (1.0 - T / 0.75) * 8.0 * KS;
          let d = fx_abs(DIST - rr);
          if (d < 1.2) {
            return fx_fx((1.0 - d / 1.2) * (0.4 + T));
          }
          return fx_fx(0.0);
        }
        if (DIST < 1.6) {
          return fx_fxc(1.0 - (T - 0.75) / 0.25, 255.0, 255.0, 255.0);
        }
        return fx_fx(0.0);
      }
      case 18: { // Scanline
        let pos = T * 8.0 * KS;
        let d = fx_min(fx_abs(DR - pos), fx_abs(DR + pos));
        return fx_fx(fx_max(0.0, 1.0 - d / 0.9) * (1.0 - T));
      }
      case 19: { // Orbit Trail
        let best = 0.0;
        for (let k = 0.0; k < 6.0; k = k + 1.0) {
          let tk = T - k * 0.035;
          if (tk > 0.0) {
            let a = tk * 12.566 + SEED * 6.2832;
            let rad = tk * 5.5 * KS;
            let px = fx_cos(a) * rad;
            let py = fx_sin(a) * rad;
            let d = fx_sqrt((DC - px) * (DC - px) + (DR - py) * (DR - py));
            best = fx_max(best, fx_max(0.0, 1.0 - d / 0.85) * (1.0 - k / 6.0));
          }
        }
        return fx_fxh(best * (1.0 - T * 0.5), fx_mod(T * 360.0 + SEED * 360.0, 360.0));
      }
      case 20: { // Firework
        if (T < 0.35) {
          let startR = rows - 1.0;
          let curR = startR + (ER - startR) * (T / 0.35);
          if (fx_abs(DC) < 0.5 && r >= curR - 0.5 && r <= startR + 0.5) {
            return fx_fxc(fx_max(0.0, 1.0 - fx_abs(r - curR) / 2.0), 255.0, 200.0, 120.0);
          }
          return fx_fx(0.0);
        }
        let u = (T - 0.35) / 0.65;
        let d2 = fx_abs(DIST - u * 6.0 * KS);
        if (d2 < 1.0) {
          let ang = fx_atan2(DR, DC);
          let spark = (fx_sin(ang * 8.0 + SEED * 20.0) > 0.2) ? 1.0 : 0.35;
          return fx_fxh((1.0 - d2) * (1.0 - u) * spark, fx_mod(SEED * 360.0 + ang * 30.0 + 360.0, 360.0));
        }
        return fx_fx(0.0);
      }
      case 21: { // Glitch
        let slot = fx_floor(T * 14.0);
        let inLine = (fx_abs(DR) < 0.5 || fx_abs(DC) < 0.5) ? 1.0 : 0.3;
        let h = fx_hash2(r * 7.0 + slot * 131.0 + fx_floor(SEED * 500.0), c * 3.0 + slot);
        if (h > 0.6 && DIST < 7.0 * KS) {
          let k = fx_hash2(slot, r + c * 8.0);
          let i = inLine * (1.0 - T);
          if (k < 0.33) {
            return fx_fxc(i, 0.0, 255.0, 255.0);
          }
          if (k < 0.66) {
            return fx_fxc(i, 255.0, 0.0, 200.0);
          }
          return fx_fxc(i, 255.0, 255.0, 255.0);
        }
        return fx_fx(0.0);
      }
      case 22: { // Color Bomb
        let local = T - DIST / (10.0 * KS) * 0.5;
        if (local < 0.0) {
          return fx_fx(0.0);
        }
        return fx_fx(fx_max(0.0, 1.0 - local * 1.6) * 0.9);
      }
      case 23: { // Pulse Echo
        let best = 0.0;
        for (let k = 0.0; k < 3.0; k = k + 1.0) {
          let tk = T - k * 0.2;
          if (tk > 0.0) {
            let d = fx_abs(DIST - tk * 8.0 * KS);
            if (d < 0.9) {
              best = fx_max(best, (1.0 - d / 0.9) * (1.0 - tk) * (1.0 - k * 0.25));
            }
          }
        }
        return fx_fx(best);
      }
      case 24: { // Matrix Burst
        if (fx_abs(DC) > 2.5 * KS + 0.5) {
          return fx_fx(0.0);
        }
        let sp = 0.6 + fx_hash(c * 7.0 + fx_floor(SEED * 100.0)) * 0.8;
        let head = ER - 0.5 + T * sp * 9.0 * KS;
        let behind = head - r;
        if (behind >= 0.0 && behind < 3.0 && r >= ER - 0.5) {
          let hot = (behind < 0.8) ? 200.0 : 0.0;
          return fx_fxc((1.0 - behind / 3.0) * (1.0 - T * 0.5), hot, 255.0, hot + 60.0);
        }
        return fx_fx(0.0);
      }
      default: return null;
    }
    return fx_fx(0);
  }

  function computePressEffectExt(eff, r, c, rows, cols, t, dr, dc, dist) {
    if (!eff || eff.id < 13) return null;
    const res = fxPressRaw(eff.id, t, dr, dc, dist, (eff.seed !== undefined ? eff.seed : 0.5),
      eff.r, eff.c, r, c, rows, cols);
    if (!res) return null;
    const color = res.rgb ? `rgb(${res.rgb[0]}, ${res.rgb[1]}, ${res.rgb[2]})` : eff.color;
    return { intensity: res.intensity, color };
  }

  function pressEffectDuration(id, fallback) {
    return PRESS_DURATIONS[id] || fallback || 900;
  }

  function fxIsAudioIdle(id) { return AUDIO_IDLE_IDS.indexOf(Number(id)) !== -1; }

  // Agrega las opciones nuevas a los <select> de efecto por pad / aplicar a todos.
  function fxPopulatePressSelects() {
    ['select-pad-press-effect', 'select-batch-press-effect'].forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel || sel.dataset.fxExtended) return;
      EXT_PRESS_EFFECTS_META.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = String(m.id);
        opt.textContent = `${m.name} (${m.desc})`;
        sel.appendChild(opt);
      });
      sel.dataset.fxExtended = '1';
    });
    const playSel = document.getElementById('select-playing-effect');
    if (playSel && !playSel.dataset.fxExtended) {
      PLAYING_EFFECTS_META.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = String(m.id);
        opt.textContent = `${m.name} - ${m.desc}`;
        playSel.appendChild(opt);
      });
      playSel.dataset.fxExtended = '1';
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fxPopulatePressSelects);
    else fxPopulatePressSelects();
  }

  global.fxVuBands = global.fxVuBands || [0, 0, 0, 0, 0, 0, 0, 0];
  global.EXT_IDLE_EFFECTS_META = EXT_IDLE_EFFECTS_META;
  global.EXT_PRESS_EFFECTS_META = EXT_PRESS_EFFECTS_META;
  global.PLAYING_EFFECTS_META = PLAYING_EFFECTS_META;
  global.fxIdleExt = fxIdleExt;
  global.fxPressRaw = fxPressRaw;
  global.computePressEffectExt = computePressEffectExt;
  global.pressEffectDuration = pressEffectDuration;
  global.fxIsAudioIdle = fxIsAudioIdle;
  global.fxPopulatePressSelects = fxPopulatePressSelects;
  global.FX_IDLE_EFFECT_MAX = 40;
  global.FX_PRESS_EFFECT_MAX = 24;
})(typeof window !== 'undefined' ? window : globalThis);
