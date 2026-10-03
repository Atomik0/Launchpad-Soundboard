# -*- coding: utf-8 -*-
"""Traduce effects.dsl.py a C (firmware) y JavaScript (app)."""
import re, pathlib, importlib.util

S = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("dsl", S / "effects.dsl.py")
dsl = importlib.util.module_from_spec(spec); spec.loader.exec_module(dsl)

FUNCS = ["SIN", "COS", "SQRT", "ABS", "FLOOR", "FRACT", "MOD", "MIN", "MAX", "POW", "ATAN2",
         "HASH2", "HASH", "VU", "RGB", "HSLK", "HSL", "FXC", "FXH", "FX"]

def _common(body):
    out = body.strip("\n")
    for f in FUNCS:
        out = re.sub(r"\b%s\(" % f, "fx_%s(" % f.lower(), out)
    return out

def to_js(body):
    out = _common(body)
    return re.sub(r"\bVAR\s", "let ", out)

def to_c(body):
    out = _common(body)
    out = re.sub(r"\bVAR\s", "float ", out)
    out = re.sub(r"(?<![\w.])(\d+\.\d+)(?![\w.])", r"\1f", out)
    return out

def indent(txt, n):
    pad = " " * n
    return "\n".join(pad + l if l.strip() else l for l in txt.split("\n"))

IDLE_MAX = max(e[0] for e in dsl.IDLE)
PRESS_MAX = max(e[0] for e in dsl.PRESS)
PLAYING_MAX = max(e[0] for e in dsl.PLAYING)
AUDIO_IDS = [16] + [e[0] for e in dsl.IDLE if e[1] == 'audio']

