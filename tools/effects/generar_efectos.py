#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regenera los efectos extendidos en firmware y app desde effects.dsl.py.

Uso (desde la raiz del proyecto):   python tools/effects/generar_efectos.py

1. Agrega o edita efectos en tools/effects/effects.dsl.py
2. Ejecuta este script: reemplaza el bloque marcado en los dos .ino y
   reescribe app/public/effects_ext.js y mobile_app/js/effects_ext.js
3. Recompila el firmware y reinicia la app.
"""
import pathlib, re, sys, importlib.util

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location("effects_gen", HERE / "effects_gen.py")
eg = importlib.util.module_from_spec(spec); spec.loader.exec_module(eg)

BEGIN = "// >>> EFECTOS EXTENDIDOS"
END = "// <<< FIN EFECTOS EXTENDIDOS"

def write_keep_eol(path, text, crlf):
    data = text.replace("\r\n", "\n")
    if crlf:
        data = data.replace("\n", "\r\n")
    path.write_bytes(data.encode("utf-8"))

def patch_ino(path):
    raw = path.read_bytes().decode("utf-8")
    crlf = "\r\n" in raw
    txt = raw.replace("\r\n", "\n")
    a, b = txt.find(BEGIN), txt.find(END)
    if a < 0 or b < 0:
        sys.exit("No se encontro el bloque de efectos en %s" % path)
    b = txt.index("\n", b) + 1
    block = eg.c_code().strip("\n") + "\n"
    write_keep_eol(path, txt[:a] + block + txt[b:], crlf)
    print("firmware actualizado:", path.relative_to(ROOT))

for ino in ["firmware/launchpad_8x8_soundboard/launchpad_8x8_soundboard.ino",
            "firmware/launchpad_5x5_soundboard/launchpad_5x5_soundboard.ino"]:
    patch_ino(ROOT / ino)

js = eg.js_code()
for dst in ["app/public/effects_ext.js", "mobile_app/js/effects_ext.js"]:
    write_keep_eol(ROOT / dst, js, True)
    print("app actualizada:", dst)
print("Listo: idle hasta %d, pulsacion hasta %d" % (eg.IDLE_MAX, eg.PRESS_MAX))
