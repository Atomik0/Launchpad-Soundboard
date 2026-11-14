@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Flasheador de Firmware STM32 - Launchpad Soundboard

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "BASE_DIR=%%~fI\"

:MENU_MCU
cls
echo ========================================================
echo  FLASHEADOR DE FIRMWARE STM32 - LAUNCHPAD SOUNDBOARD
echo  Soporte Universal: STM32F411 y STM32F401 [Black Pill]
echo ========================================================
echo.
echo 1. Selecciona tu placa STM32 Black Pill:
echo   [1] STM32F411 (Black Pill F411CE) - Tu placa actual
echo   [2] STM32F401 (Black Pill F401CC/CD/CE)
echo   [3] Cancelar y salir
echo.
set /p "MCU_OPT=Ingresa opcion de placa (1-3): "

if "%MCU_OPT%"=="1" (
  set "MCU_NAME=STM32F411"
  set "MCU_FOLDER=STM32F411"
) else if "%MCU_OPT%"=="2" (
  set "MCU_NAME=STM32F401"
  set "MCU_FOLDER=STM32F401"
) else (
  echo Operacion cancelada.
  exit /b 0
)

:MENU_MATRIX
echo.
echo 2. Selecciona la version de matriz a flashear:
echo   [1] Matriz 5x5 [25 pads - Launchpad 5x5 Compact]
echo   [2] Matriz 8x8 [64 pads - Launchpad 8x8 Pro]
echo   [3] Volver al menu anterior
echo.
set /p "MAT_OPT=Ingresa opcion de matriz (1-3): "

if "%MAT_OPT%"=="1" (
  set "TARGET_NAME=Launchpad 5x5 - !MCU_NAME!"
  set "TARGET_BIN=%BASE_DIR%firmware\launchpad_5x5_soundboard\build\!MCU_FOLDER!\launchpad_5x5_soundboard.ino.bin"
  set "TARGET_BIN_ALT=%BASE_DIR%firmware\launchpad_5x5_soundboard\build\launchpad_5x5_soundboard.ino.bin"
) else if "%MAT_OPT%"=="2" (
  set "TARGET_NAME=Launchpad 8x8 - !MCU_NAME!"
  set "TARGET_BIN=%BASE_DIR%firmware\launchpad_8x8_soundboard\build\!MCU_FOLDER!\launchpad_8x8_soundboard.ino.bin"
  set "TARGET_BIN_ALT=%BASE_DIR%firmware\launchpad_8x8_soundboard\build\launchpad_8x8_soundboard.ino.bin"
) else if "%MAT_OPT%"=="3" (
  goto MENU_MCU
) else (
  echo Opcion invalida.
  pause
  goto MENU_MATRIX
)

if not exist "!TARGET_BIN!" (
  if exist "!TARGET_BIN_ALT!" (
    set "TARGET_BIN=!TARGET_BIN_ALT!"
  )
)

echo.
echo ========================================================
echo  Configuracion seleccionada:
echo  Placa objetivo:  !MCU_NAME!
echo  Firmware:        !TARGET_NAME!
echo  Archivo binario: !TARGET_BIN!
echo ========================================================
echo.

if not exist "!TARGET_BIN!" (
  echo [ERROR] No se encontro el archivo binario precompilado:
  echo "!TARGET_BIN!"
  echo.
  echo Puedes compilarlo ejecutando: scripts\firmware\compilar_firmware.bat
  pause
  exit /b 1
)

:MENU_METHOD
echo.
echo 3. Selecciona el metodo de flasheo:
echo   [1] ST-Link V2 (SWD) - [Recomendado: 100%% confiable, sin problemas de DFU]
echo   [2] USB DFU directo (Black Pill conectada por USB-C)
echo   [3] Volver al menu anterior
echo.
set /p "METHOD_OPT=Ingresa opcion de metodo (1-3): "

if "%METHOD_OPT%"=="1" (
  set "FLASH_METHOD=STLINK"
) else if "%METHOD_OPT%"=="2" (
  set "FLASH_METHOD=DFU"
) else if "%METHOD_OPT%"=="3" (
  goto MENU_MATRIX
) else (
  echo Opcion invalida.
  pause
  goto MENU_METHOD
)

set "TARGET_HEX=!TARGET_BIN:.bin=.hex!"

set "DFU_UTIL="
where dfu-util >nul 2>nul
if !errorlevel!==0 (
  set "DFU_UTIL=dfu-util"
) else (
  for /d %%D in ("%LOCALAPPDATA%\Arduino15\packages\STMicroelectronics\tools\STM32Tools\*") do (
    if exist "%%D\win\dfu-util.exe" set "DFU_UTIL=%%D\win\dfu-util.exe"
  )
)

