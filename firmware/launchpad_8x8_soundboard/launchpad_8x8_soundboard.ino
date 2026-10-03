/*
 * ============================================================================
 * FIRMWARE LAUNCHPAD 8x8 - ULTIMATE LIGHTSHOW & SOUNDBOARD PRO
 * Microcontrolador: STM32F401 / STM32F411 (Black Pill)
 * Soporte: Compositor de Iluminación Inteligente (Fusión Neón Aditiva),
 *          Animaciones Psicodélicas a 60 FPS y Sincronización WebSerial sin
 * latencia
 * ============================================================================
 */

#include <Adafruit_NeoPixel.h>
#include <math.h>
#include <EEPROM.h>

#define LED_PIN PA7
#define NUM_LEDS 64
#define ROWS 8
#define COLS 8
#define DEFAULT_BRIGHTNESS 220

const uint8_t rowPins[ROWS] = {PB3, PB4, PB5, PB6, PB7, PB8, PB9, PB0};
const uint8_t colPins[COLS] = {PA0, PA1, PA2, PA3, PA4, PA5, PA6, PB10};

#define START_LED_TOP_RIGHT true

// ---------------------------------------------------------------------------
// AJUSTES DE ROBUSTEZ (v1.2.0) - no modifican pines ni cableado
// ---------------------------------------------------------------------------
#define FW_VERSION "1.3.3"
#define PAD_MODEL "8x8"
// El nombre USB que muestra el PC ("SoundBoard Launchpad 8x8") se define en
// build_opt.h (junto a este .ino), porque el descriptor USB se compila aparte.
// Ahi tambien se agranda la cola de recepcion USB (3 -> 32 paquetes): con la de
// fabrica (192 bytes), si se llenaba el nucleo STM32 perdia paquetes y los cuadros
// de la app (388 bytes en el 8x8) llegaban danados.
// Combo fisico para entrar a DFU (mantener 3 s): fila 0, columnas fisicas 0 y 7
#define DFU_COMBO_COL_A 0
#define DFU_COMBO_COL_B 7
// Limite de corriente estimada de la tira (mA). Ajustar a la fuente real de 5V.
// Si el pad se alimenta solo por el USB del PC, usar 450.
#define POWER_LIMIT_MA 2000

// Consumo estimado por canal WS2812B a 255 (mA) y consumo en reposo por LED
#define LED_MA_PER_CHANNEL 20
#define LED_IDLE_MA 1

// Antirrebote: la lectura debe mantenerse estable este tiempo antes de aceptarse.
// Filtra rebotes mecanicos y glitches de una sola lectura (pulsaciones fantasma).
#define DEBOUNCE_PRESS_MS 3
#define DEBOUNCE_RELEASE_MS 8

struct PadLed {
  uint8_t r, g, b;
  bool hasSound;
  bool isPlaying;
  int8_t pressEffect;   // -1 = usar efecto global de la capa
  unsigned long playStartTime;
  uint32_t playDurationMs;  // 0 = desconocida / loop
};

PadLed padLeds[NUM_LEDS];
bool keyState[ROWS][COLS];          // estado ya filtrado (debounced)
bool rawKeyState[ROWS][COLS];       // ultima lectura cruda
unsigned long rawChangeTime[ROWS][COLS];
bool reportedPressed[ROWS][COLS];   // se envio "P" a la app y falta su "R"

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

uint8_t pressEffect = 1;
uint8_t idleEffect = 11;
uint8_t blendMode = 0;
uint8_t playingEffect = 0;   // efecto del pad mientras suena (comando Y)

// --- Pad Studio (v1.3): la app puede dibujar el pad, guardar la config, etc. ---
uint8_t streamMode = 0;              // 0 = normal, 1 = creacion de la app como fondo, 2 = juego/ritmos (control total)
unsigned long lastStreamFrameMs = 0;
uint32_t statBadFrames = 0;           // cuadros descartados por llegar danados (ver STATS)
const unsigned long STREAM_TIMEOUT_MS = 3000;  // si la app deja de enviar cuadros, vuelve a lo normal
uint8_t currentBrightness = DEFAULT_BRIGHTNESS;
bool progressBarEnabled = false;     // fila superior como barra de progreso del sonido (comando O)
bool beatSyncEnabled = false;        // la animacion de fondo late con el ritmo (comandos H y U)
bool fnLightOn = true;               // luz tenue de la tecla FN en reposo (comando N)
float beatLevel = 0.0f;
unsigned long lastBeatMs = 0;
uint8_t vuLevels[COLS];

bool fnModeActive = false;
bool fnKeyEnabled = true;
uint8_t totalBanksCount = 1;
uint8_t currentBankIndex = 0;

unsigned long lastActivityTime = 0;
const unsigned long SLEEP_TIMEOUT_MS = 15000;

struct ActivePressEffect {
  bool active;
  uint8_t id;          // 0 to 12
  uint8_t r, c;        // Origin coordinates
  uint8_t colorR, colorG, colorB;
  unsigned long startTime;
  uint16_t duration;
  float seed;
};
#define MAX_ACTIVE_PRESS_EFFECTS 6
ActivePressEffect activePressEffects[MAX_ACTIVE_PRESS_EFFECTS];

unsigned long lastFlashTime = 0;
uint32_t statRenderUs = 0, statRenderMaxUs = 0, statFrames = 0;
bool flashToggle = false;

char serialBuf[NUM_LEDS * 6 + 16];   // alcanza para un cuadro completo (comando F)
uint16_t serialBufIdx = 0;
bool serialOverflow = false;

struct RGBColor {
  uint8_t r, g, b;
  RGBColor() : r(0), g(0), b(0) {}
  RGBColor(uint8_t _r, uint8_t _g, uint8_t _b) : r(_r), g(_g), b(_b) {}
};

// Resultado de un efecto de pulsacion extendido (ver bloque EFECTOS EXTENDIDOS)
struct FxPress { float i; bool custom; uint8_t r, g, b; };

RGBColor streamFrame[NUM_LEDS];     // ultimo cuadro recibido de la app (indice de LED)

inline uint16_t getLedIndex(uint8_t row, uint8_t col) {
  if (START_LED_TOP_RIGHT) {
    if (row % 2 == 0) {
      return (row * COLS) + (COLS - 1 - col);
    } else {
      return (row * COLS) + col;
    }
  } else {
    if (row % 2 == 0) {
      return (row * COLS) + col;
    } else {
      return (row * COLS) + (COLS - 1 - col);
    }
  }
}

RGBColor hslToRgb(float h, float s, float l) {
  h = fmodf(fmodf(h, 360.0f) + 360.0f, 360.0f);
  s = constrain(s, 0.0f, 1.0f);
  l = constrain(l, 0.0f, 1.0f);
  float c = (1.0f - fabsf(2.0f * l - 1.0f)) * s;
  float x = c * (1.0f - fabsf(fmodf(h / 60.0f, 2.0f) - 1.0f));
  float m = l - c * 0.5f;
  float r = 0.0f, g = 0.0f, b = 0.0f;
  if (h < 60.0f) { r = c; g = x; }
  else if (h < 120.0f) { r = x; g = c; }
  else if (h < 180.0f) { g = c; b = x; }
  else if (h < 240.0f) { g = x; b = c; }
  else if (h < 300.0f) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    (uint8_t)constrain((int)roundf((r + m) * 255.0f), 0, 255),
    (uint8_t)constrain((int)roundf((g + m) * 255.0f), 0, 255),
    (uint8_t)constrain((int)roundf((b + m) * 255.0f), 0, 255)
  };
}

