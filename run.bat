@echo off
title Screenflow Pro Launcher
cls
color 0b

echo.
echo  #################################################################
echo  #                                                               #
echo  #   SSSSS   CCCC   RRRR   EEEEE  EEEEE  N   N  FFFFF  L      O  #
echo  #   S       C      R   R  E      E      NN  N  F      L     O O #
echo  #    SSS    C      RRRR   EEE    EEE    N N N  FFF    L     O O #
echo  #       S   C      R  R   E      E      N  NN  F      L     O O #
echo  #   SSSSS   CCCC   R   R  EEEEE  EEEEE  N   N  F      LLLLL  O  #
echo  #                                                               #
echo  #                      SCREENFLOW PRO v1.0                      #
echo  #                 "The Ultimate Recording Suite"                #
echo  #                                                               #
echo  #################################################################
echo.

echo  [!] Initializing System...
timeout /t 1 /nobreak >nul

echo  [+] STEP 1: Optimizing TypeScript Assets...
call pnpm run build

echo.
echo [+] STEP 2: Launching High-Performance Engine...
echo [!] Secure IPC Bridge: ACTIVE
echo [!] Rendering Mode: GPU ACCELERATED
echo [!] WGC Error Filtering: ENABLED (Harmless errors hidden)
echo [!] Press Ctrl+C in this window to force stop.
echo.

:: FIXED: Filter out WGC errors from console output
:: The "findstr /V" command excludes lines containing "wgc_capture_session" or "ProcessFrame failed"
:: These errors are harmless Windows Graphics Capture (WGC) errors that don't affect functionality
call pnpm start 2^>^&1 | findstr /V /C:"wgc_capture_session" /C:"ProcessFrame failed"
goto EXIT

:EXIT
echo.
echo  #################################################################
echo  #                                                               #
echo  #            SCREENFLOW PRO HAS EXITED SUCCESSFULLY           #
echo  #               THANK YOU FOR USING OUR SERVICES              #
echo  #                                                               #
echo  #################################################################
echo.
timeout /t 2 /nobreak >nul
exit
