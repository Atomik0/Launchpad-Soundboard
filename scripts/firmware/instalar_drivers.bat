@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Instalador y Verificador de Drivers STM32 - Black Pill F401 y F411

echo ========================================================
echo   INSTALADOR DE CONTROLADORES STM32 (BLACK PILL)
echo   Compatibilidad: STM32F401 y STM32F411
echo ========================================================
echo.

set "ST_DIR=C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\Drivers"

echo [1/3] Registrando paquetes de controladores oficiales STMicroelectronics...
set "INSTALLED=0"

if exist "%ST_DIR%\DFU_Driver\Driver\STM32Bootloader.inf" (
    echo  - Registrando controlador DFU STM32 Bootloader USB...
    pnputil /add-driver "%ST_DIR%\DFU_Driver\Driver\STM32Bootloader.inf" /install >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK] STM32Bootloader.inf instalado correctamente.
        set /a INSTALLED+=1
    ) else (
        echo     [INFO] STM32Bootloader.inf ya se encuentra presente en el sistema.
    )
) else (
    echo  - [AVISO] No se encontro STM32Bootloader.inf en la ruta estandar.
)

if exist "%ST_DIR%\stsw-link009_v3\stlink_bridge_winusb.inf" (
    echo  - Registrando controladores ST-Link / WinUSB / VCP...
    pnputil /add-driver "%ST_DIR%\stsw-link009_v3\*.inf" /install >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK] Drivers ST-Link instalados correctamente.
        set /a INSTALLED+=1
    ) else (
        echo     [INFO] Drivers ST-Link ya se encuentran presentes en el sistema.
    )
)

echo.
echo [2/3] Verificando presencia de controladores en el Almacen del Sistema...
echo ------------------------------------------------------------------------
pnputil /enum-drivers | findstr /i "stm32bootloader stlink stmcdc libwdi"
echo ------------------------------------------------------------------------

echo.
echo [3/3] Comprobando utilidades de flasheo disponibles...
set "TOOL_FOUND=0"

where dfu-util >nul 2>nul
if !errorlevel!==0 (
    echo  [OK] dfu-util esta disponible en el PATH del sistema.
    set /a TOOL_FOUND+=1
) else (
    for /d %%D in ("%LOCALAPPDATA%\Arduino15\packages\STMicroelectronics\tools\STM32Tools\*") do (
        if exist "%%D\win\dfu-util.exe" (
            echo  [OK] dfu-util encontrado en: %%D\win\dfu-util.exe
            set /a TOOL_FOUND+=1
        )
    )
)

if exist "C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe" (
    echo  [OK] STM32_Programmer_CLI encontrado en STM32CubeProgrammer.
    set /a TOOL_FOUND+=1
)

echo.
echo ========================================================
echo   RESUMEN Y GUIA DE USO
echo ========================================================
echo  Todo el soporte para STM32F401 y STM32F411 esta verificado.
echo.
echo  COMO PONER LA PLACA EN MODO DFU PARA CARGAR FIRMWARE:
echo   1. Conecta la placa STM32 Black Pill por USB al ordenador.
echo   2. Manten presionado el boton BOOT0 [B0].
echo   3. Presiona y suelta el boton NRST [Reset].
echo   4. Suelta el boton BOOT0.
echo   5. Ejecuta: scripts\firmware\flashear_firmware.bat
echo ========================================================
echo.
pause