// >>> EFECTOS EXTENDIDOS (bloque generado por tools/effects/generar_efectos.py)
// ============================================================================
// EFECTOS EXTENDIDOS (v1.2) - generados desde la misma fuente que la app
// Idle 17..40, pulsacion 13..24. No editar a mano: editar tools/effects/effects.dsl.py y ejecutar generar_efectos.py
// ============================================================================
#define IDLE_EFFECT_MAX 40
#define PRESS_EFFECT_MAX 24
#define PLAYING_EFFECT_MAX 8

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
    case 17: { // Starfield
      float ph = fx_hash2(r, c);
      float sp = 0.6f + fx_hash2(r + 17.0f, c + 31.0f) * 1.4f;
      float tw = fx_max(0.0f, fx_sin(t * sp * 3.0f + ph * 6.2832f));
      float b = fx_pow(tw, 6.0f);
      float warm = fx_hash2(r + 5.0f, c + 9.0f);
      return fx_rgb(8.0f + b * (200.0f + warm * 55.0f), 10.0f + b * (210.0f + warm * 30.0f), 26.0f + b * 229.0f);
    }
    case 18: { // Thunderstorm
      float slot = fx_floor(t * 1.1f);
      float f = fx_fract(t * 1.1f);
      float strike = fx_hash(slot);
      float base = 0.4f + 0.2f * fx_sin(t * 0.7f + C8 * 0.6f + R8 * 0.3f);
      float flash = 0.0f;
      if (strike > 0.55f) {
        float fl1 = fx_max(0.0f, 1.0f - f * 9.0f);
        float fl2 = (f > 0.16f) ? fx_max(0.0f, 1.0f - (f - 0.16f) * 12.0f) : 0.0f;
        flash = fx_max(fl1, fl2 * 0.8f);
        float boltC = fx_floor(fx_hash(slot + 7.0f) * 8.0f);
        float near = fx_max(0.0f, 1.0f - fx_abs(C8 - boltC - fx_sin(R8 * 1.7f + slot) * 0.8f) * 0.6f);
        flash = flash * (0.35f + 0.65f * near);
      }
      return fx_rgb(8.0f * base + flash * 230.0f, 11.0f * base + flash * 235.0f, 28.0f * base + flash * 255.0f);
    }
    case 19: { // DNA Helix
      float ph = t * 2.2f + R8 * 0.85f;
      float amp = 2.95f;
      float x1 = 3.5f + fx_sin(ph) * amp;
      float x2 = 3.5f - fx_sin(ph) * amp;
      float depth = fx_cos(ph);
      float b1 = fx_max(0.0f, 1.0f - fx_abs(C8 - x1) * 0.8f) * (0.55f + 0.45f * depth);
      float b2 = fx_max(0.0f, 1.0f - fx_abs(C8 - x2) * 0.8f) * (0.55f - 0.45f * depth);
      float rung = 0.0f;
      if (fx_mod(r + fx_floor(t * 2.0f), 2.0f) < 1.0f && C8 > fx_min(x1, x2) && C8 < fx_max(x1, x2)) {
        rung = 0.18f;
      }
      return fx_rgb(b2 * 255.0f + rung * 120.0f, b1 * 230.0f + rung * 120.0f, b1 * 255.0f + b2 * 200.0f + rung * 160.0f);
    }
    case 20: { // Radar
      float dx = C8 - 3.5f;
      float dy = R8 - 3.5f;
      float ang = fx_atan2(dy, dx);
      float sweep = fx_mod(t * 2.4f, 6.2832f);
      float diff = fx_mod(sweep - ang, 6.2832f);
      float trail = fx_max(0.0f, 1.0f - diff / 2.2f);
      float blip = 0.0f;
      float bh = fx_hash2(r * 3.0f + fx_floor(t * 0.25f), c * 7.0f);
      if (bh > 0.92f) {
        blip = 0.3f + 0.7f * fx_max(0.0f, 1.0f - diff / 4.0f);
      }
      float g = trail * trail;
      return fx_rgb(blip * 255.0f, 20.0f + g * 235.0f + blip * 80.0f, 8.0f + g * 60.0f + blip * 40.0f);
    }
    case 21: { // Snowfall
      float sp = 0.9f + fx_hash(c * 13.0f) * 0.9f;
      float off = fx_hash(c * 29.0f + 3.0f) * 20.0f;
      float wrap = rows + 2.5f;
      float p1 = fx_mod(t * sp * 1.6f + off, wrap) - 1.0f;
      float p2 = fx_mod(t * sp * 1.6f + off + wrap * 0.5f, wrap) - 1.0f;
      float d = fx_min(fx_abs(r - p1), fx_abs(r - p2));
      float b = fx_max(0.0f, 1.0f - d * 1.4f);
      float ground = (r == rows - 1.0f) ? 0.18f : 0.0f;
      return fx_rgb(10.0f + b * 220.0f + ground * 200.0f, 14.0f + b * 225.0f + ground * 210.0f, 30.0f + b * 225.0f + ground * 225.0f);
    }
    case 22: { // Rain Drops
      float best = 0.0f;
      for (float k = 0.0f; k < 3.0f; k = k + 1.0f) {
        float ph = t / 1.6f + k * 0.333f;
        float slot = fx_floor(ph);
        float f = fx_fract(ph);
        float cx = fx_floor(fx_hash(slot * 3.0f + k * 101.0f) * 8.0f);
        float cy = fx_floor(fx_hash(slot * 5.0f + k * 57.0f + 11.0f) * 8.0f);
        float d = fx_sqrt((R8 - cy) * (R8 - cy) + (C8 - cx) * (C8 - cx));
        float ring = f * 5.5f;
        float w = fx_max(0.0f, 1.0f - fx_abs(d - ring) * 0.9f) * (1.0f - f);
        best = fx_max(best, w);
      }
      return fx_rgb(4.0f + best * 90.0f, 20.0f + best * 170.0f, 50.0f + best * 205.0f);
    }
    case 23: { // Northern Lights
      float band = fx_sin(C8 * 0.55f + t * 0.6f) + 0.6f * fx_sin(C8 * 1.27f - t * 0.9f + 1.3f);
      float top = 1.0f - R8 / 7.0f;
      float curtain = fx_max(0.0f, 1.0f - fx_abs(top - (0.55f + band * 0.22f)) * 2.6f);
      float shimmer = 0.75f + 0.25f * fx_sin(t * 3.1f + C8 * 1.7f + R8 * 0.4f);
      float hue = 120.0f + band * 40.0f + top * 80.0f;
      return fx_hslk(hue, 1.0f, 0.5f, curtain * shimmer);
    }
    case 24: { // Magma
      float dc = fx_sqrt((R8 - 3.5f) * (R8 - 3.5f) + (C8 - 3.5f) * (C8 - 3.5f));
      float v = fx_sin(C8 * 0.7f + t * 0.8f) + fx_sin(R8 * 0.9f - t * 0.6f) + fx_sin((R8 + C8) * 0.45f + t * 1.1f) + fx_sin(dc * 1.3f - t * 1.4f);
      float n = (v + 4.0f) / 8.0f;
      float heat = fx_pow(fx_max(0.0f, n), 1.6f);
      return fx_rgb(60.0f + heat * 195.0f, heat * heat * 170.0f, heat * heat * heat * 40.0f);
    }
    case 25: { // Checker Pulse
      float chk = fx_mod(r + c + fx_floor(t * 1.5f), 2.0f);
      float hue = fx_mod(t * 40.0f, 360.0f) + chk * 180.0f;
      float br = 0.35f + 0.15f * fx_sin(t * 4.712f);
      return fx_hsl(hue, 1.0f, 0.06f + chk * br);
    }
    case 26: { // KITT Scanner
      float pos = (fx_sin(t * 2.6f) * 0.5f + 0.5f) * 7.0f;
      float d = C8 - pos;
      float dir = fx_cos(t * 2.6f);
      float trail = (d * dir < 0.0f) ? fx_max(0.0f, 1.0f - fx_abs(d) / 3.2f) : fx_max(0.0f, 1.0f - fx_abs(d) / 0.9f);
      float rowMask = (fx_abs(R8 - 3.5f) < 1.2f) ? 1.0f : 0.22f;
      float b = fx_pow(trail, 1.5f) * rowMask;
      return fx_rgb(18.0f + b * 237.0f, b * 30.0f, b * 12.0f);
    }
    case 27: { // Retro Snake
      float n = rows * cols;
      float idx = (fx_mod(r, 2.0f) < 1.0f) ? (r * cols + c) : (r * cols + (cols - 1.0f - c));
      float step = fx_floor(t * 9.0f);
      float head = fx_mod(step, n);
      float behind = fx_mod(head - idx + n, n);
      float len = (cols == 5.0f) ? 5.0f : 9.0f;
      float food = fx_floor(fx_hash(fx_floor(step / n)) * n);
      if (behind < len) {
        float k = 1.0f - behind / len;
        return fx_hsl(fx_mod(100.0f + behind * 12.0f, 360.0f), 1.0f, 0.18f + 0.4f * k);
      }
      if (idx == food) {
        float blink = (fx_fract(t * 3.0f) < 0.5f) ? 1.0f : 0.5f;
        return fx_rgb(255.0f * blink, 40.0f * blink, 60.0f * blink);
      }
      return fx_rgb(3.0f, 6.0f, 10.0f);
    }
    case 28: { // Confetti
      float off = fx_hash2(r, c) * 3.0f;
      float slot = fx_floor(t * 3.0f + off);
      float f = fx_fract(t * 3.0f + off);
      float on = fx_hash2(r * 31.0f + slot, c * 17.0f);
      if (on > 0.72f) {
        float hue = fx_hash2(slot, r * 8.0f + c) * 360.0f;
        return fx_hslk(hue, 1.0f, 0.5f, 1.0f - f);
      }
      return fx_rgb(4.0f, 4.0f, 8.0f);
    }
    case 29: { // Heartbeat
      float ph = fx_mod(t, 1.1f) / 1.1f;
      float p1 = fx_max(0.0f, 1.0f - fx_abs(ph - 0.08f) / 0.07f);
      float p2 = fx_max(0.0f, 1.0f - fx_abs(ph - 0.30f) / 0.09f) * 0.75f;
      float beat = fx_max(p1, p2);
      float d = fx_sqrt((R8 - 3.5f) * (R8 - 3.5f) + (C8 - 3.5f) * (C8 - 3.5f));
      float spread = fx_max(0.0f, 1.0f - d / (1.5f + beat * 3.5f));
      float b = 0.08f + beat * spread * 0.92f;
      return fx_rgb(255.0f * b, 20.0f * b, 50.0f * b);
    }
    case 30: { // Sunset
      float y = R8 / 7.0f + 0.12f * fx_sin(C8 * 0.6f + t * 0.5f);
      float shift = fx_sin(t * 0.15f) * 0.15f;
      float h = 270.0f + (y + shift) * 130.0f;
      float l = 0.30f + y * 0.25f;
      return fx_hsl(fx_mod(h, 360.0f), 1.0f, l);
    }
    case 31: { // Color Wheel
      float ang = fx_atan2(R8 - 3.5f, C8 - 3.5f);
      float d = fx_sqrt((R8 - 3.5f) * (R8 - 3.5f) + (C8 - 3.5f) * (C8 - 3.5f));
      float hue = fx_mod(ang * 57.2958f + t * 90.0f + 360.0f, 360.0f);
      return fx_hsl(hue, 1.0f, fx_min(0.55f, 0.15f + d * 0.09f));
    }
    case 32: { // Police Lights
      float seg = fx_mod(t * 2.0f, 2.0f);
      float strobe = (fx_fract(t * 12.0f) < 0.5f) ? 1.0f : 0.0f;
      float redOn = (seg < 1.0f && C8 < 3.5f) ? strobe : 0.0f;
      float blueOn = (seg >= 1.0f && C8 >= 3.5f) ? strobe : 0.0f;
      return fx_rgb(10.0f + redOn * 245.0f, 4.0f, 10.0f + blueOn * 245.0f);
    }
    case 33: { // Tesla Coil
      float dx = C8 - 3.5f;
      float dy = R8 - 3.5f;
      float d = fx_sqrt(dx * dx + dy * dy);
      float ang = fx_atan2(dy, dx);
      float core = fx_max(0.0f, 1.0f - d / 1.4f);
      float arm = 0.0f;
      for (float k = 0.0f; k < 4.0f; k = k + 1.0f) {
        float a0 = fx_hash(fx_floor(t * 8.0f) + k * 13.0f) * 6.2832f;
        float da = fx_abs(fx_mod(ang - a0 + 3.1416f, 6.2832f) - 3.1416f);
        float wig = da * d;
        arm = fx_max(arm, fx_max(0.0f, 1.0f - wig * 1.4f) * fx_max(0.0f, 1.0f - d / 5.5f));
      }
      float b = fx_max(core, arm);
      return fx_rgb(150.0f * b + core * 105.0f, 120.0f * b + core * 135.0f, 255.0f * b);
    }
    case 34: { // Rainbow Breathing
      float hue = fx_mod(t * 25.0f, 360.0f) + (R8 + C8) * 4.0f;
      float l = 0.08f + 0.42f * (fx_sin(t * 1.8f) * 0.5f + 0.5f);
      return fx_hsl(hue, 1.0f, l);
    }
    case 35: { // Spectrum Bars
      float lv = fx_vu(fx_floor(c * 8.0f / cols));
      float h = lv * rows;
      float fromBottom = rows - 1.0f - r;
      if (fromBottom < h) {
        float ratio = fromBottom / (rows - 1.0f);
        return fx_hsl(120.0f - ratio * 120.0f, 1.0f, 0.5f);
      }
      return fx_rgb(4.0f, 6.0f, 10.0f);
    }
    case 36: { // VU Center
      float d = fx_sqrt((R8 - 3.5f) * (R8 - 3.5f) + (C8 - 3.5f) * (C8 - 3.5f)) / 5.0f;
      if (d < LEVEL * 1.05f) {
        return fx_hsl(120.0f - d * 130.0f, 1.0f, 0.5f);
      }
      return fx_rgb(3.0f, 4.0f, 8.0f);
    }
    case 37: { // Bass Strobe
      float b = fx_pow(BASS, 2.2f);
      return fx_hslk(fx_mod(t * 60.0f, 360.0f), 1.0f, 0.5f, 0.04f + b * 0.96f);
    }
    case 38: { // Spectrum Mirror
      float lv = fx_vu(fx_floor(c * 8.0f / cols));
      float half = (rows - 1.0f) * 0.5f;
      float d = fx_abs(r - half);
      if (d <= lv * (half + 0.5f)) {
        return fx_hsl(190.0f + d / half * 130.0f, 1.0f, 0.55f - d / half * 0.15f);
      }
      return fx_rgb(3.0f, 3.0f, 8.0f);
    }
    case 39: { // Audio Fire
      float lv = fx_vu(fx_floor(c * 8.0f / cols));
      float flick = 0.15f * fx_sin(t * 9.0f + c * 2.1f);
      float h = (lv + flick) * rows;
      float fromBottom = rows - 1.0f - r;
      if (fromBottom < h) {
        float k = fromBottom / fx_max(1.0f, h);
        if (k > 0.75f) {
          return fx_rgb(255.0f, 230.0f, 80.0f);
        }
        if (k > 0.45f) {
          return fx_rgb(255.0f, 120.0f, 0.0f);
        }
        return fx_rgb(220.0f, 30.0f, 0.0f);
      }
      return fx_rgb(15.0f, 2.0f, 0.0f);
    }
    case 40: { // Beat Rainbow
      float hue = fx_mod(t * 70.0f + (R8 + C8) * 22.0f, 360.0f);
      return fx_hsl(hue, 1.0f, 0.05f + LEVEL * 0.5f);
    }
    default: break;
  }
  return fx_rgb(0.0f, 0.0f, 0.0f);
}

static uint16_t fxPressDuration(uint8_t id) {
  switch (id) {
    case 13: return 1000;
    case 14: return 900;
    case 15: return 800;
    case 16: return 900;
    case 17: return 900;
    case 18: return 800;
    case 19: return 1100;
    case 20: return 1300;
    case 21: return 700;
    case 22: return 900;
    case 23: return 1100;
    case 24: return 1000;
    default: return 900;
  }
}

