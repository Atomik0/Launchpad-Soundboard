#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FW_8X8_DIR="$REPO_DIR/firmware/launchpad_8x8_soundboard"
FW_5X5_DIR="$REPO_DIR/firmware/launchpad_5x5_soundboard"

echo "========================================================"
echo " FLASHEADOR DE FIRMWARE STM32 - LAUNCHPAD SOUNDBOARD"
echo " Soporte Universal: STM32F411 y STM32F401 (Black Pill)"
echo "========================================================"
echo ""
echo "1. Selecciona tu placa STM32 Black Pill:"
echo "  [1] STM32F411 (Black Pill F411CE) - Tu placa actual"
echo "  [2] STM32F401 (Black Pill F401CC/CD/CE)"
echo "  [3] Cancelar y salir"
echo ""
read -p "Ingresa opcion de placa (1-3): " MCU_OPT

case "$MCU_OPT" in
  1)
    MCU_NAME="STM32F411 (F411CE)"
    MCU_FOLDER="STM32F411"
    FQBN="STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F411CE,usb=CDCgen,xserial=generic"
    ;;
  2)
    MCU_NAME="STM32F401 (F401CC/CD/CE)"
    MCU_FOLDER="STM32F401"
    FQBN="STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F401CC,usb=CDCgen,xserial=generic"
    ;;
  *)
    echo "Operacion cancelada."
    exit 0
    ;;
esac

echo ""
echo "2. Selecciona la version de matriz a flashear:"
echo "  [1] Matriz 5x5 (25 pads - Launchpad 5x5 Compact)"
echo "  [2] Matriz 8x8 (64 pads - Launchpad 8x8 Pro)"
echo "  [3] Cancelar y salir"
echo ""
read -p "Ingresa opcion de matriz (1-3): " MAT_OPT

case "$MAT_OPT" in
  1)
    TARGET_NAME="Launchpad 5x5 ($MCU_NAME)"
    TARGET_DIR="$FW_5X5_DIR"
    TARGET_BIN="$FW_5X5_DIR/build/$MCU_FOLDER/launchpad_5x5_soundboard.ino.bin"
    ALT_BIN="$FW_5X5_DIR/build/launchpad_5x5_soundboard.ino.bin"
    ;;
  2)
    TARGET_NAME="Launchpad 8x8 ($MCU_NAME)"
    TARGET_DIR="$FW_8X8_DIR"
    TARGET_BIN="$FW_8X8_DIR/build/$MCU_FOLDER/launchpad_8x8_soundboard.ino.bin"
    ALT_BIN="$FW_8X8_DIR/build/launchpad_8x8_soundboard.ino.bin"
    ;;
  *)
    echo "Operacion cancelada."
    exit 0
    ;;
esac

echo ""
echo "Seleccionado: $TARGET_NAME"
echo ""

DFU_UTIL=""
if command -v dfu-util >/dev/null 2>&1; then
  DFU_UTIL="$(command -v dfu-util)"
elif [ -x "$HOME/.arduino15/packages/STMicroelectronics/tools/STM32Tools/2.5.0/linux/x86_64/dfu-util" ]; then
  DFU_UTIL="$HOME/.arduino15/packages/STMicroelectronics/tools/STM32Tools/2.5.0/linux/x86_64/dfu-util"
elif [ -x "$HOME/.arduino15/packages/STMicroelectronics/tools/STM32Tools/2.5.0/linux/aarch64/dfu-util" ]; then
  DFU_UTIL="$HOME/.arduino15/packages/STMicroelectronics/tools/STM32Tools/2.5.0/linux/aarch64/dfu-util"
fi

ARDUINO_CLI=""
if command -v arduino-cli >/dev/null 2>&1; then
  ARDUINO_CLI="$(command -v arduino-cli)"
elif [ -x "$HOME/.local/bin/arduino-cli" ]; then
  ARDUINO_CLI="$HOME/.local/bin/arduino-cli"
fi

if [ ! -f "$TARGET_BIN" ]; then
  if [ -f "$ALT_BIN" ]; then
    TARGET_BIN="$ALT_BIN"
  elif [ -n "$ARDUINO_CLI" ]; then
    echo "Compilando firmware con arduino-cli..."
    "$ARDUINO_CLI" compile --fqbn "$FQBN" "$TARGET_DIR" --output-dir "$TARGET_DIR/build/$MCU_FOLDER"
    TARGET_BIN="$TARGET_DIR/build/$MCU_FOLDER/$(basename "$TARGET_DIR").ino.bin"
  else
    echo "Error: No se encontro el archivo binario ni arduino-cli para compilar."
    echo "Abre el archivo .ino en Arduino IDE y presiona Subir."
    exit 1
  fi
fi

echo "========================================================"
echo " INSTRUCCIONES PARA PONER LA BLACK PILL EN MODO DFU:"
echo "========================================================"
echo " 1. Conecta la placa STM32 Black Pill al puerto USB."
echo " 2. Manten presionado el boton BOOT0 (B0)."
echo " 3. Presiona y suelta el boton NRST (Reset)."
echo " 4. Suelta el boton BOOT0."
echo "========================================================"
echo ""
read -p "Presiona ENTER una vez que la placa este conectada en modo DFU..."

FLASHED=0

if [ -n "$DFU_UTIL" ]; then
  echo "Intentando flasheo DFU via dfu-util ($DFU_UTIL)..."
  if "$DFU_UTIL" -a 0 -d 0483:df11 -s 0x08000000:leave -D "$TARGET_BIN"; then
    FLASHED=1
  else
    echo "Fallo de permisos o dispositivo no encontrado. Reintentando con permisos..."
    if sudo "$DFU_UTIL" -a 0 -d 0483:df11 -s 0x08000000:leave -D "$TARGET_BIN"; then
      FLASHED=1
    fi
  fi
fi

if [ "$FLASHED" -eq 0 ] && [ -n "$ARDUINO_CLI" ]; then
  echo ""
  echo "Intentando flasheo via arduino-cli..."
  BOARD_LINE=$("$ARDUINO_CLI" board list | grep -E "/dev/tty(ACM|USB)" | head -n 1 || true)
  if [ -n "$BOARD_LINE" ]; then
    PORT=$(echo "$BOARD_LINE" | awk '{print $1}')
    echo "Puerto detectado: $PORT"
    "$ARDUINO_CLI" upload -p "$PORT" --fqbn "$FQBN" "$TARGET_DIR"
    FLASHED=1
  fi
fi

echo ""
if [ "$FLASHED" -eq 1 ]; then
  echo "========================================================"
  echo " FIRMWARE FLASHEADO CON EXITO"
  echo " La placa reiniciara automaticamente en modo Launchpad."
  echo "========================================================"
else
  echo "========================================================"
  echo " No se pudo completar el flasheo automatico."
  echo " Verifica que la placa este en modo DFU (BOOT0 + Reset)"
  echo " o usa Arduino IDE abriendo el archivo .ino correspondiente."
  echo "========================================================"
  exit 1
fi
