#!/bin/bash

# Kolory
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Jeśli nie jesteś root, uruchom ponownie skrypt z sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${BLUE}🧠 Dezinstalowanie mygit wymaga uprawnień root.${NC}"
    exec sudo "$0" "$@"
fi

echo -e "${BLUE}🧠 Dezinstalowanie mygit...${NC}"

# 1. Usuwanie binarek
FILES=("mygit-local" "mygit")

for file in "${FILES[@]}"; do
    file_path="/usr/local/bin/$file"
    if [ -f "$file_path" ]; then
        rm "$file_path"
        echo -e "${GREEN}✅ Usunięto binarkę: $file_path${NC}"
    else
        echo -e "${RED}⚠️  Plik nie istnieje: $file_path${NC}"
    fi
done

# 2. Usuwanie konfiguracji użytkownika
# Musimy znaleźć użytkownika, który wywołał sudo, aby trafić do dobrego katalogu domowego
REAL_USER=${SUDO_USER:-$USER}

# Pobierz katalog domowy tego użytkownika
if [ "$REAL_USER" = "root" ]; then
    USER_HOME="/root"
else
    USER_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
fi

CONFIG_DIR="$USER_HOME/.config/mygit"

if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
    echo -e "${GREEN}✅ Usunięto konfigurację: $CONFIG_DIR${NC}"
else
    echo -e "${RED}⚠️  Brak konfiguracji w: $CONFIG_DIR${NC}"
fi

echo ""
echo -e "${GREEN}🗑️  Dezinstalacja zakończona sukcesem.${NC}"