static FxPress fxPressExt(uint8_t id, float T, float DR, float DC, float DIST, float SEED,
                          float ER, float EC, float r, float c, float rows, float cols) {
  float KS = (cols == 5.0f) ? 0.65f : 1.0f;
  (void)EC; (void)rows; (void)KS;
  switch (id) {
    case 13: { // Water Drop
      float core = (DIST < 0.7f && T < 0.25f) ? (1.0f - T / 0.25f) : 0.0f;
      float r1 = T * 7.0f * KS;
      float r2 = fx_max(0.0f, (T - 0.3f) * 7.0f * KS);
      float w1 = fx_max(0.0f, 1.0f - fx_abs(DIST - r1) / 1.1f) * (1.0f - T);
      float w2 = fx_max(0.0f, 1.0f - fx_abs(DIST - r2) / 1.1f) * (1.0f - T) * 0.6f;
      return fx_fxc(fx_max(core, fx_max(w1, w2)), 80.0f, 190.0f, 255.0f);
    }
    case 14: { // Comet Burst
      float best = 0.0f;
      for (float k = 0.0f; k < 4.0f; k = k + 1.0f) {
        float a = 0.7854f + k * 1.5708f + SEED * 0.6f;
        float along = DC * fx_cos(a) + DR * fx_sin(a);
        float perp = fx_abs(DR * fx_cos(a) - DC * fx_sin(a));
        float behind = T * 9.0f * KS - along;
        if (perp < 0.7f && behind >= -0.5f && behind < 3.0f) {
          best = fx_max(best, (1.0f - behind / 3.0f) * (1.0f - perp / 0.7f) * (1.0f - T * 0.6f));
        }
      }
      return fx_fx(best);
    }
    case 15: { // Pixel Explosion
      float slot = fx_floor(T * 10.0f);
      float h = fx_hash2(r * 13.0f + slot * 7.0f + fx_floor(SEED * 1000.0f), c * 29.0f);
      float reach = T * 6.0f * KS + 0.6f;
      if (DIST < reach && h > 0.55f) {
        return fx_fxh((1.0f - T) * (1.0f - DIST / (reach + 0.01f) * 0.5f), fx_hash2(r + slot, c + 99.0f) * 360.0f);
      }
      return fx_fx(0.0f);
    }
    case 16: { // Square Wave
      float cheb = fx_max(fx_abs(DR), fx_abs(DC));
      float d = fx_abs(cheb - T * 8.0f * KS);
      if (d < 1.0f) {
        return fx_fx((1.0f - d) * (1.0f - T * 0.9f));
      }
      return fx_fx(0.0f);
    }
    case 17: { // Implosion
      if (T < 0.75f) {
        float rr = (1.0f - T / 0.75f) * 8.0f * KS;
        float d = fx_abs(DIST - rr);
        if (d < 1.2f) {
          return fx_fx((1.0f - d / 1.2f) * (0.4f + T));
        }
        return fx_fx(0.0f);
      }
      if (DIST < 1.6f) {
        return fx_fxc(1.0f - (T - 0.75f) / 0.25f, 255.0f, 255.0f, 255.0f);
      }
      return fx_fx(0.0f);
    }
    case 18: { // Scanline
      float pos = T * 8.0f * KS;
      float d = fx_min(fx_abs(DR - pos), fx_abs(DR + pos));
      return fx_fx(fx_max(0.0f, 1.0f - d / 0.9f) * (1.0f - T));
    }
    case 19: { // Orbit Trail
      float best = 0.0f;
      for (float k = 0.0f; k < 6.0f; k = k + 1.0f) {
        float tk = T - k * 0.035f;
        if (tk > 0.0f) {
          float a = tk * 12.566f + SEED * 6.2832f;
          float rad = tk * 5.5f * KS;
          float px = fx_cos(a) * rad;
          float py = fx_sin(a) * rad;
          float d = fx_sqrt((DC - px) * (DC - px) + (DR - py) * (DR - py));
          best = fx_max(best, fx_max(0.0f, 1.0f - d / 0.85f) * (1.0f - k / 6.0f));
        }
      }
      return fx_fxh(best * (1.0f - T * 0.5f), fx_mod(T * 360.0f + SEED * 360.0f, 360.0f));
    }
    case 20: { // Firework
      if (T < 0.35f) {
        float startR = rows - 1.0f;
        float curR = startR + (ER - startR) * (T / 0.35f);
        if (fx_abs(DC) < 0.5f && r >= curR - 0.5f && r <= startR + 0.5f) {
          return fx_fxc(fx_max(0.0f, 1.0f - fx_abs(r - curR) / 2.0f), 255.0f, 200.0f, 120.0f);
        }
        return fx_fx(0.0f);
      }
      float u = (T - 0.35f) / 0.65f;
      float d2 = fx_abs(DIST - u * 6.0f * KS);
      if (d2 < 1.0f) {
        float ang = fx_atan2(DR, DC);
        float spark = (fx_sin(ang * 8.0f + SEED * 20.0f) > 0.2f) ? 1.0f : 0.35f;
        return fx_fxh((1.0f - d2) * (1.0f - u) * spark, fx_mod(SEED * 360.0f + ang * 30.0f + 360.0f, 360.0f));
      }
      return fx_fx(0.0f);
    }
    case 21: { // Glitch
      float slot = fx_floor(T * 14.0f);
      float inLine = (fx_abs(DR) < 0.5f || fx_abs(DC) < 0.5f) ? 1.0f : 0.3f;
      float h = fx_hash2(r * 7.0f + slot * 131.0f + fx_floor(SEED * 500.0f), c * 3.0f + slot);
      if (h > 0.6f && DIST < 7.0f * KS) {
        float k = fx_hash2(slot, r + c * 8.0f);
        float i = inLine * (1.0f - T);
        if (k < 0.33f) {
          return fx_fxc(i, 0.0f, 255.0f, 255.0f);
        }
        if (k < 0.66f) {
          return fx_fxc(i, 255.0f, 0.0f, 200.0f);
        }
        return fx_fxc(i, 255.0f, 255.0f, 255.0f);
      }
      return fx_fx(0.0f);
    }
    case 22: { // Color Bomb
      float local = T - DIST / (10.0f * KS) * 0.5f;
      if (local < 0.0f) {
        return fx_fx(0.0f);
      }
      return fx_fx(fx_max(0.0f, 1.0f - local * 1.6f) * 0.9f);
    }
    case 23: { // Pulse Echo
      float best = 0.0f;
      for (float k = 0.0f; k < 3.0f; k = k + 1.0f) {
        float tk = T - k * 0.2f;
        if (tk > 0.0f) {
          float d = fx_abs(DIST - tk * 8.0f * KS);
          if (d < 0.9f) {
            best = fx_max(best, (1.0f - d / 0.9f) * (1.0f - tk) * (1.0f - k * 0.25f));
          }
        }
      }
      return fx_fx(best);
    }
    case 24: { // Matrix Burst
      if (fx_abs(DC) > 2.5f * KS + 0.5f) {
        return fx_fx(0.0f);
      }
      float sp = 0.6f + fx_hash(c * 7.0f + fx_floor(SEED * 100.0f)) * 0.8f;
      float head = ER - 0.5f + T * sp * 9.0f * KS;
      float behind = head - r;
      if (behind >= 0.0f && behind < 3.0f && r >= ER - 0.5f) {
        float hot = (behind < 0.8f) ? 200.0f : 0.0f;
        return fx_fxc((1.0f - behind / 3.0f) * (1.0f - T * 0.5f), hot, 255.0f, hot + 60.0f);
      }
      return fx_fx(0.0f);
    }
    default: break;
  }
  return fx_fx(0.0f);
}
// <<< FIN EFECTOS EXTENDIDOS

