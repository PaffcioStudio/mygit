#!/bin/bash

# Kolory
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🧠 Instalator mygit v2.0 (Client)${NC}"

# 1. Sprawdź uprawnienia root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ Uruchom instalator jako root (sudo).${NC}"
    exit 1
fi

# 2. Sprawdź zależności
echo "🔍 Sprawdzanie zależności..."
MISSING=0
for cmd in curl jq zip unzip; do
    if ! command -v $cmd >/dev/null 2>&1; then
        echo -e "${RED}Brak: $cmd${NC}"
        MISSING=1
    else
        echo -e "${GREEN}Jest: $cmd${NC}"
    fi
done

if [ $MISSING -eq 1 ]; then
    echo -e "${RED}Zainstaluj brakujące pakiety i spróbuj ponownie.${NC}"
    echo "Debian/Ubuntu: sudo apt install curl jq zip unzip"
    exit 1
fi

# 3. Instalacja binarek
BIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin"

if [ -f "$BIN_SRC/mygit" ]; then
    echo "📦 Kopiowanie mygit do /usr/local/bin..."
    cp "$BIN_SRC/mygit" /usr/local/bin/mygit
    chmod +x /usr/local/bin/mygit
else
    echo -e "${RED}❌ Błąd: Nie znaleziono pliku bin/mygit${NC}"
    exit 1
fi

# 4. Konfiguracja użytkownika
# Musimy wiedzieć, dla jakiego użytkownika tworzyć config, bo teraz jesteśmy rootem
REAL_USER=${SUDO_USER:-$USER}
USER_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
CONFIG_DIR="$USER_HOME/.config/mygit"
CONFIG_FILE="$CONFIG_DIR/config.json"

echo "⚙️  Konfiguracja dla użytkownika: $REAL_USER"

mkdir -p "$CONFIG_DIR"
chown "$REAL_USER:$REAL_USER" "$CONFIG_DIR"

# Jeśli config nie istnieje, zapytaj o URL
if [ ! -f "$CONFIG_FILE" ]; then
    echo ""
    echo -e "${BLUE}📡 Konfiguracja połączenia z serwerem mygit${NC}"
    read -p "Podaj adres IP serwera (np. 192.168.0.130): " SERVER_IP
    read -p "Podaj port serwera (domyślnie 3350): " SERVER_PORT
    SERVER_PORT=${SERVER_PORT:-3350}
    
    BASE_URL="http://${SERVER_IP}:${SERVER_PORT}"
    
    # Tworzenie JSONa
    cat > "$CONFIG_FILE" <<EOL
{
  "backend": {
    "baseUrl": "$BASE_URL"
  },
  "client": {
    "timeout": 60
  }
}
EOL
    chown "$REAL_USER:$REAL_USER" "$CONFIG_FILE"
    echo -e "${GREEN}✅ Utworzono konfigurację w: $CONFIG_FILE${NC}"
else
    echo "ℹ️  Plik konfiguracji już istnieje, pomijam."
fi

echo ""
echo -e "${GREEN}🎉 Instalacja zakończona!${NC}"
echo "Możesz teraz wpisać: mygit list"
echo "Aby sprawdzić połączenie."