set "STM32_PROG="
where STM32_Programmer_CLI >nul 2>nul
if !errorlevel!==0 (
  set "STM32_PROG=STM32_Programmer_CLI"
) else (
  if exist "C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe" (
    set "STM32_PROG=C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe"
  ) else if exist "C:\Program Files (x86)\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe" (
    set "STM32_PROG=C:\Program Files (x86)\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe"
  )
)

if "!FLASH_METHOD!"=="STLINK" (
  echo ========================================================
  echo  CONEXION ST-LINK V2 (SWD):
  echo ========================================================
  echo  Asegurate de conectar los 4 pines de la Black Pill al ST-Link:
  echo   - 3.3V  <--> 3.3V  (O dejar Black Pill con USB y NO conectar 3.3V)
  echo   - SWDIO <--> SWDIO
  echo   - SWCLK <--> SWCLK
  echo   - GND   <--> GND
  echo ========================================================
  echo.
  pause

  set "FLASHED=0"
  if defined STM32_PROG (
    echo Conectando y flasheando via ST-Link V2 (SWD)...
    if exist "!TARGET_HEX!" (
      "!STM32_PROG!" -c port=SWD mode=UR freq=4000 -d "!TARGET_HEX!" -v -s
    ) else (
      "!STM32_PROG!" -c port=SWD mode=UR freq=4000 -d "!TARGET_BIN!" 0x08000000 -v -s
    )
    if !errorlevel!==0 set "FLASHED=1"
  ) else (
    echo [ERROR] Se requiere STM32CubeProgrammer CLI para flashear con ST-Link.
  )
  goto RESULT_CHECK
)

echo ========================================================
echo  INSTRUCCIONES PARA PONER LA BLACK PILL EN MODO DFU:
echo ========================================================
echo  1. Conecta la placa STM32 Black Pill al puerto USB.
echo  2. Manten presionado el boton BOOT0 [B0].
echo  3. Presiona y suelta el boton NRST [Reset].
echo  4. Suelta el boton BOOT0.
echo ========================================================
echo.
pause

set "FLASHED=0"

if defined STM32_PROG (
  echo Intentando flasheo con STM32CubeProgrammer CLI...
  if exist "!TARGET_HEX!" (
    echo Flasheando archivo Intel HEX...
    "!STM32_PROG!" -c port=usb1 -d "!TARGET_HEX!" -v -s
  ) else (
    echo Flasheando archivo binario a 0x08000000...
    "!STM32_PROG!" -c port=usb1 -d "!TARGET_BIN!" 0x08000000 -v -s
  )
  if !errorlevel!==0 set "FLASHED=1"
)

if "!FLASHED!"=="0" if defined DFU_UTIL (
  echo Intentando flasheo DFU con dfu-util...
  "!DFU_UTIL!" -a 0 -d 0483:df11 -D "!TARGET_BIN!" -R
  if !errorlevel!==0 set "FLASHED=1"
)

:RESULT_CHECK

echo.
if "!FLASHED!"=="1" (
  echo ========================================================
  echo  [OK] FIRMWARE FLASHEADO CON EXITO
  echo  La placa reiniciara automaticamente en modo Launchpad.
  echo ========================================================
) else (
  echo ========================================================
  echo  No se pudo completar el flasheo automatico.
  echo.
  echo  CAUSA COMUN: DRIVER INCORRECTO O CONFLICTO CON ZADIG
  echo  Si usaste Zadig previamente, instalo un driver incompatible
  echo  con STM32CubeProgrammer que causa "LIBUSB_ERROR_PIPE".
  echo.
  echo  SOLUCION 1 - RESTAURAR DRIVER OFICIAL DE STMICROELECTRONICS:
  echo   1. Abre el Administrador de dispositivos (devmgmt.msc).
  echo   2. Ve a "Dispositivos de bus serie universal".
  echo   3. Clic derecho en "STM32 BOOTLOADER" -^> "Actualizar controlador".
  echo   4. "Examinar mi PC..." -^> "Elegir en una lista disponible...".
  echo   5. Selecciona el provisto por "STMicroelectronics" (v1.3.0.0).
  echo.
  echo  SOLUCION 2 - PUERTO USB FISICO:
  echo   Conecta la Black Pill a un puerto USB 2.0 (negro) directo
  echo   de la placa madre, evitando puertos USB 3.0/3.2 (azules/rojos).
  echo ========================================================
)

echo.
pause
