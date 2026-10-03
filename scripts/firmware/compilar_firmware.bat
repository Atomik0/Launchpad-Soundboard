@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Compilador de Firmware STM32 - Black Pill F401 y F411

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "BASE_DIR=%%~fI\"

set "SKETCH_5X5=%BASE_DIR%firmware\launchpad_5x5_soundboard"
set "SKETCH_8X8=%BASE_DIR%firmware\launchpad_8x8_soundboard"

set "OUT_5X5_F411=%SKETCH_5X5%\build\STM32F411"
set "OUT_5X5_F401=%SKETCH_5X5%\build\STM32F401"
set "OUT_8X8_F411=%SKETCH_8X8%\build\STM32F411"
set "OUT_8X8_F401=%SKETCH_8X8%\build\STM32F401"

set "FQBN_F411=STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F411CE,usb=CDCgen"
set "FQBN_F401=STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F401CC,usb=CDCgen"

set "ARDUINO_CLI="
where arduino-cli >nul 2>nul
if !errorlevel!==0 (
    set "ARDUINO_CLI=arduino-cli"
) else (
    if exist "%LOCALAPPDATA%\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe" (
        set "ARDUINO_CLI=%LOCALAPPDATA%\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
    )
)

if not defined ARDUINO_CLI (
    echo [ERROR] No se encontro arduino-cli ni la instalacion de Arduino IDE.
    echo Asegurate de tener Arduino IDE 2.x instalado en el equipo.
    pause
    exit /b 1
)

:MENU
cls
echo ========================================================
echo   COMPILADOR AUTOMATICO DE FIRMWARE - LAUNCHPAD SOUNDBOARD
echo   Herramienta: arduino-cli
echo ========================================================
echo.
echo Selecciona que deseas compilar:
echo.
echo   [1] Compilar TODO [5x5 y 8x8 para STM32F411 y STM32F401]
echo   [2] Compilar Launchpad 5x5 para STM32F411 [Tu placa]
echo   [3] Compilar Launchpad 8x8 para STM32F411 [Tu placa]
echo   [4] Compilar Launchpad 5x5 para STM32F401
echo   [5] Compilar Launchpad 8x8 para STM32F401
echo   [6] Salir
echo.
set /p "OPT=Ingresa una opcion (1-6): "

if "%OPT%"=="1" goto COMPILAR_TODO
if "%OPT%"=="2" goto COMPILAR_5X5_F411
if "%OPT%"=="3" goto COMPILAR_8X8_F411
if "%OPT%"=="4" goto COMPILAR_5X5_F401
if "%OPT%"=="5" goto COMPILAR_8X8_F401
if "%OPT%"=="6" exit /b 0

echo Opcion no valida.
pause
goto MENU

:COMPILAR_TODO
echo.
echo [1/4] Compilando Launchpad 5x5 para STM32F411...
"%ARDUINO_CLI%" compile --fqbn "%FQBN_F411%" --output-dir "%OUT_5X5_F411%" "%SKETCH_5X5%"
if !errorlevel! neq 0 goto ERROR_COMPILACION
copy /y "%OUT_5X5_F411%\launchpad_5x5_soundboard.ino.bin" "%SKETCH_5X5%\build\launchpad_5x5_soundboard.ino.bin" >nul

echo [2/4] Compilando Launchpad 5x5 para STM32F401...
"%ARDUINO_CLI%" compile --fqbn "%FQBN_F401%" --output-dir "%OUT_5X5_F401%" "%SKETCH_5X5%"
if !errorlevel! neq 0 goto ERROR_COMPILACION

echo [3/4] Compilando Launchpad 8x8 para STM32F411...
"%ARDUINO_CLI%" compile --fqbn "%FQBN_F411%" --output-dir "%OUT_8X8_F411%" "%SKETCH_8X8%"
if !errorlevel! neq 0 goto ERROR_COMPILACION
copy /y "%OUT_8X8_F411%\launchpad_8x8_soundboard.ino.bin" "%SKETCH_8X8%\build\launchpad_8x8_soundboard.ino.bin" >nul

echo [4/4] Compilando Launchpad 8x8 para STM32F401...
"%ARDUINO_CLI%" compile --fqbn "%FQBN_F401%" --output-dir "%OUT_8X8_F401%" "%SKETCH_8X8%"
if !errorlevel! neq 0 goto ERROR_COMPILACION

goto EXITO

:COMPILAR_5X5_F411
echo.
echo Compilando Launchpad 5x5 para STM32F411...
"%ARDUINO_CLI%" compile --fqbn "%FQBN_F411%" --output-dir "%OUT_5X5_F411%" "%SKETCH_5X5%"
if !errorlevel! neq 0 goto ERROR_COMPILACION
copy /y "%OUT_5X5_F411%\launchpad_5x5_soundboard.ino.bin" "%SKETCH_5X5%\build\launchpad_5x5_soundboard.ino.bin" >nul
goto EXITO

:COMPILAR_8X8_F411
echo.
echo Compilando Launchpad 8x8 para STM32F411...
"%ARDUINO_CLI%" compile --fqbn "%FQBN_F411%" --output-dir "%OUT_8X8_F411%" "%SKETCH_8X8%"
if !errorlevel! neq 0 goto ERROR_COMPILACION
copy /y "%OUT_8X8_F411%\launchpad_8x8_soundboard.ino.bin" "%SKETCH_8X8%\build\launchpad_8x8_soundboard.ino.bin" >nul
goto EXITO

:COMPILAR_5X5_F401
echo.
echo Compilando Launchpad 5x5 para STM32F401...
"%ARDUINO_CLI%" compile --fqbn "%FQBN_F401%" --output-dir "%OUT_5X5_F401%" "%SKETCH_5X5%"
if !errorlevel! neq 0 goto ERROR_COMPILACION
goto EXITO

:COMPILAR_8X8_F401
echo.
echo Compilando Launchpad 8x8 para STM32F401...
"%ARDUINO_CLI%" compile --fqbn "%FQBN_F401%" --output-dir "%OUT_8X8_F401%" "%SKETCH_8X8%"
if !errorlevel! neq 0 goto ERROR_COMPILACION
goto EXITO

:EXITO
echo.
echo ========================================================
echo  [OK] COMPILACION FINALIZADA CON EXITO
echo  Los binarios (.bin y .hex) estan listos para flashear.
echo ========================================================
echo.
pause
goto MENU

:ERROR_COMPILACION
echo.
echo ========================================================
echo  [ERROR] Ocurrio un error durante la compilacion.
echo  Verifica que las librerias (Adafruit NeoPixel) esten instaladas.
echo ========================================================
echo.
pause
goto MENU