# ------------------------------------------------------------------- C ----
def c_code():
    idle_cases = "\n".join(
        "    case %d: { // %s\n%s\n    }" % (e[0], e[2], indent(to_c(e[5]), 6)) for e in dsl.IDLE)
    press_cases = "\n".join(
        "    case %d: { // %s\n%s\n    }" % (e[0], e[1], indent(to_c(e[7]), 6)) for e in dsl.PRESS)
    dur_cases = "\n".join("    case %d: return %d;" % (e[0], e[6]) for e in dsl.PRESS)
    return r"""
// >>> EFECTOS EXTENDIDOS (bloque generado por tools/effects/generar_efectos.py)
// ============================================================================
// EFECTOS EXTENDIDOS (v1.2) - generados desde la misma fuente que la app
// Idle 17..%(IDLE_MAX)d, pulsacion 13..%(PRESS_MAX)d. No editar a mano: editar tools/effects/effects.dsl.py y ejecutar generar_efectos.py
// ============================================================================
#define IDLE_EFFECT_MAX %(IDLE_MAX)d
#define PRESS_EFFECT_MAX %(PRESS_MAX)d
#define PLAYING_EFFECT_MAX %(PLAYING_MAX)d

float fxVu[8] = {0, 0, 0, 0, 0, 0, 0, 0};   // bandas de audio 0..1 (comando V)

static inline float fx_sin(float x) { return sinf(x); }
static inline float fx_cos(float x) { return cosf(x); }
static inline float fx_sqrt(float x) { return sqrtf(x > 0.0f ? x : 0.0f); }
static inline float fx_abs(float x) { return fabsf(x); }
static inline float fx_floor(float x) { return floorf(x); }
static inline float fx_fract(float x) { return x - floorf(x); }
static inline float fx_mod(float a, float b) { float m = fmodf(a, b); return (m < 0.0f) ? m + b : m; }
static inline float fx_min(float a, float b) { return a < b ? a : b; }
static inline float fx_max(float a, float b) { return a > b ? a : b; }
static inline float fx_pow(float a, float b) { return powf(a > 0.0f ? a : 0.0f, b); }
static inline float fx_atan2(float y, float x) { return atan2f(y, x); }
static inline float fx_hash_u(uint32_t n) {
  n ^= n >> 16; n *= 0x7feb352dUL; n ^= n >> 15; n *= 0x846ca68bUL; n ^= n >> 16;
  return (float)(n >> 8) * (1.0f / 16777216.0f);
}
static inline float fx_hash(float x) { return fx_hash_u((uint32_t)(int32_t)x); }
static inline float fx_hash2(float a, float b) {
  return fx_hash_u(((uint32_t)(int32_t)a * 73856093UL) ^ ((uint32_t)(int32_t)b * 19349663UL));
}
static inline float fx_vu(float i) { int k = (int)i; if (k < 0) k = 0; if (k > 7) k = 7; return fxVu[k]; }
static inline uint8_t fx_byte(float v) { return (uint8_t)constrain((int)roundf(v), 0, 255); }
static inline RGBColor fx_rgb(float r, float g, float b) { return RGBColor(fx_byte(r), fx_byte(g), fx_byte(b)); }
static inline RGBColor fx_hsl(float h, float s, float l) { return hslToRgb(h, s, l); }
static inline RGBColor fx_hslk(float h, float s, float l, float k) {
  RGBColor c = hslToRgb(h, s, l);
  k = constrain(k, 0.0f, 1.0f);
  return RGBColor(fx_byte(c.r * k), fx_byte(c.g * k), fx_byte(c.b * k));
}

// (struct FxPress esta definido junto a RGBColor, antes de la primera funcion,
//  porque el IDE de Arduino inserta prototipos automaticos ahi)
static inline FxPress fx_fx(float i) { FxPress p = {constrain(i, 0.0f, 1.0f), false, 0, 0, 0}; return p; }
static inline FxPress fx_fxc(float i, float r, float g, float b) {
  FxPress p = {constrain(i, 0.0f, 1.0f), true, fx_byte(r), fx_byte(g), fx_byte(b)}; return p;
}
static inline FxPress fx_fxh(float i, float h) {
  RGBColor c = hslToRgb(h, 1.0f, 0.55f);
  FxPress p = {constrain(i, 0.0f, 1.0f), true, c.r, c.g, c.b}; return p;
}

static RGBColor fxIdleExt(uint8_t id, float r, float c, float rows, float cols, float t) {
  float R8 = (rows > 1.0f) ? r * 7.0f / (rows - 1.0f) : 0.0f;
  float C8 = (cols > 1.0f) ? c * 7.0f / (cols - 1.0f) : 0.0f;
  float CR = (rows - 1.0f) * 0.5f, CC = (cols - 1.0f) * 0.5f;
  float LEVEL = 0.0f;
  for (int i = 0; i < 8; i++) LEVEL += fxVu[i];
  LEVEL *= 0.125f;
  float BASS = (fxVu[0] + fxVu[1]) * 0.5f;
  (void)R8; (void)C8; (void)CR; (void)CC; (void)LEVEL; (void)BASS;
  switch (id) {
%(idle_cases)s
    default: break;
  }
  return fx_rgb(0.0f, 0.0f, 0.0f);
}

static uint16_t fxPressDuration(uint8_t id) {
  switch (id) {
%(dur_cases)s
    default: return 900;
  }
}

static FxPress fxPressExt(uint8_t id, float T, float DR, float DC, float DIST, float SEED,
                          float ER, float EC, float r, float c, float rows, float cols) {
  float KS = (cols == 5.0f) ? 0.65f : 1.0f;
  (void)EC; (void)rows; (void)KS;
  switch (id) {
%(press_cases)s
    default: break;
  }
  return fx_fx(0.0f);
}
// <<< FIN EFECTOS EXTENDIDOS
""" % dict(IDLE_MAX=IDLE_MAX, PRESS_MAX=PRESS_MAX, PLAYING_MAX=PLAYING_MAX,
           idle_cases=idle_cases, press_cases=press_cases, dur_cases=dur_cases)