RGBColor computeIdleLedColor(uint8_t r, uint8_t c, uint8_t idleMode, unsigned long now, uint8_t rows, uint8_t cols) {
  if (idleMode == 0) return {0, 0, 0};
  float t = (float)now * 0.001f;
  float centerR = ((float)rows - 1.0f) * 0.5f;
  float centerC = ((float)cols - 1.0f) * 0.5f;
  float scale = (cols == 5) ? 0.625f : 1.0f;

  if (idleMode >= 17) return fxIdleExt(idleMode, (float)r, (float)c, (float)rows, (float)cols, t);

  switch (idleMode) {
    case 1: { // Rainbow Wave
      float step = (cols == 5) ? 50.0f : 32.0f;
      float hue = fmodf(t * 98.9f + ((float)r * step) + ((float)c * step), 360.0f);
      return hslToRgb(hue, 1.0f, 0.5f);
    }
    case 2: { // Matrix Rain
      const float speeds[8] = {0.85f, 1.15f, 0.75f, 1.25f, 0.70f, 1.05f, 0.90f, 1.20f};
      float sp = speeds[c % 8];
      const float colOffsets5[5] = {0.0f, 3.8f, 1.4f, 5.2f, 2.6f};
      const float colOffsets8[8] = {0.0f, 6.2f, 2.1f, 8.4f, 4.3f, 1.2f, 7.5f, 5.1f};
      float offset = (cols == 5) ? colOffsets5[c % 5] : colOffsets8[c % 8];
      float wrapLen = (float)rows + 3.2f;
      float speedFactor = (cols == 5) ? 5.5f : 7.8f;
      float dropPos = fmodf(t * speedFactor * sp + offset, wrapLen);
      float diff = (float)r - dropPos;
      if (fabsf(diff) < 0.6f) return {220, 255, 220};
      if (diff < 0.0f && diff > -2.2f) return {0, 220, 60};
      if (diff < 0.0f && diff > -4.5f) return {0, 80, 20};
      return {0, 12, 6};
    }
    case 3: { // Nebula Breathing
      float cx = centerC + sinf(t * 1.2f) * (1.8f * scale);
      float cy = centerR + cosf(t * 0.9f) * (1.8f * scale);
      float dist = sqrtf(powf((float)r - cy, 2) + powf((float)c - cx, 2));
      float norm = constrain(dist / (4.6f * scale), 0.0f, 1.0f);
      return {
        (uint8_t)roundf((1.0f - norm) * 230.0f),
        (uint8_t)roundf(norm * 160.0f),
        240
      };
    }
    case 4: { // Strobe Heartbeat
      float phase = sinf(t * 2.0f) * 0.5f + 0.5f;
      uint8_t br = (uint8_t)roundf(40.0f + phase * 200.0f);
      return {0, (uint8_t)roundf((float)br * 0.9f), br};
    }
    case 5: { // Starburst Spark
      float maxDist = sqrtf(powf(centerR, 2) + powf(centerC, 2)) + 0.6f;
      float cycleLen = maxDist + 0.8f;
      float speed = (cols == 5) ? 2.2f : 2.8f;
      float d1 = fmodf(t * speed, cycleLen);
      float d2 = fmodf(t * speed + cycleLen * 0.5f, cycleLen);
      float dist = sqrtf(powf((float)r - centerR, 2) + powf((float)c - centerC, 2));
      float thr = (cols == 5) ? 0.85f : 1.1f;
      float diff1 = fabsf(dist - d1);
      float diff2 = fabsf(dist - d2);

      if (diff1 < thr || diff2 < thr) {
        float activeD = (diff1 < thr) ? d1 : d2;
        float activeDiff = (diff1 < thr) ? diff1 : diff2;
        float fade = constrain(1.0f - activeD / maxDist, 0.0f, 1.0f) * (1.0f - activeDiff / thr);
        float stepCol = (cols == 5) ? 28.0f : 18.0f;
        float hue = fmodf(floorf(t * 0.6f) * 65.0f + ((float)(r + c)) * stepCol, 360.0f);
        RGBColor baseCol = hslToRgb(hue, 1.0f, 0.5f);
        return {
          (uint8_t)roundf((float)baseCol.r * fade),
          (uint8_t)roundf((float)baseCol.g * fade),
          (uint8_t)roundf((float)baseCol.b * fade)
        };
      }
      return {5, 5, 14};
    }
    case 6: { // Ocean Wave
      float oceanPhase = t * 120.0f;
      float stepC = (cols == 5) ? 56.0f : 35.0f;
      float wave = (sinf((oceanPhase + (float)c * stepC) * 0.02454f) + 1.0f) * 127.5f;
      return {0, (uint8_t)roundf(wave * 0.6f), (uint8_t)roundf(wave)};
    }
    case 7: { // Fire Embers
      float flicker = sinf(t * 3.5f + (float)c * 1.8f) * ((cols == 5) ? 0.8f : 0.9f);
      float h = ((float)(rows - 1 - r)) + flicker;
      float thr4 = (cols == 5) ? 3.4f : 5.2f;
      float thr3 = (cols == 5) ? 2.0f : 3.2f;
      float thr2 = (cols == 5) ? 0.8f : 1.2f;
      if (h > thr4) return {255, 230, 60};
      if (h > thr3) return {255, 120, 0};
      if (h > thr2) return {220, 25, 0};
      if (h >= 0.0f) return {80, 8, 0};
      return {15, 2, 0};
    }
    case 8: { // Cyberpunk EQ
      float freqC = (cols == 5) ? 1.3f : 1.1f;
      float barVal = (sinf(t * 2.5f + (float)c * freqC) * 0.5f + 0.5f) * ((float)rows - 0.4f);
      int invRow = (int)rows - 1 - (int)r;
      if ((float)invRow <= barVal) {
        float ratio = (float)invRow / ((float)rows - 1.0f);
        if (ratio >= 0.75f) return {255, 0, 50};
        if (ratio >= 0.50f) return {255, 200, 0};
        if (ratio >= 0.25f) return {0, 240, 255};
        return {0, 255, 90};
      }
      return {8, 12, 18};
    }
    case 9: { // Aurora Plasma
      float freq = (cols == 5) ? 1.2f : 0.8f;
      float v = sinf((float)r * freq + t * 2.0f) +
                sinf((float)c * freq + t * 2.6f) +
                sinf(((float)r + (float)c) * 0.5f + t * 1.8f);
      float hue = fmodf((v + 3.0f) * 60.0f + t * 40.0f, 360.0f);
      return hslToRgb(hue, 1.0f, 0.5f);
    }
    case 10: { // Laser Rings
      float maxRing = (cols == 5) ? 3.8f : 5.2f;
      float ring1 = fmodf(t * 3.5f, maxRing);
      float ring2 = fmodf(t * 3.5f + maxRing * 0.5f, maxRing);
      float dist = sqrtf(powf((float)r - centerR, 2) + powf((float)c - centerC, 2));
      float d1 = fabsf(dist - ring1);
      float d2 = fabsf(dist - ring2);
      if (d1 < 0.85f) {
        uint8_t b1 = (uint8_t)roundf((1.0f - (d1 / 0.85f)) * 240.0f);
        return {b1, b1, 255};
      }
      if (d2 < 0.85f) {
        uint8_t b2 = (uint8_t)roundf((1.0f - (d2 / 0.85f)) * 200.0f);
        return {(uint8_t)roundf((float)b2 * 0.4f), b2, 255};
      }
      return {5, 6, 18};
    }
    case 11: { // Quantum Flux
      float fx = fabsf((float)c - centerC);
      float fy = fabsf((float)r - centerR);
      float pTime = t * 2.5f;
      float fScale = (cols == 5) ? 2.5f : 1.7f;
      float mand = sinf(fx * fScale + pTime) * cosf(fy * fScale - pTime) +
                   sinf((fx + fy) * (fScale * 0.65f) + pTime * 1.4f);
      float hue = fmodf((mand + 2.0f) * 85.0f + t * 76.9f, 360.0f);
      return hslToRgb(hue, 1.0f, 0.55f);
    }
    case 12: { // Warp Tunnel
      float dx = (float)c - centerC;
      float dy = (float)r - centerR;
      float dist = sqrtf(dx * dx + dy * dy);
      float angle = atan2f(dy, dx);
      float tunnel = fmodf(fmodf(t * 1.6f - (1.0f / (dist + 0.2f)) * (3.5f * scale), 1.0f) + 1.0f, 1.0f);
      float hue = fmodf((angle / 3.14159265f + 1.0f) * 180.0f + t * 65.0f, 360.0f);
      float br = sinf(tunnel * 6.2831853f) * 0.5f + 0.5f;
      return hslToRgb(hue, 1.0f, fmaxf(0.08f, br * 0.55f));
    }
    case 13: { // Metaball Glow
      float pTime = t * 1.6f;
      float m1x = centerC + sinf(pTime * 1.1f) * (2.0f * scale);
      float m1y = centerR + cosf(pTime * 1.4f) * (2.0f * scale);
      float m2x = centerC + cosf(pTime * 0.9f) * (2.2f * scale);
      float m2y = centerR + sinf(pTime * 1.5f) * (2.2f * scale);
      float m3x = centerC + sinf(pTime * 1.7f + 1.0f) * (1.8f * scale);
      float m3y = centerR + cosf(pTime * 1.2f + 1.0f) * (1.8f * scale);

      float field = (1.0f / (powf((float)c - m1x, 2) + powf((float)r - m1y, 2) + 0.45f * scale))
                  + (1.0f / (powf((float)c - m2x, 2) + powf((float)r - m2y, 2) + 0.45f * scale))
                  + (1.0f / (powf((float)c - m3x, 2) + powf((float)r - m3y, 2) + 0.45f * scale));
      float hue = fmodf(field * 140.0f + t * 50.0f, 360.0f);
      float br = fminf(1.0f, field * 0.55f);
      return hslToRgb(hue, 1.0f, br * 0.55f);
    }
    case 14: { // Hyperspace Vortex
      float dx = (float)c - centerC;
      float dy = (float)r - centerR;
      float dist = sqrtf(dx * dx + dy * dy);
      float angle = atan2f(dy, dx);
      float spiral = angle * 2.0f + dist * (1.7f / scale) - t * 3.2f;
      float hue = fmodf(fmodf(spiral * (180.0f / 3.14159265f) + 720.0f, 360.0f) + 360.0f, 360.0f);
      float pulse = sinf(spiral * 2.0f) * 0.5f + 0.5f;
      return hslToRgb(hue, 1.0f, fmaxf(0.1f, pulse * 0.55f));
    }
    case 15: { // Neon Wave
      float pTime = t * 1.6f;
      float stepC1 = (cols == 5) ? 1.1f : 0.7f;
      float stepC2 = (cols == 5) ? 1.7f : 1.1f;
      float wave1 = sinf((float)c * stepC1 + pTime * 1.8f) * (1.7f * scale);
      float wave2 = cosf((float)c * stepC2 - pTime * 1.4f) * (1.1f * scale);
      float targetY = centerR + wave1 + wave2;
      float distY = fabsf((float)r - targetY);
      float intensity = fmaxf(0.0f, 1.0f - distY / (2.7f * scale));
      float colFactorC = (cols == 5) ? 45.0f : 30.0f;
      float colFactorR = (cols == 5) ? 35.0f : 22.0f;
      float hue = fmodf((float)c * colFactorC + (float)r * colFactorR + t * 70.0f, 360.0f);
      return hslToRgb(hue, 1.0f, intensity * 0.6f);
    }
    case 16: { // Audio Pulse
      uint16_t avgVu = 0;
      for (uint8_t i = 0; i < cols; i++) {
        avgVu += vuLevels[i];
      }
      float bass = constrain((float)avgVu / (8.0f * (float)cols), 0.0f, 1.0f);
      float dist = sqrtf(powf((float)r - centerR, 2) + powf((float)c - centerC, 2));
      float maxDist = (cols == 5) ? 3.4f : 5.4f;
      float normDist = fmaxf(0.0f, 1.0f - (dist / maxDist));
      float pulse = fminf(1.0f, normDist * (0.18f + bass * 0.92f));
      float hue = fmodf(t * 50.0f + dist * 35.0f + bass * 120.0f, 360.0f);
      return hslToRgb(hue, 1.0f, fmaxf(0.04f, pulse * 0.8f));
    }
    default: {
      float hue = fmodf(t * 30.0f + ((float)r * 25.0f) + ((float)c * 20.0f), 360.0f);
      return hslToRgb(hue, 0.9f, 0.4f);
    }
  }
}

void playEpicStartupAnimation();
void readFastSerial();
void scanMatrixInstant();
void renderAllEffects();
void showSafe();
void handleKeyEvent(uint8_t r, uint8_t c, bool pressed, unsigned long now);
void triggerPressEffect(uint8_t r, uint8_t c, uint16_t ledIdx, int forcedEffect = -1);
void computePressEffect(const ActivePressEffect &eff, uint8_t r, uint8_t c, unsigned long nowTime,
                        float &outIntensity, uint8_t &outR, uint8_t &outG, uint8_t &outB);
void handleCommand(char *buf);
void enterDFUMode();

#define DFU_BOOT_KEY 0xDF01B007
__attribute__((section(".noinit"))) volatile uint32_t dfu_magic_flag;

extern "C" void checkDfuBootloader(void) __attribute__((constructor(102)));
void checkDfuBootloader(void) {
  RCC->APB1ENR |= RCC_APB1ENR_PWREN;
  PWR->CR |= PWR_CR_DBP;

  if (RTC->BKP0R == DFU_BOOT_KEY || dfu_magic_flag == DFU_BOOT_KEY) {
    RTC->BKP0R = 0;
    dfu_magic_flag = 0;

    __disable_irq();

    SysTick->CTRL = 0;
    SysTick->LOAD = 0;
    SysTick->VAL = 0;

    for (int i = 0; i < 8; i++) {
      NVIC->ICER[i] = 0xFFFFFFFF;
      NVIC->ICPR[i] = 0xFFFFFFFF;
    }

    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER &= ~(3U << (10 * 2));
    GPIOA->PUPDR &= ~(3U << (10 * 2));
    GPIOA->PUPDR |= (2U << (10 * 2));

    RCC->APB2ENR |= RCC_APB2ENR_SYSCFGEN;
    SYSCFG->MEMRMP = 0x01;

    SCB->VTOR = 0x00000000;

    uint32_t bootloaderStack = *(volatile uint32_t *)0x1FFF0000;
    __set_MSP(bootloaderStack);

    void (*bootloaderJump)(void) =
        (void (*)(void))(*(volatile uint32_t *)0x1FFF0004);
    bootloaderJump();

    while (1)
      ;
  }
}

void enterDFUMode() {
  Serial.println("ENTERING_DFU_MODE");
  Serial.flush();
  delay(50);

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(160, 0, 255));
  }

  showSafe();
  delay(140);
  strip.clear();
  showSafe();

  RCC->APB1ENR |= RCC_APB1ENR_PWREN;
  PWR->CR |= PWR_CR_DBP;
  RTC->BKP0R = DFU_BOOT_KEY;
  dfu_magic_flag = DFU_BOOT_KEY;

  Serial.end();
  pinMode(PA12, OUTPUT);
  digitalWrite(PA12, LOW);
  pinMode(PA11, OUTPUT);
  digitalWrite(PA11, LOW);
  delay(350);

  NVIC_SystemReset();

  while (1)
    ;
}

// ---------------------------------------------------------------------------
// Memoria del pad: la config se guarda en flash (comando SAVE) y se carga al
// encender, asi el pad funciona igual sin la app abierta.
// Layout: [0]'S' [1]'B' [2]version [3]press [4]idle [5]blend [6]playing
//         [7]brillo [8]fn [9]barra [10]ritmo [11]luz FN apagada [12..15]reservado
//         [16 + i*5] r g b hasSound pressEffect+1   ...   [ultimo] checksum
// ---------------------------------------------------------------------------
#define CFG_VERSION 1
#define CFG_HDR 16
#define CFG_SIZE (CFG_HDR + NUM_LEDS * 5)

void saveConfigToFlash() {
  uint8_t data[CFG_SIZE];
  memset(data, 0, sizeof(data));
  data[0] = 'S';
  data[1] = 'B';
  data[2] = CFG_VERSION;
  data[3] = pressEffect;
  data[4] = idleEffect;
  data[5] = blendMode;
  data[6] = playingEffect;
  data[7] = currentBrightness;
  data[8] = fnKeyEnabled ? 1 : 0;
  data[9] = progressBarEnabled ? 1 : 0;
  data[10] = beatSyncEnabled ? 1 : 0;
  data[11] = fnLightOn ? 0 : 1;   // 0 = encendida (asi las configs viejas la dejan como antes)
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    uint8_t *p = &data[CFG_HDR + i * 5];
    p[0] = padLeds[i].r;
    p[1] = padLeds[i].g;
    p[2] = padLeds[i].b;
    p[3] = padLeds[i].hasSound ? 1 : 0;
    p[4] = (uint8_t)(padLeds[i].pressEffect + 1);
  }
  uint8_t sum = 0;
  for (uint16_t i = 0; i < CFG_SIZE; i++) sum += data[i];

  // Aviso visual: borrar el sector de flash congela el pad ~1 s
  for (uint16_t i = 0; i < NUM_LEDS; i++) strip.setPixelColor(i, strip.Color(0, 60, 25));
  strip.show();

  eeprom_buffer_fill();
  for (uint16_t i = 0; i < CFG_SIZE; i++) eeprom_buffered_write_byte(i, data[i]);
  eeprom_buffered_write_byte(CFG_SIZE, sum);
  eeprom_buffer_flush();
}

