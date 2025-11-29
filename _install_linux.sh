#!/bin/bash

# Sprawdź czy uruchomiono jako root, jeśli nie - poproś o hasło
if [ "$EUID" -ne 0 ]; then
    echo "🧠 Instalowanie mygit wymaga uprawnień root."
    echo "🔐 Podaj hasło sudo:"
    
    # Uruchom siebie ponownie z sudo
    exec sudo "$0" "$@"
fi

echo "🧠 Instalowanie mygit..."

# Ścieżka do folderu z plikami wykonywalnymi
BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin"

# Sprawdź czy pliki istnieją
if [ ! -f "$BIN_DIR/mygit-local" ]; then
    echo "❌ Błąd: Plik $BIN_DIR/mygit-local nie istnieje!"
    exit 1
fi

if [ ! -f "$BIN_DIR/mygit" ]; then
    echo "❌ Błąd: Plik $BIN_DIR/mygit nie istnieje!"
    exit 1
fi

# Skopiuj mygit-local
cp "$BIN_DIR/mygit-local" /usr/local/bin/mygit-local
chmod +x /usr/local/bin/mygit-local

# Skopiuj mygit (dla Synology)
cp "$BIN_DIR/mygit" /usr/local/bin/mygit
chmod +x /usr/local/bin/mygit

echo "✅ Zainstalowano:"
echo "   - mygit-local (lokalna wersja developerska)"
echo "   - mygit (wersja do wysyłania na Synology DSM)"
echo ""
echo "Przykłady użycia:"
echo "  mygit-local init          # Lokalna inicjalizacja"
echo "  mygit-local --server      # Uruchom serwer webowy" 
echo "  mygit init                # Zdalna inicjalizacja na Synology"
echo "  mygit save 'opis'         # Zdalny snapshot na Synology"
echo ""
echo "📁 Pliki zainstalowane z: $BIN_DIR"