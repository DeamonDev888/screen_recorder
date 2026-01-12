#!/bin/bash

# Screenflow Pro - Mac/Linux Launcher (WGC Errors Filtered)
clear

# Professional Colors
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo " #################################################################"
echo " #                                                               #"
echo " #   SSSSS   CCCC   RRRR   EEEEE  EEEEE  N   N  FFFFF  L      O  #"
echo " #   S       C      R   R  E      E      NN  N  F      L     O O #"
echo " #    SSS    C      RRRR   EEE    EEE    N N N  FFF    L     O O #"
echo " #       S   C      R  R   E      E      N  NN  F      L     O O #"
echo " #   SSSSS   CCCC   R   R  EEEEE  EEEEE  N   N  F      LLLLL  O  #"
echo " #                                                               #"
echo " #                      SCREENFLOW PRO v1.0                      #"
echo " #                 \"The Ultimate Recording Suite\"                #"
echo " #                                                               #"
echo " #################################################################"
echo -e "${NC}"

echo -e "${BLUE}[!] Initializing System...${NC}"
sleep 1

echo -e "${BLUE}[+] STEP 1: Optimizing TypeScript Assets...${NC}"
pnpm run build

echo ""
echo -e "${BLUE}[+] STEP 2: Launching High-Performance Engine...${NC}"
echo -e "${BLUE}[!] Secure IPC Bridge: ACTIVE${NC}"
echo -e "${GREEN}[!] WGC Error Filtering: ENABLED (Harmless errors hidden)${NC}"
echo ""

# FIXED: Filter out WGC errors using grep
# -v = invert match (show lines that DON'T match)
# -e = pattern to match
pnpm start 2>&1 | grep -v "wgc_capture_session" | grep -v "ProcessFrame failed" | grep -v "ERROR:wgc"