bool loadConfigFromFlash() {
  eeprom_buffer_fill();
  uint8_t data[CFG_SIZE];
  uint8_t sum = 0;
  for (uint16_t i = 0; i < CFG_SIZE; i++) {
    data[i] = eeprom_buffered_read_byte(i);
    sum += data[i];
  }
  if (data[0] != 'S' || data[1] != 'B' || data[2] != CFG_VERSION) return false;
  if (sum != eeprom_buffered_read_byte(CFG_SIZE)) return false;

  pressEffect = min((int)data[3], PRESS_EFFECT_MAX);
  idleEffect = min((int)data[4], IDLE_EFFECT_MAX);
  blendMode = min((int)data[5], 2);
  playingEffect = min((int)data[6], PLAYING_EFFECT_MAX);
  currentBrightness = constrain(data[7], 10, 255);
  fnKeyEnabled = data[8] != 0;
  progressBarEnabled = data[9] != 0;
  beatSyncEnabled = data[10] != 0;
  fnLightOn = data[11] == 0;
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    const uint8_t *p = &data[CFG_HDR + i * 5];
    padLeds[i].r = p[0];
    padLeds[i].g = p[1];
    padLeds[i].b = p[2];
    padLeds[i].hasSound = p[3] != 0;
    int pe = (int)p[4] - 1;
    padLeds[i].pressEffect = (pe >= 0 && pe <= PRESS_EFFECT_MAX) ? (int8_t)pe : -1;
  }
  strip.setBrightness(currentBrightness);
  return true;
}

static inline uint8_t hexNibble(char ch) {
  if (ch >= '0' && ch <= '9') return ch - '0';
  if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
  if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
  return 0;
}

// F <RRGGBB x NUM_LEDS><CC> en orden visual: fila por fila, de izquierda a derecha
// tal como el usuario ve el pad (igual que la grilla de la app). CC = suma de todos
// los bytes de color (mod 256): si el cuadro llega danado se descarta entero y el pad
// mantiene el anterior (antes un final danado pintaba la ultima fila de colores al azar).
void parseStreamFrame(const char *hex) {
  const size_t need = (size_t)NUM_LEDS * 6;
  if (strlen(hex) != need + 2) { statBadFrames++; return; }
  for (size_t i = 0; i < need + 2; i++) {
    if (!isxdigit((unsigned char)hex[i])) { statBadFrames++; return; }
  }
  RGBColor frame[NUM_LEDS];
  uint8_t sum = 0;
  for (uint8_t r = 0; r < ROWS; r++) {
    for (uint8_t vc = 0; vc < COLS; vc++) {
      const char *h = hex + ((uint16_t)r * COLS + vc) * 6;
      uint16_t idx = getLedIndex(r, (COLS - 1) - vc);
      frame[idx].r = (hexNibble(h[0]) << 4) | hexNibble(h[1]);
      frame[idx].g = (hexNibble(h[2]) << 4) | hexNibble(h[3]);
      frame[idx].b = (hexNibble(h[4]) << 4) | hexNibble(h[5]);
      sum += frame[idx].r + frame[idx].g + frame[idx].b;
    }
  }
  uint8_t check = (hexNibble(hex[need]) << 4) | hexNibble(hex[need + 1]);
  if (check != sum) { statBadFrames++; return; }
  memcpy(streamFrame, frame, sizeof(frame));
  lastStreamFrameMs = millis();
}

// Fila superior como barra de progreso del ultimo sonido que empezo a sonar
static void drawProgressBar(RGBColor *frame, unsigned long now) {
  int best = -1;
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    if (padLeds[i].isPlaying && padLeds[i].playDurationMs > 0 &&
        (best < 0 || padLeds[i].playStartTime > padLeds[best].playStartTime)) {
      best = i;
    }
  }
  if (best < 0) return;
  float p = (float)(now - padLeds[best].playStartTime) / (float)padLeds[best].playDurationMs;
  p = constrain(p, 0.0f, 1.0f);
  RGBColor col(padLeds[best].r, padLeds[best].g, padLeds[best].b);
  if (col.r == 0 && col.g == 0 && col.b == 0) col = RGBColor(0, 240, 255);
  float lit = p * (float)COLS;
  for (uint8_t vc = 0; vc < COLS; vc++) {
    float k = constrain(lit - (float)vc, 0.0f, 1.0f);
    k = 0.08f + 0.92f * k;
    frame[getLedIndex(0, (COLS - 1) - vc)] =
        RGBColor((uint8_t)(col.r * k), (uint8_t)(col.g * k), (uint8_t)(col.b * k));
  }
}

// Envia el frame a la tira limitando la corriente total estimada.
// Evita caidas de tension (brown-out) que provocan reinicios, desconexion USB
// y parpadeos cuando muchos pads se ponen en blanco a la vez.
void showSafe() {
  uint8_t *px = strip.getPixels();
  const uint16_t n = (uint16_t)NUM_LEDS * 3;
  uint32_t sum = 0;
  for (uint16_t i = 0; i < n; i++) sum += px[i];

  const uint32_t idleMa = (uint32_t)NUM_LEDS * LED_IDLE_MA;
  if (sum > 0 && POWER_LIMIT_MA > idleMa) {
    const uint32_t avail = (uint32_t)POWER_LIMIT_MA - idleMa;
    const uint32_t needed = (sum * LED_MA_PER_CHANNEL) / 255;
    if (needed > avail) {
      uint32_t scale256 = (avail * 255UL * 256UL) / (sum * LED_MA_PER_CHANNEL);
      if (scale256 > 256) scale256 = 256;
      for (uint16_t i = 0; i < n; i++) {
        px[i] = (uint8_t)(((uint32_t)px[i] * scale256) >> 8);
      }
    }
  }
  strip.show();
}

void playEpicStartupAnimation() {
  strip.setBrightness(255);

  float dists[ROWS][COLS];
  for (uint8_t r = 0; r < ROWS; r++) {
    for (uint8_t c = 0; c < COLS; c++) {
      float dr = (float)r - 3.5f;
      float dc = (float)c - 3.5f;
      dists[r][c] = sqrtf(dr * dr + dc * dc);
    }
  }

  strip.clear();
  for (uint8_t r = 3; r <= 4; r++) {
    for (uint8_t c = 3; c <= 4; c++) {
      strip.setPixelColor(getLedIndex(r, c), strip.Color(255, 255, 255));
    }
  }
  showSafe();
  delay(110);

  for (float radius = 0.6f; radius <= 5.4f; radius += 0.42f) {
    strip.clear();
    for (uint8_t r = 0; r < ROWS; r++) {
      for (uint8_t c = 0; c < COLS; c++) {
        float d = dists[r][c];
        float diff = fabsf(d - radius);
        if (diff < 1.05f) {
          float intensity = 1.0f - (diff / 1.05f);
          uint16_t hue = (uint16_t)(radius * 11500);
          uint32_t col = strip.ColorHSV(hue, 255, (uint8_t)(255 * intensity));
          strip.setPixelColor(getLedIndex(r, c), col);
        }
      }
    }
    showSafe();
    delay(20);
  }

  for (int step = 0; step < 18; step++) {
    float a1 = (float)step * 0.48f;
    float a2 = a1 + 3.14159f;
    float rad = 4.2f - ((float)step * 0.21f);

    strip.clear();
    for (int trail = 0; trail < 4; trail++) {
      float subA1 = a1 - ((float)trail * 0.28f);
      float subA2 = a2 - ((float)trail * 0.28f);
      int cr1 = (int)(3.5f + sinf(subA1) * rad + 0.5f);
      int cc1 = (int)(3.5f + cosf(subA1) * rad + 0.5f);
      int cr2 = (int)(3.5f + sinf(subA2) * rad + 0.5f);
      int cc2 = (int)(3.5f + cosf(subA2) * rad + 0.5f);

      uint8_t br = 255 / (trail + 1);
      if (cr1 >= 0 && cr1 < 8 && cc1 >= 0 && cc1 < 8) {
        strip.setPixelColor(getLedIndex(cr1, cc1), strip.Color(0, br, br));
      }
      if (cr2 >= 0 && cr2 < 8 && cc2 >= 0 && cc2 < 8) {
        strip.setPixelColor(getLedIndex(cr2, cc2),
                            strip.Color(br, 0, (uint8_t)(br * 0.75f)));
      }
    }
    showSafe();
    delay(25);
  }

  for (int d = -4; d <= 18; d += 2) {
    strip.clear();
    for (uint8_t r = 0; r < ROWS; r++) {
      for (uint8_t c = 0; c < COLS; c++) {
        int diag = r + c;
        if (diag == d || diag == d - 1) {
          strip.setPixelColor(getLedIndex(r, c), strip.Color(255, 255, 255));
        } else if (diag == d - 2 || diag == d - 3) {
          strip.setPixelColor(getLedIndex(r, c), strip.Color(0, 240, 255));
        } else if (diag == d - 4 || diag == d - 5) {
          strip.setPixelColor(getLedIndex(r, c), strip.Color(180, 0, 255));
        }
      }
    }
    showSafe();
    delay(18);
  }

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(255, 255, 255));
  }
  showSafe();
  delay(55);

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 180, 255));
  }
  showSafe();
  delay(350);

  for (int p = 0; p < 2; p++) {
    for (int b = 255; b >= 80; b -= 25) {
      for (uint16_t i = 0; i < NUM_LEDS; i++) {
        strip.setPixelColor(i, strip.Color(0, (uint8_t)(b * 180 / 255), b));
      }
      showSafe();
      delay(14);
    }
    for (int b = 80; b <= 255; b += 25) {
      for (uint16_t i = 0; i < NUM_LEDS; i++) {
        strip.setPixelColor(i, strip.Color(0, (uint8_t)(b * 180 / 255), b));
      }
      showSafe();
      delay(14);
    }
    delay(80);
  }

  for (int b = 255; b >= 0; b -= 18) {
    uint8_t bv = (b < 0) ? 0 : b;
    for (uint16_t i = 0; i < NUM_LEDS; i++) {
      strip.setPixelColor(i, strip.Color(0, (uint8_t)(bv * 180 / 255), bv));
    }
    showSafe();
    delay(16);
  }
  strip.clear();
  showSafe();

  strip.setBrightness(DEFAULT_BRIGHTNESS);
}

void setup() {
  checkDfuBootloader();

  Serial.begin(115200);

  for (uint8_t r = 0; r < ROWS; r++)
    pinMode(rowPins[r], INPUT);
  for (uint8_t c = 0; c < COLS; c++)
    pinMode(colPins[c], INPUT_PULLUP);

  for (uint8_t r = 0; r < ROWS; r++) {
    for (uint8_t c = 0; c < COLS; c++) {
      keyState[r][c] = false;
      rawKeyState[r][c] = false;
      rawChangeTime[r][c] = 0;
      reportedPressed[r][c] = false;
    }
  }

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    padLeds[i].r = 0;
    padLeds[i].g = 0;
    padLeds[i].b = 0;
    padLeds[i].hasSound = false;
    padLeds[i].isPlaying = false;
    padLeds[i].pressEffect = -1;
    padLeds[i].playStartTime = 0;
    padLeds[i].playDurationMs = 0;
  }

  for (int i = 0; i < MAX_ACTIVE_PRESS_EFFECTS; i++) {
    activePressEffects[i].active = false;
  }

  for (uint8_t c = 0; c < COLS; c++) {
    vuLevels[c] = 0;
  }

  lastActivityTime = millis();

  strip.begin();
  strip.clear();
  strip.show();

  playEpicStartupAnimation();
  loadConfigFromFlash();   // si hay una config guardada en el pad, usarla

  Serial.println("LAUNCHPAD_SOUNDBOARD_READY");
}

void loop() {
  readFastSerial();
  scanMatrixInstant();
  readFastSerial();   // vaciar la cola USB seguido para que nunca se llene
  renderAllEffects();
}

