# -*- coding: utf-8 -*-
"""Catalogo de efectos nuevos (fuente unica para firmware C y app JS).

Sintaxis comun de los cuerpos:
  VAR x = expr;      declara un float
  x = expr;          reasigna
  if (...) { ... }   (siempre con llaves)
  for (VAR k = 0.0; k < 3.0; k = k + 1.0) { ... }
  return RGB(r,g,b) | HSL(h,s,l) | HSLK(h,s,l,k)        (idle)
  return FX(i) | FXC(i,r,g,b) | FXH(i,hue)               (pulsacion)
Funciones: SIN COS SQRT ABS FLOOR FRACT MOD MIN MAX POW ATAN2 HASH HASH2 VU
Variables idle:  r c rows cols t R8 C8 (coords normalizadas a 0..7) CR CC LEVEL BASS
Variables press: T DR DC DIST SEED ER EC r c rows cols KS (0.65 en 5x5)
"""

# ---------------------------------------------------------------- IDLE ----
# (id, categoria, nombre, badge, descripcion, cuerpo)
IDLE = [
(17, 'nature', 'Starfield', 'ESTRELLAS', 'Cielo nocturno con estrellas titilando', """
VAR ph = HASH2(r, c);
VAR sp = 0.6 + HASH2(r + 17.0, c + 31.0) * 1.4;
VAR tw = MAX(0.0, SIN(t * sp * 3.0 + ph * 6.2832));
VAR b = POW(tw, 6.0);
VAR warm = HASH2(r + 5.0, c + 9.0);
return RGB(8.0 + b * (200.0 + warm * 55.0), 10.0 + b * (210.0 + warm * 30.0), 26.0 + b * 229.0);
"""),
(18, 'nature', 'Thunderstorm', 'TORMENTA', 'Nubes oscuras con relampagos al azar', """
VAR slot = FLOOR(t * 1.1);
VAR f = FRACT(t * 1.1);
VAR strike = HASH(slot);
VAR base = 0.4 + 0.2 * SIN(t * 0.7 + C8 * 0.6 + R8 * 0.3);
VAR flash = 0.0;
if (strike > 0.55) {
  VAR fl1 = MAX(0.0, 1.0 - f * 9.0);
  VAR fl2 = (f > 0.16) ? MAX(0.0, 1.0 - (f - 0.16) * 12.0) : 0.0;
  flash = MAX(fl1, fl2 * 0.8);
  VAR boltC = FLOOR(HASH(slot + 7.0) * 8.0);
  VAR near = MAX(0.0, 1.0 - ABS(C8 - boltC - SIN(R8 * 1.7 + slot) * 0.8) * 0.6);
  flash = flash * (0.35 + 0.65 * near);
}
return RGB(8.0 * base + flash * 230.0, 11.0 * base + flash * 235.0, 28.0 * base + flash * 255.0);
"""),
(19, 'psycho', 'DNA Helix', 'ADN', 'Doble helice girando en 3D', """
VAR ph = t * 2.2 + R8 * 0.85;
VAR amp = 2.95;
VAR x1 = 3.5 + SIN(ph) * amp;
VAR x2 = 3.5 - SIN(ph) * amp;
VAR depth = COS(ph);
VAR b1 = MAX(0.0, 1.0 - ABS(C8 - x1) * 0.8) * (0.55 + 0.45 * depth);
VAR b2 = MAX(0.0, 1.0 - ABS(C8 - x2) * 0.8) * (0.55 - 0.45 * depth);
VAR rung = 0.0;
if (MOD(r + FLOOR(t * 2.0), 2.0) < 1.0 && C8 > MIN(x1, x2) && C8 < MAX(x1, x2)) {
  rung = 0.18;
}
return RGB(b2 * 255.0 + rung * 120.0, b1 * 230.0 + rung * 120.0, b1 * 255.0 + b2 * 200.0 + rung * 160.0);
"""),
(20, 'retro', 'Radar', 'RADAR', 'Barrido de radar con blancos detectados', """
VAR dx = C8 - 3.5;
VAR dy = R8 - 3.5;
VAR ang = ATAN2(dy, dx);
VAR sweep = MOD(t * 2.4, 6.2832);
VAR diff = MOD(sweep - ang, 6.2832);
VAR trail = MAX(0.0, 1.0 - diff / 2.2);
VAR blip = 0.0;
VAR bh = HASH2(r * 3.0 + FLOOR(t * 0.25), c * 7.0);
if (bh > 0.92) {
  blip = 0.3 + 0.7 * MAX(0.0, 1.0 - diff / 4.0);
}
VAR g = trail * trail;
return RGB(blip * 255.0, 20.0 + g * 235.0 + blip * 80.0, 8.0 + g * 60.0 + blip * 40.0);
"""),
(21, 'nature', 'Snowfall', 'NIEVE', 'Copos de nieve cayendo suavemente', """
VAR sp = 0.9 + HASH(c * 13.0) * 0.9;
VAR off = HASH(c * 29.0 + 3.0) * 20.0;
VAR wrap = rows + 2.5;
VAR p1 = MOD(t * sp * 1.6 + off, wrap) - 1.0;
VAR p2 = MOD(t * sp * 1.6 + off + wrap * 0.5, wrap) - 1.0;
VAR d = MIN(ABS(r - p1), ABS(r - p2));
VAR b = MAX(0.0, 1.0 - d * 1.4);
VAR ground = (r == rows - 1.0) ? 0.18 : 0.0;
return RGB(10.0 + b * 220.0 + ground * 200.0, 14.0 + b * 225.0 + ground * 210.0, 30.0 + b * 225.0 + ground * 225.0);
"""),
(22, 'nature', 'Rain Drops', 'LLUVIA', 'Gotas cayendo sobre un lago', """
VAR best = 0.0;
for (VAR k = 0.0; k < 3.0; k = k + 1.0) {
  VAR ph = t / 1.6 + k * 0.333;
  VAR slot = FLOOR(ph);
  VAR f = FRACT(ph);
  VAR cx = FLOOR(HASH(slot * 3.0 + k * 101.0) * 8.0);
  VAR cy = FLOOR(HASH(slot * 5.0 + k * 57.0 + 11.0) * 8.0);
  VAR d = SQRT((R8 - cy) * (R8 - cy) + (C8 - cx) * (C8 - cx));
  VAR ring = f * 5.5;
  VAR w = MAX(0.0, 1.0 - ABS(d - ring) * 0.9) * (1.0 - f);
  best = MAX(best, w);
}
return RGB(4.0 + best * 90.0, 20.0 + best * 170.0, 50.0 + best * 205.0);
"""),
(23, 'nature', 'Northern Lights', 'BOREAL', 'Cortinas de aurora boreal verde y violeta', """
VAR band = SIN(C8 * 0.55 + t * 0.6) + 0.6 * SIN(C8 * 1.27 - t * 0.9 + 1.3);
VAR top = 1.0 - R8 / 7.0;
VAR curtain = MAX(0.0, 1.0 - ABS(top - (0.55 + band * 0.22)) * 2.6);
VAR shimmer = 0.75 + 0.25 * SIN(t * 3.1 + C8 * 1.7 + R8 * 0.4);
VAR hue = 120.0 + band * 40.0 + top * 80.0;
return HSLK(hue, 1.0, 0.5, curtain * shimmer);
"""),
(24, 'energy', 'Magma', 'MAGMA', 'Roca fundida burbujeando', """
VAR dc = SQRT((R8 - 3.5) * (R8 - 3.5) + (C8 - 3.5) * (C8 - 3.5));
VAR v = SIN(C8 * 0.7 + t * 0.8) + SIN(R8 * 0.9 - t * 0.6) + SIN((R8 + C8) * 0.45 + t * 1.1) + SIN(dc * 1.3 - t * 1.4);
VAR n = (v + 4.0) / 8.0;
VAR heat = POW(MAX(0.0, n), 1.6);
return RGB(60.0 + heat * 195.0, heat * heat * 170.0, heat * heat * heat * 40.0);
"""),
(25, 'retro', 'Checker Pulse', 'TABLERO', 'Tablero de ajedrez que alterna colores', """
VAR chk = MOD(r + c + FLOOR(t * 1.5), 2.0);
VAR hue = MOD(t * 40.0, 360.0) + chk * 180.0;
VAR br = 0.35 + 0.15 * SIN(t * 4.712);
return HSL(hue, 1.0, 0.06 + chk * br);
"""),
(26, 'retro', 'KITT Scanner', 'SCANNER', 'Barrido rojo ida y vuelta estilo auto fantastico', """
VAR pos = (SIN(t * 2.6) * 0.5 + 0.5) * 7.0;
VAR d = C8 - pos;
VAR dir = COS(t * 2.6);
VAR trail = (d * dir < 0.0) ? MAX(0.0, 1.0 - ABS(d) / 3.2) : MAX(0.0, 1.0 - ABS(d) / 0.9);
VAR rowMask = (ABS(R8 - 3.5) < 1.2) ? 1.0 : 0.22;
VAR b = POW(trail, 1.5) * rowMask;
return RGB(18.0 + b * 237.0, b * 30.0, b * 12.0);
"""),
(27, 'retro', 'Retro Snake', 'SNAKE', 'La viborita clasica recorriendo la grilla', """
VAR n = rows * cols;
VAR idx = (MOD(r, 2.0) < 1.0) ? (r * cols + c) : (r * cols + (cols - 1.0 - c));
VAR step = FLOOR(t * 9.0);
VAR head = MOD(step, n);
VAR behind = MOD(head - idx + n, n);
VAR len = (cols == 5.0) ? 5.0 : 9.0;
VAR food = FLOOR(HASH(FLOOR(step / n)) * n);
if (behind < len) {
  VAR k = 1.0 - behind / len;
  return HSL(MOD(100.0 + behind * 12.0, 360.0), 1.0, 0.18 + 0.4 * k);
}
if (idx == food) {
  VAR blink = (FRACT(t * 3.0) < 0.5) ? 1.0 : 0.5;
  return RGB(255.0 * blink, 40.0 * blink, 60.0 * blink);
}
return RGB(3.0, 6.0, 10.0);
"""),
(28, 'energy', 'Confetti', 'CONFETI', 'Destellos de colores apareciendo al azar', """
VAR off = HASH2(r, c) * 3.0;
VAR slot = FLOOR(t * 3.0 + off);
VAR f = FRACT(t * 3.0 + off);
VAR on = HASH2(r * 31.0 + slot, c * 17.0);
if (on > 0.72) {
  VAR hue = HASH2(slot, r * 8.0 + c) * 360.0;
  return HSLK(hue, 1.0, 0.5, 1.0 - f);
}
return RGB(4.0, 4.0, 8.0);
"""),
(29, 'fluid', 'Heartbeat', 'LATIDO', 'Latido rojo doble desde el centro', """
VAR ph = MOD(t, 1.1) / 1.1;
VAR p1 = MAX(0.0, 1.0 - ABS(ph - 0.08) / 0.07);
VAR p2 = MAX(0.0, 1.0 - ABS(ph - 0.30) / 0.09) * 0.75;
VAR beat = MAX(p1, p2);
VAR d = SQRT((R8 - 3.5) * (R8 - 3.5) + (C8 - 3.5) * (C8 - 3.5));
VAR spread = MAX(0.0, 1.0 - d / (1.5 + beat * 3.5));
VAR b = 0.08 + beat * spread * 0.92;
return RGB(255.0 * b, 20.0 * b, 50.0 * b);
"""),
(30, 'fluid', 'Sunset', 'ATARDECER', 'Degradado de atardecer violeta, rosa y naranja', """
VAR y = R8 / 7.0 + 0.12 * SIN(C8 * 0.6 + t * 0.5);
VAR shift = SIN(t * 0.15) * 0.15;
VAR h = 270.0 + (y + shift) * 130.0;
VAR l = 0.30 + y * 0.25;
return HSL(MOD(h, 360.0), 1.0, l);
"""),
(31, 'psycho', 'Color Wheel', 'RUEDA', 'Rueda de color girando desde el centro', """
VAR ang = ATAN2(R8 - 3.5, C8 - 3.5);
VAR d = SQRT((R8 - 3.5) * (R8 - 3.5) + (C8 - 3.5) * (C8 - 3.5));
VAR hue = MOD(ang * 57.2958 + t * 90.0 + 360.0, 360.0);
return HSL(hue, 1.0, MIN(0.55, 0.15 + d * 0.09));
"""),
(32, 'energy', 'Police Lights', 'POLICIA', 'Balizas rojo y azul alternadas', """
VAR seg = MOD(t * 2.0, 2.0);
VAR strobe = (FRACT(t * 12.0) < 0.5) ? 1.0 : 0.0;
VAR redOn = (seg < 1.0 && C8 < 3.5) ? strobe : 0.0;
VAR blueOn = (seg >= 1.0 && C8 >= 3.5) ? strobe : 0.0;
return RGB(10.0 + redOn * 245.0, 4.0, 10.0 + blueOn * 245.0);
"""),
(33, 'energy', 'Tesla Coil', 'BOBINA', 'Nucleo electrico con rayos ramificados', """
VAR dx = C8 - 3.5;
VAR dy = R8 - 3.5;
VAR d = SQRT(dx * dx + dy * dy);
VAR ang = ATAN2(dy, dx);
VAR core = MAX(0.0, 1.0 - d / 1.4);
VAR arm = 0.0;
for (VAR k = 0.0; k < 4.0; k = k + 1.0) {
  VAR a0 = HASH(FLOOR(t * 8.0) + k * 13.0) * 6.2832;
  VAR da = ABS(MOD(ang - a0 + 3.1416, 6.2832) - 3.1416);
  VAR wig = da * d;
  arm = MAX(arm, MAX(0.0, 1.0 - wig * 1.4) * MAX(0.0, 1.0 - d / 5.5));
}
VAR b = MAX(core, arm);
return RGB(150.0 * b + core * 105.0, 120.0 * b + core * 135.0, 255.0 * b);
"""),
(34, 'fluid', 'Rainbow Breathing', 'RESPIRA', 'Toda la grilla respira cambiando de color', """
VAR hue = MOD(t * 25.0, 360.0) + (R8 + C8) * 4.0;
VAR l = 0.08 + 0.42 * (SIN(t * 1.8) * 0.5 + 0.5);
return HSL(hue, 1.0, l);
"""),
# ---------------- reactivos al audio (usan el comando V) ----------------
(35, 'audio', 'Spectrum Bars', 'ESPECTRO', 'Barras de frecuencia por columna', """
VAR lv = VU(FLOOR(c * 8.0 / cols));
VAR h = lv * rows;
VAR fromBottom = rows - 1.0 - r;
if (fromBottom < h) {
  VAR ratio = fromBottom / (rows - 1.0);
  return HSL(120.0 - ratio * 120.0, 1.0, 0.5);
}
return RGB(4.0, 6.0, 10.0);
"""),
(36, 'audio', 'VU Center', 'VUMETRO', 'Vumetro circular desde el centro', """
VAR d = SQRT((R8 - 3.5) * (R8 - 3.5) + (C8 - 3.5) * (C8 - 3.5)) / 5.0;
if (d < LEVEL * 1.05) {
  return HSL(120.0 - d * 130.0, 1.0, 0.5);
}
return RGB(3.0, 4.0, 8.0);
"""),
(37, 'audio', 'Bass Strobe', 'BAJOS', 'Destello de toda la grilla con cada golpe de bajo', """
VAR b = POW(BASS, 2.2);
return HSLK(MOD(t * 60.0, 360.0), 1.0, 0.5, 0.04 + b * 0.96);
"""),
(38, 'audio', 'Spectrum Mirror', 'ESPEJO', 'Espectro reflejado desde la linea central', """
VAR lv = VU(FLOOR(c * 8.0 / cols));
VAR half = (rows - 1.0) * 0.5;
VAR d = ABS(r - half);
if (d <= lv * (half + 0.5)) {
  return HSL(190.0 + d / half * 130.0, 1.0, 0.55 - d / half * 0.15);
}
return RGB(3.0, 3.0, 8.0);
"""),
(39, 'audio', 'Audio Fire', 'LLAMAS', 'Llamas cuya altura sigue la musica', """
VAR lv = VU(FLOOR(c * 8.0 / cols));
VAR flick = 0.15 * SIN(t * 9.0 + c * 2.1);
VAR h = (lv + flick) * rows;
VAR fromBottom = rows - 1.0 - r;
if (fromBottom < h) {
  VAR k = fromBottom / MAX(1.0, h);
  if (k > 0.75) {
    return RGB(255.0, 230.0, 80.0);
  }
  if (k > 0.45) {
    return RGB(255.0, 120.0, 0.0);
  }
  return RGB(220.0, 30.0, 0.0);
}
return RGB(15.0, 2.0, 0.0);
"""),
(40, 'audio', 'Beat Rainbow', 'BEAT', 'Arcoiris que se enciende con el volumen', """
VAR hue = MOD(t * 70.0 + (R8 + C8) * 22.0, 360.0);
return HSL(hue, 1.0, 0.05 + LEVEL * 0.5);
"""),
]