# ------------------------------------------------------------------ JS ----
def js_code():
    import json
    idle_cases = "\n".join(
        "      case %d: { // %s\n%s\n      }" % (e[0], e[2], indent(to_js(e[5]), 8)) for e in dsl.IDLE)
    press_cases = "\n".join(
        "      case %d: { // %s\n%s\n      }" % (e[0], e[1], indent(to_js(e[7]), 8)) for e in dsl.PRESS)
    idle_meta = ",\n".join("  { id: %d, category: %s, name: %s, badge: %s, desc: %s }" % (
        e[0], json.dumps(e[1]), json.dumps(e[2]), json.dumps(e[3]), json.dumps(e[4], ensure_ascii=False)) for e in dsl.IDLE)
    press_meta = ",\n".join("  { id: %d, title: %s, short: %s, name: %s, desc: %s, color: %s }" % (
        e[0], json.dumps(e[2]), json.dumps(e[3]), json.dumps(e[1]), json.dumps(e[4], ensure_ascii=False), json.dumps(e[5])) for e in dsl.PRESS)
    playing_meta = ",\n".join("  { id: %d, name: %s, desc: %s }" % (
        e[0], json.dumps(e[1], ensure_ascii=False), json.dumps(e[2], ensure_ascii=False)) for e in dsl.PLAYING)
    durs = ", ".join("%d: %d" % (e[0], e[6]) for e in dsl.PRESS)
    return r"""/*
 * effects_ext.js - Efectos de luz extendidos (v1.2)
 * GENERADO desde la misma fuente que el firmware (effects.dsl.py): no editar a mano.
 * Idle 17..%(IDLE_MAX)d, pulsacion 13..%(PRESS_MAX)d, efectos "mientras suena" 0..%(PLAYING_MAX)d.
 * Lo usan la app de escritorio (grilla, vista previa) y la app movil.
 */
(function (global) {
  'use strict';

  const EXT_IDLE_EFFECTS_META = [
%(idle_meta)s
  ];

  const EXT_PRESS_EFFECTS_META = [
%(press_meta)s
  ];

  const PLAYING_EFFECTS_META = [
%(playing_meta)s
  ];

  const PRESS_DURATIONS = { %(durs)s };
  const AUDIO_IDLE_IDS = %(audio_ids)s;

  const fx_sin = Math.sin, fx_cos = Math.cos, fx_abs = Math.abs, fx_floor = Math.floor, fx_atan2 = Math.atan2;
  const fx_sqrt = (x) => Math.sqrt(x > 0 ? x : 0);
  const fx_fract = (x) => x - Math.floor(x);
  const fx_mod = (a, b) => { const m = a %% b; return m < 0 ? m + b : m; };
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
    h = ((h %% 360) + 360) %% 360;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) %% 2) - 1));
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
%(idle_cases)s
      default: return null;
    }
    return [0, 0, 0];
  }

  // Devuelve {intensity, color} con la misma forma que usa la app; null si el id no es extendido.
  function fxPressRaw(id, T, DR, DC, DIST, SEED, ER, EC, r, c, rows, cols) {
    const KS = (cols === 5) ? 0.65 : 1.0;
    void EC;
    switch (id) {
%(press_cases)s
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
  global.FX_IDLE_EFFECT_MAX = %(IDLE_MAX)d;
  global.FX_PRESS_EFFECT_MAX = %(PRESS_MAX)d;
})(typeof window !== 'undefined' ? window : globalThis);
""" % dict(IDLE_MAX=IDLE_MAX, PRESS_MAX=PRESS_MAX, PLAYING_MAX=PLAYING_MAX, idle_meta=idle_meta,
           press_meta=press_meta, playing_meta=playing_meta, durs=durs, audio_ids=str(AUDIO_IDS),
           idle_cases=idle_cases, press_cases=press_cases)

if __name__ == "__main__":
    (S / "out_js").mkdir(exist_ok=True)
    (S / "out_js" / "effects_ext.js").write_text(js_code())
    (S / "out_js" / "effects_ext.c.inc").write_text(c_code())
    print("idle max", IDLE_MAX, "press max", PRESS_MAX, "audio", AUDIO_IDS)