// Alcances de los efectos de pulsacion (iguales a la vista previa de la app)
#if COLS == 5
static const float PE_FLASH_POINT = 0.55f, PE_FLASH_SPREAD = 1.4f;
static const float PE_RIPPLE = 6.2f, PE_LASER = 6.2f, PE_STAR = 5.2f, PE_SPARK = 2.5f;
static const float PE_DIAMOND = 8.2f, PE_FIRE = 5.8f, PE_SPIRAL = 5.2f, PE_SHOCK = 6.4f;
static const float PE_RAINBOW = 5.8f, PE_NOVA1 = 4.8f, PE_NOVA2 = 7.2f, PE_CORE = 1.0f;
static const float PE_ARM = 5.2f, PE_ARC = 2.8f;
#else
static const float PE_FLASH_POINT = 0.7f, PE_FLASH_SPREAD = 1.9f;
static const float PE_RIPPLE = 9.5f, PE_LASER = 10.0f, PE_STAR = 8.0f, PE_SPARK = 3.8f;
static const float PE_DIAMOND = 12.5f, PE_FIRE = 9.0f, PE_SPIRAL = 8.0f, PE_SHOCK = 10.0f;
static const float PE_RAINBOW = 9.0f, PE_NOVA1 = 7.5f, PE_NOVA2 = 11.0f, PE_CORE = 1.5f;
static const float PE_ARM = 8.0f, PE_ARC = 4.2f;
#endif

void computePressEffect(const ActivePressEffect &eff, uint8_t r, uint8_t c, unsigned long nowTime,
                        float &outIntensity, uint8_t &outR, uint8_t &outG, uint8_t &outB) {
  outIntensity = 0.0f;
  outR = eff.colorR;
  outG = eff.colorG;
  outB = eff.colorB;

  float elapsed = (float)(nowTime - eff.startTime);
  float rawT = elapsed / (float)eff.duration;
  float t = constrain(rawT, 0.0f, 1.0f);
  float dr = (float)r - (float)eff.r;
  float dc = (float)eff.c - (float)c; // Visual X axis alignment (user view)
  float dist = sqrtf(dr * dr + dc * dc);

  switch (eff.id) {
    case 0: { // Direct Flash (Destello Blanco Pulsado)
      if (dist < PE_FLASH_POINT) {
        outIntensity = max(0.0f, 1.0f - t * 2.5f);
      } else if (dist < PE_FLASH_SPREAD) {
        outIntensity = max(0.0f, 0.45f * (1.0f - dist / PE_FLASH_SPREAD) * (1.0f - t * 2.0f));
      }
      outR = 255; outG = 255; outB = 255;
      break;
    }

    case 1: { // Ripple (Onda Expansiva Circular)
      float waveR = t * PE_RIPPLE;
      float diff = fabsf(dist - waveR);
      if (diff < 1.3f) {
        outIntensity = max(0.0f, (1.0f - diff / 1.3f) * (1.0f - t * 0.8f));
      }
      break;
    }

    case 2: { // Crosshair (Cruz Laser X-Y)
      bool inCross = (fabsf(dr) < 0.6f) || (fabsf(dc) < 0.6f);
      float laserDist = max(fabsf(dr), fabsf(dc));
      if (inCross && laserDist <= t * PE_LASER) {
        outIntensity = max(0.0f, 1.0f - t * 0.95f);
      }
      break;
    }

    case 3: { // Starburst (Estrella de 8 Rayos)
      float starR = t * PE_STAR;
      float diffDist = fabsf(dist - starR);
      if (diffDist < 1.2f) {
        float ptAngle = atan2f(dr, dc) * 180.0f / 3.14159265f;
        if (ptAngle < 0.0f) ptAngle += 360.0f;
        const float angles[8] = {0.0f, 45.0f, 90.0f, 135.0f, 180.0f, 225.0f, 270.0f, 315.0f};
        for (uint8_t a = 0; a < 8; a++) {
          float diffA = fabsf(ptAngle - angles[a]);
          if (diffA > 180.0f) diffA = 360.0f - diffA;
          if (diffA < 18.0f) {
            outIntensity = max(0.0f, (1.0f - diffA / 18.0f) * (1.0f - diffDist / 1.2f) * (1.0f - t));
            break;
          }
        }
      }
      break;
    }

    case 4: { // Lightning Storm (Chispazo Electrico Neon)
      bool flicker = sinf(t * 35.0f + eff.seed * 20.0f) > 0.0f;
      if (flicker && dist < PE_SPARK) {
        float hashVal = sinf((float)r * 12.9898f + (float)c * 78.233f + floorf(t * 12.0f)) * 43758.5453f;
        float frac = hashVal - floorf(hashVal);
        if (frac > 0.55f) {
          outIntensity = max(0.0f, 1.0f - t * 0.8f);
        }
      }
      break;
    }

    case 5: { // Crystal Diamond (Distancia Manhattan)
      float manhattan = fabsf(dr) + fabsf(dc);
      float diaR = t * PE_DIAMOND;
      float diff = fabsf(manhattan - diaR);
      if (diff < 1.2f) {
        outIntensity = max(0.0f, (1.0f - diff / 1.2f) * (1.0f - t * 0.85f));
      }
      break;
    }

    case 6: { // Volcanic Shockwave (Onda Ardiente)
      float waveR = t * PE_FIRE;
      float diff = fabsf(dist - waveR);
      if (diff < 1.4f) {
        outIntensity = max(0.0f, (1.0f - diff / 1.4f) * (1.0f - t * 0.85f));
        if (t < 0.4f) {
          outR = 255; outG = 204; outB = 0; // #ffcc00
        } else {
          outR = 255; outG = 69; outB = 0;   // #ff4500
        }
      }
      break;
    }

    case 7: { // Vortex Spiral (Galaxia Espiral)
      float angle = atan2f(dr, dc);
      if (angle < 0.0f) angle += 6.2831853f;
      float rot = fmodf(angle + t * 15.70796f + 12.56637f, 6.2831853f);
      float expectedDist = (rot / 6.2831853f) * PE_SPIRAL;
      float diff = fabsf(dist - expectedDist);
      if (diff < 1.4f) {
        outIntensity = max(0.0f, (1.0f - diff / 1.4f) * (1.0f - t * 0.9f));
      }
      break;
    }

    case 8: { // Hyper Neon Pulse (Anillo Doble)
      float r1 = t * PE_SHOCK;
      float r2 = max(0.0f, (t - 0.22f) * PE_SHOCK);
      float diff1 = fabsf(dist - r1);
      float diff2 = fabsf(dist - r2);
      float p1 = (diff1 < 1.2f) ? max(0.0f, (1.0f - diff1 / 1.2f) * (1.0f - t)) : 0.0f;
      float p2 = (diff2 < 1.2f) ? max(0.0f, (1.0f - diff2 / 1.2f) * (1.0f - t)) : 0.0f;
      outIntensity = max(p1, p2);
      if (t < 0.5f) {
        outR = (uint8_t)min(255, (int)(eff.colorR + 70));
        outG = (uint8_t)min(255, (int)(eff.colorG + 70));
        outB = (uint8_t)min(255, (int)(eff.colorB + 70));
      }
      break;
    }

    case 9: { // Quantum Prism (Destello Arcoiris)
      float waveR = t * PE_RAINBOW;
      float diff = fabsf(dist - waveR);
      if (diff < 1.3f) {
        outIntensity = max(0.0f, (1.0f - diff / 1.3f) * (1.0f - t * 0.85f));
        float ptAngle = atan2f(dr, dc) * 180.0f / 3.14159265f;
        if (ptAngle < 0.0f) ptAngle += 360.0f;
        uint16_t hueDeg = (uint16_t)(fmodf(t * 360.0f + ptAngle, 360.0f));
        uint32_t cCol = strip.ColorHSV((uint32_t)hueDeg * 182, 255, 255);
        outR = (uint8_t)(cCol >> 16);
        outG = (uint8_t)(cCol >> 8);
        outB = (uint8_t)cCol;
      }
      break;
    }

    case 10: { // Supernova Shockwave (Doble Anillo + Nucleo)
      float wave1 = t * PE_NOVA1;
      float wave2 = t * PE_NOVA2;
      float d1 = fabsf(dist - wave1);
      float d2 = fabsf(dist - wave2);
      float pCore = (dist < PE_CORE && t < 0.35f) ? (1.0f - t / 0.35f) : 0.0f;
      float p1 = (d1 < 1.2f) ? (1.0f - d1 / 1.2f) * (1.0f - t) : 0.0f;
      float p2 = (d2 < 1.2f) ? (1.0f - d2 / 1.2f) * (1.0f - t) : 0.0f;
      outIntensity = max(pCore, max(p1, p2));
      if (t < 0.25f) {
        outR = 255; outG = 255; outB = 255;
      } else {
        outR = 250; outG = 204; outB = 21; // #facc15
      }
      break;
    }

    case 11: { // Spiral Dimension (Rafaga Espiral)
      float angle = atan2f(dr, dc);
      if (angle < 0.0f) angle += 6.2831853f;
      float rot1 = fmodf(angle + t * 10.0f, 6.2831853f);
      float rot2 = fmodf(angle + 3.14159265f + t * 10.0f, 6.2831853f);
      float arm1 = (rot1 / 6.2831853f) * PE_ARM;
      float arm2 = (rot2 / 6.2831853f) * PE_ARM;
      float diff1 = fabsf(dist - arm1);
      float diff2 = fabsf(dist - arm2);
      float p1 = (diff1 < 1.3f) ? (1.0f - diff1 / 1.3f) * (1.0f - t) : 0.0f;
      float p2 = (diff2 < 1.3f) ? (1.0f - diff2 / 1.3f) * (1.0f - t) : 0.0f;
      outIntensity = max(p1, p2);
      break;
    }

    case 12: { // Tesla Arc (Arcos Voltaicos)
      float seedVal = eff.seed * 50.0f;
      bool inArc = (sinf(dist * 3.5f + t * 25.0f + seedVal) > 0.4f) && (dist < PE_ARC);
      if (inArc) {
        outIntensity = max(0.0f, 1.0f - t * 0.9f);
        if (fmodf(t * 20.0f, 2.0f) > 1.0f) {
          outR = 255; outG = 255; outB = 255;
        } else {
          outR = 56; outG = 189; outB = 248; // #38bdf8
        }
      }
      break;
    }

    default:
      if (eff.id >= 13) {
        FxPress po = fxPressExt(eff.id, t, dr, dc, dist, eff.seed, (float)eff.r, (float)eff.c,
                                (float)r, (float)c, (float)ROWS, (float)COLS);
        outIntensity = po.i;
        if (po.custom) { outR = po.r; outG = po.g; outB = po.b; }
      }
      break;
  }
}

void triggerPressEffect(uint8_t r, uint8_t c, uint16_t ledIdx, int forcedEffect) {
  lastActivityTime = millis();

  // Prioridad: efecto forzado (comando T) > efecto propio del pad > efecto global
  int chosen = forcedEffect;
  if (chosen < 0 && ledIdx < NUM_LEDS && padLeds[ledIdx].pressEffect >= 0 && padLeds[ledIdx].pressEffect <= PRESS_EFFECT_MAX) {
    chosen = padLeds[ledIdx].pressEffect;
  }
  uint8_t effId = (chosen >= 0) ? (uint8_t)chosen : pressEffect;
  if (effId > PRESS_EFFECT_MAX) effId = 1;

  uint8_t colorR = 0, colorG = 240, colorB = 255;
  if (ledIdx < NUM_LEDS &&
      (padLeds[ledIdx].r != 0 || padLeds[ledIdx].g != 0 || padLeds[ledIdx].b != 0)) {
    colorR = padLeds[ledIdx].r;
    colorG = padLeds[ledIdx].g;
    colorB = padLeds[ledIdx].b;
  }

  uint16_t dur = 900;
  if (effId == 0) dur = 380;
  else if (effId == 4 || effId == 12) dur = 650;
  else if (effId == 10 || effId == 11) dur = 1200;
  else if (effId >= 13) dur = fxPressDuration(effId);

  int slot = -1;
  unsigned long now = millis();
  unsigned long oldestAge = 0;
  int oldestSlot = 0;

  for (int i = 0; i < MAX_ACTIVE_PRESS_EFFECTS; i++) {
    if (!activePressEffects[i].active) {
      slot = i;
      break;
    }
    unsigned long age = now - activePressEffects[i].startTime; // seguro ante desborde de millis()
    if (age >= oldestAge) {
      oldestAge = age;
      oldestSlot = i;
    }
  }

  if (slot == -1) slot = oldestSlot;

  activePressEffects[slot].active = true;
  activePressEffects[slot].id = effId;
  activePressEffects[slot].r = r;
  activePressEffects[slot].c = c;
  activePressEffects[slot].colorR = colorR;
  activePressEffects[slot].colorG = colorG;
  activePressEffects[slot].colorB = colorB;
  activePressEffects[slot].startTime = now;
  activePressEffects[slot].duration = dur;
  activePressEffects[slot].seed = (float)random(0, 1000) / 1000.0f;
}