# --------------------------------------------------------------- PRESS ----
# (id, nombre, titulo, corto, descripcion, color_meta, duracion_ms, cuerpo)
PRESS = [
(13, 'Water Drop', 'WATER DROP', 'GOTA', 'Gota de agua con doble onda', '#50beff', 1000, """
VAR core = (DIST < 0.7 && T < 0.25) ? (1.0 - T / 0.25) : 0.0;
VAR r1 = T * 7.0 * KS;
VAR r2 = MAX(0.0, (T - 0.3) * 7.0 * KS);
VAR w1 = MAX(0.0, 1.0 - ABS(DIST - r1) / 1.1) * (1.0 - T);
VAR w2 = MAX(0.0, 1.0 - ABS(DIST - r2) / 1.1) * (1.0 - T) * 0.6;
return FXC(MAX(core, MAX(w1, w2)), 80.0, 190.0, 255.0);
"""),
(14, 'Comet Burst', 'COMETS', 'COMETAS', 'Cuatro cometas saliendo en diagonal', '#ffd166', 900, """
VAR best = 0.0;
for (VAR k = 0.0; k < 4.0; k = k + 1.0) {
  VAR a = 0.7854 + k * 1.5708 + SEED * 0.6;
  VAR along = DC * COS(a) + DR * SIN(a);
  VAR perp = ABS(DR * COS(a) - DC * SIN(a));
  VAR behind = T * 9.0 * KS - along;
  if (perp < 0.7 && behind >= -0.5 && behind < 3.0) {
    best = MAX(best, (1.0 - behind / 3.0) * (1.0 - perp / 0.7) * (1.0 - T * 0.6));
  }
}
return FX(best);
"""),
(15, 'Pixel Explosion', 'PIXELS', 'PIXELES', 'Explosion de pixeles de colores', '#ff4fd8', 800, """
VAR slot = FLOOR(T * 10.0);
VAR h = HASH2(r * 13.0 + slot * 7.0 + FLOOR(SEED * 1000.0), c * 29.0);
VAR reach = T * 6.0 * KS + 0.6;
if (DIST < reach && h > 0.55) {
  return FXH((1.0 - T) * (1.0 - DIST / (reach + 0.01) * 0.5), HASH2(r + slot, c + 99.0) * 360.0);
}
return FX(0.0);
"""),
(16, 'Square Wave', 'SQUARE', 'CUADRADO', 'Onda cuadrada que se expande', '#7cff6b', 900, """
VAR cheb = MAX(ABS(DR), ABS(DC));
VAR d = ABS(cheb - T * 8.0 * KS);
if (d < 1.0) {
  return FX((1.0 - d) * (1.0 - T * 0.9));
}
return FX(0.0);
"""),
(17, 'Implosion', 'IMPLOSION', 'IMPLOSION', 'Anillo que colapsa hacia el pad y estalla', '#a78bfa', 900, """
if (T < 0.75) {
  VAR rr = (1.0 - T / 0.75) * 8.0 * KS;
  VAR d = ABS(DIST - rr);
  if (d < 1.2) {
    return FX((1.0 - d / 1.2) * (0.4 + T));
  }
  return FX(0.0);
}
if (DIST < 1.6) {
  return FXC(1.0 - (T - 0.75) / 0.25, 255.0, 255.0, 255.0);
}
return FX(0.0);
"""),
(18, 'Scanline', 'SCANLINE', 'SCAN', 'Lineas horizontales que barren arriba y abajo', '#22d3ee', 800, """
VAR pos = T * 8.0 * KS;
VAR d = MIN(ABS(DR - pos), ABS(DR + pos));
return FX(MAX(0.0, 1.0 - d / 0.9) * (1.0 - T));
"""),
(19, 'Orbit Trail', 'ORBIT', 'ORBITA', 'Punto que orbita en espiral dejando estela', '#f472b6', 1100, """
VAR best = 0.0;
for (VAR k = 0.0; k < 6.0; k = k + 1.0) {
  VAR tk = T - k * 0.035;
  if (tk > 0.0) {
    VAR a = tk * 12.566 + SEED * 6.2832;
    VAR rad = tk * 5.5 * KS;
    VAR px = COS(a) * rad;
    VAR py = SIN(a) * rad;
    VAR d = SQRT((DC - px) * (DC - px) + (DR - py) * (DR - py));
    best = MAX(best, MAX(0.0, 1.0 - d / 0.85) * (1.0 - k / 6.0));
  }
}
return FXH(best * (1.0 - T * 0.5), MOD(T * 360.0 + SEED * 360.0, 360.0));
"""),
(20, 'Firework', 'FIREWORK', 'COHETE', 'Cohete que sube y explota en el pad', '#fb923c', 1300, """
if (T < 0.35) {
  VAR startR = rows - 1.0;
  VAR curR = startR + (ER - startR) * (T / 0.35);
  if (ABS(DC) < 0.5 && r >= curR - 0.5 && r <= startR + 0.5) {
    return FXC(MAX(0.0, 1.0 - ABS(r - curR) / 2.0), 255.0, 200.0, 120.0);
  }
  return FX(0.0);
}
VAR u = (T - 0.35) / 0.65;
VAR d2 = ABS(DIST - u * 6.0 * KS);
if (d2 < 1.0) {
  VAR ang = ATAN2(DR, DC);
  VAR spark = (SIN(ang * 8.0 + SEED * 20.0) > 0.2) ? 1.0 : 0.35;
  return FXH((1.0 - d2) * (1.0 - u) * spark, MOD(SEED * 360.0 + ang * 30.0 + 360.0, 360.0));
}
return FX(0.0);
"""),
(21, 'Glitch', 'GLITCH', 'GLITCH', 'Interferencia digital en fila y columna', '#00ffff', 700, """
VAR slot = FLOOR(T * 14.0);
VAR inLine = (ABS(DR) < 0.5 || ABS(DC) < 0.5) ? 1.0 : 0.3;
VAR h = HASH2(r * 7.0 + slot * 131.0 + FLOOR(SEED * 500.0), c * 3.0 + slot);
if (h > 0.6 && DIST < 7.0 * KS) {
  VAR k = HASH2(slot, r + c * 8.0);
  VAR i = inLine * (1.0 - T);
  if (k < 0.33) {
    return FXC(i, 0.0, 255.0, 255.0);
  }
  if (k < 0.66) {
    return FXC(i, 255.0, 0.0, 200.0);
  }
  return FXC(i, 255.0, 255.0, 255.0);
}
return FX(0.0);
"""),
(22, 'Color Bomb', 'COLOR BOMB', 'BOMBA', 'La grilla entera se tine del color del pad', '#facc15', 900, """
VAR local = T - DIST / (10.0 * KS) * 0.5;
if (local < 0.0) {
  return FX(0.0);
}
return FX(MAX(0.0, 1.0 - local * 1.6) * 0.9);
"""),
(23, 'Pulse Echo', 'ECHO', 'ECO', 'Tres anillos en eco que se desvanecen', '#34d399', 1100, """
VAR best = 0.0;
for (VAR k = 0.0; k < 3.0; k = k + 1.0) {
  VAR tk = T - k * 0.2;
  if (tk > 0.0) {
    VAR d = ABS(DIST - tk * 8.0 * KS);
    if (d < 0.9) {
      best = MAX(best, (1.0 - d / 0.9) * (1.0 - tk) * (1.0 - k * 0.25));
    }
  }
}
return FX(best);
"""),
(24, 'Matrix Burst', 'MATRIX', 'MATRIX', 'Lluvia verde cayendo desde el pad', '#22c55e', 1000, """
if (ABS(DC) > 2.5 * KS + 0.5) {
  return FX(0.0);
}
VAR sp = 0.6 + HASH(c * 7.0 + FLOOR(SEED * 100.0)) * 0.8;
VAR head = ER - 0.5 + T * sp * 9.0 * KS;
VAR behind = head - r;
if (behind >= 0.0 && behind < 3.0 && r >= ER - 0.5) {
  VAR hot = (behind < 0.8) ? 200.0 : 0.0;
  return FXC((1.0 - behind / 3.0) * (1.0 - T * 0.5), hot, 255.0, hot + 60.0);
}
return FX(0.0);
"""),
]

# Efectos "mientras suena" (solo firmware; la app solo los elige)
PLAYING = [
(0, 'Destello blanco', 'Parpadeo blanco rapido (el de siempre)'),
(1, 'Respiracion', 'El pad respira con su propio color'),
(2, 'Arcoiris', 'El pad recorre todos los colores'),
(3, 'Latido', 'Doble pulso como un corazon'),
(4, 'Parpadeo de color', 'Prende y apaga con su color'),
(5, 'Cuenta regresiva', 'Se va apagando hasta que termina el sonido'),
(6, 'Brillo suave', 'Mezcla suave entre su color y blanco'),
(7, 'Sin efecto', 'Mantiene el color normal mientras suena'),
(8, 'Nivel de audio', 'El brillo del pad sigue el volumen del sonido'),
]