// Gestiona un cambio de estado YA filtrado de una tecla.
void handleKeyEvent(uint8_t r, uint8_t c, bool pressed, unsigned long now) {
  lastActivityTime = now;
  bool isFnKey = fnKeyEnabled && (r == ROWS - 1 && c == 0);

  if (!pressed) {
    // Toda tecla que envio "P" envia su "R", aunque FN haya cambiado entretanto.
    // (Antes, soltar una tecla con FN pulsado dejaba sonidos en modo HOLD pegados.)
    if (reportedPressed[r][c]) {
      reportedPressed[r][c] = false;
      Serial.print("R ");
      Serial.print(r);
      Serial.print(" ");
      Serial.println(c);
    }
    if (isFnKey) fnModeActive = false;
    return;
  }

  if (streamMode == 2) {
    // Control total de la app (juegos, secuenciador): se reportan todas las teclas, incluida FN
    reportedPressed[r][c] = true;
    Serial.print("P ");
    Serial.print(r);
    Serial.print(" ");
    Serial.println(c);
    return;
  }

  if (isFnKey) {
    fnModeActive = true;
    return;
  }

  if (fnModeActive) {
    if (r == 0) {
      uint8_t visualC = (COLS - 1) - c;
      if (visualC < totalBanksCount) {
        currentBankIndex = visualC;
        Serial.print("BANK_SET ");
        Serial.println(visualC);
      }
    }
    return;
  }

  uint16_t ledIdx = getLedIndex(r, c);
  reportedPressed[r][c] = true;
  triggerPressEffect(r, c, ledIdx);
  Serial.print("P ");
  Serial.print(r);
  Serial.print(" ");
  Serial.println(c);
}

void scanMatrixInstant() {
  unsigned long now = millis();

  for (uint8_t r = 0; r < ROWS; r++) {
    pinMode(rowPins[r], OUTPUT);
    digitalWrite(rowPins[r], LOW);
    for (uint8_t c = 0; c < COLS; c++)
      pinMode(colPins[c], INPUT_PULLUP);
    delayMicroseconds(8);

    for (uint8_t c = 0; c < COLS; c++) {
      // Lectura bidireccional original (soporta diodos en ambos sentidos)
      bool isPressed = (digitalRead(colPins[c]) == LOW);

      if (!isPressed) {
        digitalWrite(rowPins[r], HIGH);
        pinMode(colPins[c], INPUT_PULLDOWN);
        delayMicroseconds(8);
        if (digitalRead(colPins[c]) == HIGH) {
          isPressed = true;
        }
        digitalWrite(rowPins[r], LOW);
        pinMode(colPins[c], INPUT_PULLUP);
      }

      // Antirrebote por estabilidad: la lectura cruda debe mantenerse igual
      // DEBOUNCE_*_MS antes de aceptarse. Un glitch aislado ya no genera "P".
      if (isPressed != rawKeyState[r][c]) {
        rawKeyState[r][c] = isPressed;
        rawChangeTime[r][c] = now;
      }

      if (isPressed != keyState[r][c]) {
        unsigned long need = isPressed ? DEBOUNCE_PRESS_MS : DEBOUNCE_RELEASE_MS;
        if ((now - rawChangeTime[r][c]) >= need) {
          keyState[r][c] = isPressed;
          handleKeyEvent(r, c, isPressed, now);
        }
      }
    }

    pinMode(rowPins[r], INPUT);
  }

  static unsigned long dfuComboStartTime = 0;
  if (keyState[0][DFU_COMBO_COL_A] && keyState[0][DFU_COMBO_COL_B]) {
    if (dfuComboStartTime == 0) {
      dfuComboStartTime = now | 1UL; // nunca 0 (0 = combo inactivo)
    } else if (now - dfuComboStartTime >= 3000) {
      enterDFUMode();
    }
  } else {
    dfuComboStartTime = 0;
  }
}

// Color de un pad mientras su sonido se reproduce (comando Y elige el modo)
static RGBColor playingColor(uint16_t i, RGBColor base, unsigned long now) {
  RGBColor pc(padLeds[i].r, padLeds[i].g, padLeds[i].b);
  if (pc.r == 0 && pc.g == 0 && pc.b == 0) pc = RGBColor(0, 240, 255);
  float ts = (float)(now - padLeds[i].playStartTime) * 0.001f;
  switch (playingEffect) {
    case 1: { // Respiracion
      float k = 0.25f + 0.75f * (0.5f + 0.5f * sinf(ts * 6.0f));
      return RGBColor(fx_byte(pc.r * k), fx_byte(pc.g * k), fx_byte(pc.b * k));
    }
    case 2: // Arcoiris
      return hslToRgb(ts * 240.0f + (float)i * 10.0f, 1.0f, 0.5f);
    case 3: { // Latido
      float ph = fx_mod(ts, 0.9f) / 0.9f;
      float beat = fmaxf(fmaxf(0.0f, 1.0f - fabsf(ph - 0.08f) / 0.08f),
                         fmaxf(0.0f, 1.0f - fabsf(ph - 0.32f) / 0.10f) * 0.75f);
      float k = 0.2f + 0.8f * beat;
      return RGBColor(fx_byte(pc.r * k + 255.0f * beat * 0.3f), fx_byte(pc.g * k + 255.0f * beat * 0.3f),
                      fx_byte(pc.b * k + 255.0f * beat * 0.3f));
    }
    case 4: // Parpadeo de color
      return (fx_fract(ts * 4.0f) < 0.5f) ? pc : RGBColor(0, 0, 0);
    case 5: { // Cuenta regresiva
      if (padLeds[i].playDurationMs == 0) {
        float k = 0.25f + 0.75f * (0.5f + 0.5f * sinf(ts * 6.0f));
        return RGBColor(fx_byte(pc.r * k), fx_byte(pc.g * k), fx_byte(pc.b * k));
      }
      float remain = 1.0f - (ts * 1000.0f) / (float)padLeds[i].playDurationMs;
      remain = constrain(remain, 0.0f, 1.0f);
      float k = 0.12f + 0.88f * remain;
      if (remain < 0.15f && fx_fract(ts * 6.0f) < 0.5f) k *= 0.3f;
      return RGBColor(fx_byte(pc.r * k), fx_byte(pc.g * k), fx_byte(pc.b * k));
    }
    case 6: { // Brillo suave
      float k = (0.5f + 0.5f * sinf(ts * 8.0f)) * 0.7f;
      return RGBColor(fx_byte(pc.r + (255 - pc.r) * k), fx_byte(pc.g + (255 - pc.g) * k), fx_byte(pc.b + (255 - pc.b) * k));
    }
    case 8: { // Nivel de audio: el brillo del pad sigue al sonido (comando V)
      float lvl = 0.0f;
      for (uint8_t k = 0; k < 8; k++) lvl += fxVu[k];
      lvl = fminf(1.0f, lvl / 8.0f * 2.2f);
      float k = 0.10f + 0.90f * lvl;
      return RGBColor(fx_byte(pc.r * k), fx_byte(pc.g * k), fx_byte(pc.b * k));
    }
    case 7: // Sin efecto
      return base;
    default: // 0: destello blanco clasico
      return flashToggle ? RGBColor(255, 255, 255) : base;
  }
}

void renderAllEffects() {
  unsigned long now = millis();
  static unsigned long lastRenderTime = 0;
  if (now - lastRenderTime < 16)
    return;
  lastRenderTime = now;
  uint32_t renderStartUs = micros();

  if (streamMode != 0 && (now - lastStreamFrameMs) > STREAM_TIMEOUT_MS) {
    streamMode = 0;   // la app dejo de enviar cuadros: volver a lo normal
  }
  if (streamMode == 2) {
    for (uint16_t i = 0; i < NUM_LEDS; i++) {
      strip.setPixelColor(i, strip.Color(streamFrame[i].r, streamFrame[i].g, streamFrame[i].b));
    }
    statRenderUs = micros() - renderStartUs;
    statFrames++;
    showSafe();
    return;
  }

  RGBColor animFrame[NUM_LEDS];
  RGBColor finalFrame[NUM_LEDS];

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    animFrame[i] = {0, 0, 0};
  }
  if (streamMode == 1) {
    // la app dibuja el fondo (se combina mas abajo)
  } else if (idleEffect > 0) {
    for (uint8_t r = 0; r < ROWS; r++) {
      for (uint8_t c = 0; c < COLS; c++) {
        uint16_t idx = getLedIndex(r, c);
        uint8_t visualC = (COLS - 1) - c;
        animFrame[idx] = computeIdleLedColor(r, visualC, idleEffect, now, ROWS, COLS);
      }
    }
  }

  // Pulso al ritmo: la app envia "U" en cada golpe; el fondo late y se apaga entre golpes
  beatLevel *= 0.82f;
  if (beatSyncEnabled && streamMode == 0 && (now - lastBeatMs) < 2500) {
    float k = 0.30f + 0.70f * beatLevel;
    for (uint16_t i = 0; i < NUM_LEDS; i++) {
      animFrame[i] = RGBColor((uint8_t)(animFrame[i].r * k), (uint8_t)(animFrame[i].g * k),
                              (uint8_t)(animFrame[i].b * k));
    }
  }

  bool isScreensaverActive =
      (blendMode == 2) && ((now - lastActivityTime) > SLEEP_TIMEOUT_MS);

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    bool isSoundPad =
        padLeds[i].hasSound &&
        (padLeds[i].r > 0 || padLeds[i].g > 0 || padLeds[i].b > 0);
    RGBColor anim = animFrame[i];

    if (streamMode == 1) {
      // Creacion de la app (texto, dibujo, pantalla): lo dibujado tapa al pad
      // y donde no hay dibujo se ve el color del boton
      const RGBColor &s = streamFrame[i];
      if (s.r > 10 || s.g > 10 || s.b > 10) {
        finalFrame[i] = s;
      } else if (isSoundPad) {
        finalFrame[i] = {padLeds[i].r, padLeds[i].g, padLeds[i].b};
      } else {
        finalFrame[i] = {0, 0, 0};
      }
      continue;
    }

    if (idleEffect == 0 && streamMode == 0) {
      finalFrame[i] = {padLeds[i].r, padLeds[i].g, padLeds[i].b};
      continue;
    }

    if (isScreensaverActive) {
      finalFrame[i] = anim;
    } else if (blendMode == 0 || blendMode == 2) {
      if (isSoundPad) {
        // Fusion Neon: la animacion modula el brillo del pad como una ola de luz.
        // La luminancia de la animacion escala el pad entre 0.5x (oscuro) y 1.3x (brillante),
        // mas un tinte aditivo sutil para que el color del fondo se mezcle levemente.
        float animLuma = ((float)anim.r * 0.299f + (float)anim.g * 0.587f + (float)anim.b * 0.114f) / 255.0f;
        float scale = 0.50f + animLuma * 0.80f; // rango 0.50x a 1.30x
        uint8_t cr = (uint8_t)min(255, (int)((float)padLeds[i].r * scale) + (int)(anim.r * 0.15f));
        uint8_t cg = (uint8_t)min(255, (int)((float)padLeds[i].g * scale) + (int)(anim.g * 0.15f));
        uint8_t cb = (uint8_t)min(255, (int)((float)padLeds[i].b * scale) + (int)(anim.b * 0.15f));
        finalFrame[i] = {cr, cg, cb};
      } else {
        finalFrame[i] = anim;
      }
    } else { // blendMode == 1 (Botones Puros)
      if (isSoundPad) {
        finalFrame[i] = {padLeds[i].r, padLeds[i].g, padLeds[i].b};
      } else {
        finalFrame[i] = anim;
      }
    }
  }

  // Efectos de pulsacion activos, sumados de forma aditiva
  for (int e = 0; e < MAX_ACTIVE_PRESS_EFFECTS; e++) {
    if (!activePressEffects[e].active) continue;
    if (now - activePressEffects[e].startTime >= activePressEffects[e].duration) {
      activePressEffects[e].active = false;
      continue;
    }

    for (uint8_t r = 0; r < ROWS; r++) {
      for (uint8_t c = 0; c < COLS; c++) {
        float intensity = 0.0f;
        uint8_t pR = 0, pG = 0, pB = 0;
        computePressEffect(activePressEffects[e], r, c, now, intensity, pR, pG, pB);
        if (intensity > 0.005f) {
          uint16_t idx = getLedIndex(r, c);
          float iClamped = constrain(intensity, 0.0f, 1.0f);
          uint16_t addR = (uint16_t)((float)pR * iClamped);
          uint16_t addG = (uint16_t)((float)pG * iClamped);
          uint16_t addB = (uint16_t)((float)pB * iClamped);
          finalFrame[idx].r = (uint8_t)min(255, (int)finalFrame[idx].r + addR);
          finalFrame[idx].g = (uint8_t)min(255, (int)finalFrame[idx].g + addG);
          finalFrame[idx].b = (uint8_t)min(255, (int)finalFrame[idx].b + addB);
        }
      }
    }
  }

  if (now - lastFlashTime >= 100) {
    lastFlashTime = now;
    flashToggle = !flashToggle;
  }
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    if (padLeds[i].isPlaying) {
      finalFrame[i] = playingColor(i, finalFrame[i], now);
    }
  }

  if (progressBarEnabled && !fnModeActive) {
    drawProgressBar(finalFrame, now);
  }

  if (fnModeActive) {
    for (uint16_t i = 0; i < NUM_LEDS; i++) {
      finalFrame[i] = {
        (uint8_t)(finalFrame[i].r / 8),
        (uint8_t)(finalFrame[i].g / 8),
        (uint8_t)(finalFrame[i].b / 8)
      };
    }
    uint16_t fnIdx = getLedIndex(ROWS - 1, 0);
    finalFrame[fnIdx] = {168, 85, 247}; // Purpura neon brillante para FN

    for (uint8_t vc = 0; vc < COLS; vc++) {
      uint8_t physC = (COLS - 1) - vc;
      uint16_t ledIdx = getLedIndex(0, physC);
      if (vc < totalBanksCount) {
        if (vc == currentBankIndex) {
          finalFrame[ledIdx] = {0, 255, 120}; // Capa activa en verde neon
        } else {
          finalFrame[ledIdx] = {255, 255, 255}; // Capas disponibles en blanco puro
        }
      } else {
        finalFrame[ledIdx] = {0, 0, 0};
      }
    }
  } else if (fnKeyEnabled && fnLightOn) {
    uint16_t fnIdx = getLedIndex(ROWS - 1, 0);
    const RGBColor &s = streamFrame[fnIdx];
    bool creationLit = (streamMode == 1) && (s.r > 10 || s.g > 10 || s.b > 10);
    if (!creationLit) finalFrame[fnIdx] = {75, 25, 120}; // Indicador tenue de tecla FN en reposo
  }

  if (!fnModeActive) {
    for (uint8_t r = 0; r < ROWS; r++) {
      for (uint8_t c = 0; c < COLS; c++) {
        if (keyState[r][c]) {
          uint16_t idx = getLedIndex(r, c);
          finalFrame[idx] = {255, 255, 255};
        }
      }
    }
  }

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(
        i, strip.Color(finalFrame[i].r, finalFrame[i].g, finalFrame[i].b));
  }
  statRenderUs = micros() - renderStartUs;
  if (statRenderUs > statRenderMaxUs) statRenderMaxUs = statRenderUs;
  statFrames++;
  showSafe();
}

void readFastSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBufIdx > 0 && !serialOverflow) {
        serialBuf[serialBufIdx] = '\0';
        handleCommand(serialBuf);
      }
      serialBufIdx = 0;
      serialOverflow = false;
    } else if (serialOverflow) {
      // descartar el resto de una linea demasiado larga
    } else if (serialBufIdx < sizeof(serialBuf) - 1) {
      serialBuf[serialBufIdx++] = c;
    } else {
      serialOverflow = true; // la linea completa se descarta (antes se ejecutaba su cola)
      serialBufIdx = 0;
    }
  }
}

static inline uint8_t clampByte(int v) {
  return (uint8_t)constrain(v, 0, 255);
}

static void clearPad(uint16_t idx) {
  padLeds[idx].r = 0;
  padLeds[idx].g = 0;
  padLeds[idx].b = 0;
  padLeds[idx].hasSound = false;
  padLeds[idx].isPlaying = false;
  padLeds[idx].pressEffect = -1;
}

void handleCommand(char *buf) {
  if (strcmp(buf, "PING") == 0) {
    Serial.println("PONG");
    lastActivityTime = millis();
    return;
  }

  if (strcmp(buf, "INFO") == 0) {
    Serial.print("INFO LAUNCHPAD ");
    Serial.print(PAD_MODEL);
    Serial.print(" FW ");
    Serial.println(FW_VERSION);
    return;
  }

  if (strcmp(buf, "STATS") == 0) {
    // Tiempo de calculo del ultimo frame (sin contar el envio a la tira) y maximo desde el ultimo STATS
    Serial.print("STATS render_us=");
    Serial.print(statRenderUs);
    Serial.print(" max_us=");
    Serial.print(statRenderMaxUs);
    Serial.print(" frames=");
    Serial.print(statFrames);
    Serial.print(" bad_frames=");
    Serial.println(statBadFrames);
    statRenderMaxUs = 0;
    return;
  }

  if (strcmp(buf, "SAVE") == 0) {
    saveConfigToFlash();
    Serial.println("SAVED");
    lastActivityTime = millis();
    return;
  }

  if (strcmp(buf, "DFU") == 0 || strcmp(buf, "BOOTLOADER") == 0) {
    enterDFUMode();
    return;
  }

  char type = buf[0];

  if (type == 'C') {
    // C idx r g b [hasSound] [pressEffect(-1 = global)]
    int idx, r, g, b, hs = 1, pe = -1;
    int parsed = sscanf(buf, "C %d %d %d %d %d %d", &idx, &r, &g, &b, &hs, &pe);
    if (parsed >= 4) {
      if (idx >= 0 && idx < NUM_LEDS) {
        padLeds[idx].r = clampByte(r);
        padLeds[idx].g = clampByte(g);
        padLeds[idx].b = clampByte(b);
        padLeds[idx].hasSound =
            (parsed >= 5) ? (hs != 0) : (r > 0 || g > 0 || b > 0);
        padLeds[idx].pressEffect = (parsed >= 6 && pe >= 0 && pe <= PRESS_EFFECT_MAX) ? (int8_t)pe : -1;
        padLeds[idx].isPlaying = false;
        lastActivityTime = millis();
      }
    }
  } else if (type == 'A') {
    // A idx 0/1 [duracionMs]
    int idx, mode, durMs = 0;
    if (sscanf(buf, "A %d %d %d", &idx, &mode, &durMs) >= 2) {
      if (idx >= 0 && idx < NUM_LEDS) {
        if (mode == 1) {
          padLeds[idx].isPlaying = true;
          padLeds[idx].playStartTime = millis();
          padLeds[idx].playDurationMs = (durMs > 0) ? (uint32_t)durMs : 0;
        } else {
          padLeds[idx].isPlaying = false;
        }
        lastActivityTime = millis();
      }
    }
  } else if (type == 'M') {
    int bm;
    if (sscanf(buf, "M %d", &bm) == 1) {
      blendMode = constrain(bm, 0, 2);
      lastActivityTime = millis();
    }
  } else if (type == 'E') {
    int pe, ie, bm = -1;
    int count = sscanf(buf, "E %d %d %d", &pe, &ie, &bm);
    if (count >= 2) {
      pressEffect = constrain(pe, 0, PRESS_EFFECT_MAX);
      idleEffect = constrain(ie, 0, IDLE_EFFECT_MAX);
      if (count >= 3 && bm >= 0) {
        blendMode = constrain(bm, 0, 2);
      }
      lastActivityTime = millis();
    }
  } else if (type == 'L') {
    int tb = 1, cb = 0, fnEn = 1;
    int count = sscanf(buf, "L %d %d %d", &tb, &cb, &fnEn);
    if (count >= 2) {
      totalBanksCount = constrain(tb, 1, COLS);
      currentBankIndex = constrain(cb, 0, totalBanksCount - 1);
      if (count >= 3) {
        fnKeyEnabled = (fnEn != 0);
        if (!fnKeyEnabled) fnModeActive = false; // evita quedar atrapado en modo FN
      }
      lastActivityTime = millis();
    }
  } else if (type == 'Y') {
    int pm;
    if (sscanf(buf, "Y %d", &pm) == 1) {
      playingEffect = constrain(pm, 0, PLAYING_EFFECT_MAX);
      lastActivityTime = millis();
    }
  } else if (type == 'W') {
    lastActivityTime = millis();
  } else if (type == 'T') {
    int tr, tc, te = -1;
    int count = sscanf(buf, "T %d %d %d", &tr, &tc, &te);
    if (count >= 2 && tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS) {
      uint16_t ledIdx = getLedIndex(tr, tc);
      triggerPressEffect(tr, tc, ledIdx, (count >= 3 && te >= 0) ? te : -1);
      lastActivityTime = millis();
    }
  } else if (type == 'V') {
    // V v0..v7 (0-8 por banda). El 5x5 usa las primeras 5 bandas.
    int v[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    int parsed = sscanf(buf, "V %d %d %d %d %d %d %d %d", &v[0], &v[1], &v[2], &v[3],
                        &v[4], &v[5], &v[6], &v[7]);
    if (parsed >= COLS) {
      for (uint8_t c = 0; c < COLS; c++)
        vuLevels[c] = constrain(v[c], 0, 8);
      for (uint8_t k = 0; k < 8; k++)
        fxVu[k] = (k < parsed) ? (float)constrain(v[k], 0, 8) / 8.0f : 0.0f;
    }
  } else if (type == 'K') {
    int idx;
    if (sscanf(buf, "K %d", &idx) == 1) {
      if (idx >= 0 && idx < NUM_LEDS) {
        clearPad(idx);
        lastActivityTime = millis();
      }
    }
  } else if (type == 'B') {
    int br;
    if (sscanf(buf, "B %d", &br) == 1) {
      currentBrightness = constrain(br, 10, 255);
      strip.setBrightness(currentBrightness);
      lastActivityTime = millis();
    }
  } else if (type == 'F') {
    // F <hex>: cuadro completo dibujado por la app
    if (buf[1] == ' ') parseStreamFrame(buf + 2);
  } else if (type == 'G') {
    // G 0/1/2: modo de dibujo de la app (0 normal, 1 creacion de fondo, 2 juego/ritmos)
    int m;
    if (sscanf(buf, "G %d", &m) == 1) {
      streamMode = constrain(m, 0, 2);
      lastStreamFrameMs = millis();
      if (streamMode == 2) fnModeActive = false;
    }
  } else if (type == 'U') {
    // U <0-255>: golpe de ritmo detectado por la app
    int s;
    if (sscanf(buf, "U %d", &s) == 1) {
      beatLevel = fmaxf(beatLevel, constrain(s, 0, 255) / 255.0f);
      lastBeatMs = millis();
    }
  } else if (type == 'H') {
    int v;
    if (sscanf(buf, "H %d", &v) == 1) beatSyncEnabled = (v != 0);
  } else if (type == 'O') {
    int v;
    if (sscanf(buf, "O %d", &v) == 1) progressBarEnabled = (v != 0);
  } else if (type == 'N') {
    // N 0/1: luz tenue de la tecla FN en reposo (la tecla sigue funcionando igual)
    int v;
    if (sscanf(buf, "N %d", &v) == 1) fnLightOn = (v != 0);
  } else if (type == 'X') {
    for (uint16_t i = 0; i < NUM_LEDS; i++) {
      clearPad(i);
    }
    lastActivityTime = millis();
  }
}
