#!/bin/bash

# =============================================================================
# 🧠 mygit - Instalator Linux
# Wersja: 1.2.0
# =============================================================================

# Sprawdź czy uruchomiono jako root, jeśli nie - poproś o hasło
if [ "$EUID" -ne 0 ]; then
    echo "🧠 Instalowanie mygit wymaga uprawnień root."
    echo "🔐 Podaj hasło sudo:"
    
    # Uruchom siebie ponownie z sudo
    exec sudo "$0" "$@"
fi

# Katalog, w którym znajduje się ten skrypt
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Funkcje pomocnicze
log_info() {
    echo -e "\033[1;34mℹ️  $1\033[0m"
}

log_success() {
    echo -e "\033[1;32m✅ $1\033[0m"
}

log_warning() {
    echo -e "\033[1;33m⚠️  $1\033[0m"
}

log_error() {
    echo -e "\033[1;31m❌ $1\033[0m"
}

clear
echo "========================================="
echo "🧠 mygit - Instalator systemu wersjonowania"
echo "========================================="
echo ""

# =============================================================================
# KROK 1: Sprawdź wymagania
# =============================================================================
log_info "Krok 1: Sprawdzanie wymagań systemowych..."

# Sprawdź czy Node.js jest zainstalowany
if ! command -v node &> /dev/null; then
    log_error "Node.js nie jest zainstalowany!"
    echo "Zainstaluj Node.js (wersja 18 lub nowsza):"
    echo "  https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Wymagany Node.js w wersji 18 lub nowszej (obecna: $NODE_VERSION)"
    exit 1
fi
log_success "Node.js $NODE_VERSION jest zainstalowany"

# Sprawdź czy npm jest zainstalowany
if ! command -v npm &> /dev/null; then
    log_error "npm nie jest zainstalowany!"
    exit 1
fi
log_success "npm jest zainstalowany"

# Znajdź ścieżkę do node
NODE_PATH=$(which node)
log_info "Ścieżka do Node.js: $NODE_PATH"

# Sprawdź czy sshpass jest zainstalowany (dla zdalnego dostępu)
if ! command -v sshpass &> /dev/null; then
    log_warning "sshpass nie jest zainstalowany. Będzie potrzebny do zdalnego dostępu."
    log_info "Instalowanie sshpass..."
    if command -v apt-get &> /dev/null; then
        apt-get install -y sshpass
    elif command -v yum &> /dev/null; then
        yum install -y sshpass
    elif command -v dnf &> /dev/null; then
        dnf install -y sshpass
    elif command -v pacman &> /dev/null; then
        pacman -Sy --noconfirm sshpass
    else
        log_error "Nie znaleziono menedżera pakietów. Zainstaluj sshpass ręcznie."
    fi
fi

# =============================================================================
# KROK 2: Wybierz typ instalacji
# =============================================================================
echo ""
echo "🔧 Wybierz typ instalacji:"
echo "   1) Tylko lokalna wersja (mygit-local)"
echo "   2) Lokalna + zdalna (mygit + mygit-local)"
echo "   3) Tylko zdalna (mygit)"
echo ""
read -p "Twój wybór [1-3]: " INSTALL_TYPE

case $INSTALL_TYPE in
    1)
        REMOTE_INSTALL=false
        LOCAL_INSTALL=true
        log_info "Wybrałeś instalację tylko lokalną"
        ;;
    2)
        REMOTE_INSTALL=true
        LOCAL_INSTALL=true
        log_info "Wybrałeś instalację lokalną i zdalną"
        ;;
    3)
        REMOTE_INSTALL=true
        LOCAL_INSTALL=false
        log_info "Wybrałeś instalację tylko zdalną"
        ;;
    *)
        log_error "Nieprawidłowy wybór!"
        exit 1
        ;;
esac

# =============================================================================
# KROK 3: Konfiguracja zdalna (jeśli potrzebna)
# =============================================================================
if [ "$REMOTE_INSTALL" = true ]; then
    echo ""
    echo "🔧 Konfiguracja zdalnego dostępu do Synology DSM"
    echo "   (Pozostaw puste dla wartości domyślnych)"
    echo ""
    
    # IP serwera Synology
    read -p "Adres IP Synology [192.168.0.130]: " SSH_HOST
    SSH_HOST=${SSH_HOST:-127.0.0.1}
    
    # Nazwa użytkownika SSH
    read -p "Nazwa użytkownika SSH [Paffcio]: " SSH_USER
    SSH_USER=${SSH_USER:-admin}
    
    # Hasło SSH
    read -sp "Hasło SSH: " SSH_PASS
    echo ""
    SSH_PASS=${SSH_PASS:-admin123}
    
    # Ścieżka zdalna
    read -p "Ścieżka zdalna SSH [/volume1/mygit]: " REMOTE_DIR
    REMOTE_DIR=${REMOTE_DIR:-/home/mygit}
    
    # Port SSH
    read -p "Port SSH [22]: " SSH_PORT
    SSH_PORT=${SSH_PORT:-22}
    
    # URL backendu
    BACKEND_URL="http://${SSH_HOST}:3350"
    
    # Sprawdź połączenie
    log_info "Testowanie połączenia z Synology..."
    if sshpass -p "$SSH_PASS" ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "$SSH_PORT" "${SSH_USER}@${SSH_HOST}" "echo 'Połączenie SSH OK'" 2>/dev/null; then
        log_success "Połączenie SSH działa poprawnie"
        
        # Sprawdź ścieżkę do node na zdalnym serwerze
        log_info "Sprawdzanie ścieżki do Node.js na zdalnym serwerze..."
        REMOTE_NODE_PATH=$(sshpass -p "$SSH_PASS" ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "$SSH_PORT" "${SSH_USER}@${SSH_HOST}" "which node 2>/dev/null || echo '/usr/bin/node'")
        if [ -n "$REMOTE_NODE_PATH" ]; then
            log_success "Zdalna ścieżka do Node.js: $REMOTE_NODE_PATH"
        else
            REMOTE_NODE_PATH="/usr/bin/node"
            log_warning "Nie znaleziono Node.js na zdalnym serwerze, używam domyślnej: $REMOTE_NODE_PATH"
        fi
    else
        log_warning "Nie udało się połączyć przez SSH. Upewnij się, że:"
        echo "   - Serwer Synology jest włączony"
        echo "   - SSH jest włączony w DSM"
        echo "   - Dane logowania są poprawne"
        read -p "Kontynuować mimo błędów? (t/n): " CONTINUE_ON_ERROR
        if [[ ! "$CONTINUE_ON_ERROR" =~ ^[Tt]$ ]]; then
            exit 1
        fi
        REMOTE_NODE_PATH="/usr/bin/node"
    fi
fi

# =============================================================================
# KROK 4: Instalacja zależności
# =============================================================================
echo ""
log_info "Krok 4: Instalowanie zależności Node.js..."

cd "$PROJECT_ROOT"

# Sprawdź czy package.json istnieje
if [ ! -f "package.json" ]; then
    log_error "Nie znaleziono package.json w $PROJECT_ROOT"
    exit 1
fi

# Zainstaluj zależności
if npm install 2>&1 | tee /tmp/mygit-npm-install.log; then
    log_success "Zależności zainstalowane pomyślnie"
else
    log_error "Błąd instalacji zależności"
    echo "Sprawdź log: /tmp/mygit-npm-install.log"
    exit 1
fi

# Wygeneruj Tailwind CSS
log_info "Generowanie Tailwind CSS..."
if node generate-tailwind.js 2>&1; then
    log_success "Tailwind CSS wygenerowany"
else
    log_warning "Nie udało się wygenerować Tailwind CSS"
fi

# =============================================================================
# KROK 5: Tworzenie plików binarnych
# =============================================================================
echo ""
log_info "Krok 5: Tworzenie plików wykonywalnych..."

# Utwórz katalog bin jeśli nie istnieje
mkdir -p "$PROJECT_ROOT/bin"

# =============================================================================
# KROK 5A: Tworzenie mygit-local (lokalna wersja)
# =============================================================================
if [ "$LOCAL_INSTALL" = true ]; then
    cat > "$PROJECT_ROOT/bin/mygit-local" << 'EOF'
#!/usr/bin/env bash

# =============================================================================
# 🧠 mygit-local - Lokalna wersja developerska
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Uruchom CLI
exec node "$PROJECT_ROOT/cli/index.js" "$@"

EOF
    chmod +x "$PROJECT_ROOT/bin/mygit-local"
    log_success "Utworzono mygit-local"
fi

# =============================================================================
# KROK 5B: Tworzenie mygit (zdalna wersja)
# =============================================================================
if [ "$REMOTE_INSTALL" = true ]; then
    # Używamy odkrytej ścieżki do node lub domyślnej
    REMOTE_NODE_PATH=${REMOTE_NODE_PATH:-"/usr/bin/node"}
    
    cat > "$PROJECT_ROOT/bin/mygit" << EOF
#!/usr/bin/env bash

# =============================================================================
# 🧠 mygit - Zdalny system wersjonowania na Synology DSM
# Wrapper przez SSH dla Synology DSM
# =============================================================================

# Dane logowania (skonfigurowane podczas instalacji)
SSH_USER="$SSH_USER"
SSH_HOST="$SSH_HOST"
SSH_PORT="$SSH_PORT"
REMOTE_DIR="$REMOTE_DIR"
REMOTE_CLI="\${REMOTE_DIR}/cli/index.js"
SSH_PASS="$SSH_PASS"
BACKEND_URL="$BACKEND_URL"
REMOTE_NODE_PATH="$REMOTE_NODE_PATH"

# Kolorowe outputy
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Funkcja logowania
log_info() {
    echo -e "\${BLUE}ℹ️  mygit:\${NC} \$1" >&2
}

log_success() {
    echo -e "\${GREEN}✅ mygit:\${NC} \$1" >&2
}

log_warning() {
    echo -e "\${YELLOW}⚠️  mygit:\${NC} \$1" >&2
}

log_error() {
    echo -e "\${RED}❌ mygit:\${NC} \$1" >&2
}

log_command() {
    echo -e "\${CYAN}🧠 mygit:\${NC} \$1" >&2
}

# Pomoc dla użytkownika
if [ "\$1" = "--help" ] || [ "\$1" = "-h" ]; then
    echo -e "\${MAGENTA}"
    echo "🧠 mygit - Zdalny system wersjonowania na Synology DSM"
    echo "Globalny wrapper - wersja 1.2.0"
    echo -e "\${NC}"
    echo "Użycie:"
    echo "  mygit [komenda] [opcje]"
    echo ""
    echo "Podstawowe komendy:"
    echo "  init                  - Utwórz repozytorium w bieżącym folderu"
    echo "  comment [opis]        - Zmień opis repozytorium"
    echo "  save [opis]           - Zrób snapshot z opisem"
    echo "  log                   - Pokaż historię snapshotów"
    echo "  status                - Pokaż status repozytorium"
    echo "  list                  - Lista wszystkich repozytoriów"
    echo "  delete [plik]         - Usuń snapshot"
    echo "  get [repo[@snapshot]] - Pobierz snapshot (najnowszy lub konkretny)"
    echo ""
    echo "Opcje dla get:"
    echo "  -f, --force          Nadpisz istniejące pliki"
    echo "  -b, --backup         Zrób backup przed nadpisaniem (domyślnie: tak)"
    echo "  -d, --dry-run        Tylko pokaż co by zostało zrobione"
    echo "  -o, --output DIR     Folder docelowy (domyślnie .)"
    echo "  -s, --skip-conflicts Pomiń pliki gdzie lokalne są nowsze"
    echo "  -t, --timeout SEC    Timeout pobierania (domyślnie: 60s)"
    echo ""
    echo "Przykłady get:"
    echo "  mygit get                                    # Pobierz najnowszy snapshot bieżącego repo"
    echo "  mygit get myproject                          # Pobierz najnowszy snapshot myproject"
    echo "  mygit get myproject@2025-12-04_15-30-00.zip  # Pobierz konkretny snapshot"
    echo "  mygit get myproject --force                  # Nadpisz wszystkie pliki"
    echo "  mygit get --output /backup                   # Pobierz do folderu /backup"
    echo "  mygit get --skip-conflicts                   # Pomiń pliki z konfliktami"
    exit 0
fi

# nazwa bieżącego folderu (repo)
REPO_NAME=\$(basename "\$(pwd)")

# Jeśli nie podano argumentów – pokaż pomoc
if [ \$# -eq 0 ]; then
    ARGS="--help"
else
    ARGS="\$*"
fi

# Dla komendy 'save' przesyłamy pliki przez pipe tar
if [ "\$1" = "save" ] || [ "\$1" = "push" ]; then
    log_info "Przygotowywanie do wysłania snapshotu..."
    
    # Utwórz tymczasowy katalog
    TEMP_DIR="/tmp/mygit_temp_\$\$"
    mkdir -p "\$TEMP_DIR"
    
    # Skopiuj pliki (pomijając node_modules i inne)
    rsync -av --exclude='node_modules' --exclude='.git' --exclude='.DS_Store' --exclude='*.log' . "\$TEMP_DIR/" > /dev/null 2>&1
    
    # Przesyłamy pliki przez tar pipe
    log_info "Wysyłanie plików na Synology..."
    
    if ! tar -czf - -C "\$TEMP_DIR" . 2>/dev/null | \
        sshpass -p "\$SSH_PASS" ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "\$SSH_PORT" \
            "\${SSH_USER}@\${SSH_HOST}" "
            # Utwórz tymczasowy katalog
            REMOTE_TEMP=\"/tmp/mygit_remote_\$\$\"
            mkdir -p \"\$REMOTE_TEMP\"
            
            # Rozpakuj przychodzące dane tar
            cd \"\$REMOTE_TEMP\" && tar -xzf -
            
            # Wykonaj komendę mygit
            cd '${REMOTE_DIR}'
            REPO_NAME='\${REPO_NAME}' SOURCE_PATH=\"\$REMOTE_TEMP\" \${REMOTE_NODE_PATH} '\${REMOTE_CLI}' \${ARGS}
            
            # Posprzątaj
            rm -rf \"\$REMOTE_TEMP\"
            "; then
        log_error "Błąd podczas przesyłania lub wykonywania komendy na Synology!"
        rm -rf "\$TEMP_DIR"
        exit 1
    fi
    
    # Posprzątaj
    rm -rf "\$TEMP_DIR"
    
else
    # Dla innych komend - normalne wykonanie
    if ! sshpass -p "\$SSH_PASS" ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "\$SSH_PORT" \
        "\${SSH_USER}@\${SSH_HOST}" "cd '\${REMOTE_DIR}' && REPO_NAME='\${REPO_NAME}' \${REMOTE_NODE_PATH} '\${REMOTE_CLI}' \${ARGS}"; then
        log_error "Błąd podczas wykonywania komendy na Synology!"
        exit 1
    fi
fi

EXIT_CODE=\$?

# Obsługa kodów wyjścia
if [ \$EXIT_CODE -eq 0 ]; then
    log_success "Komenda zakończona sukcesem"
else
    log_error "Komenda zakończona z kodem błędu: \$EXIT_CODE"
fi

exit \$EXIT_CODE
EOF
    chmod +x "$PROJECT_ROOT/bin/mygit"
    log_success "Utworzono mygit (zdalny)"
    
    # Zapisz konfigurację do pliku
    cat > "$PROJECT_ROOT/bin/mygit-config.txt" << EOF
# Konfiguracja mygit - wygenerowana $(date)
SSH_USER=$SSH_USER
SSH_HOST=$SSH_HOST
SSH_PORT=$SSH_PORT
REMOTE_DIR=$REMOTE_DIR
REMOTE_NODE_PATH=$REMOTE_NODE_PATH
BACKEND_URL=$BACKEND_URL
EOF
    chmod 600 "$PROJECT_ROOT/bin/mygit-config.txt"
    log_success "Zapisano konfigurację"
fi

# =============================================================================
# KROK 6: Instalacja w systemie
# =============================================================================
echo ""
log_info "Krok 6: Instalowanie w systemie..."

# Kopiuj pliki do /usr/local/bin
if [ "$LOCAL_INSTALL" = true ]; then
    cp "$PROJECT_ROOT/bin/mygit-local" /usr/local/bin/mygit-local
    chmod +x /usr/local/bin/mygit-local
    log_success "Zainstalowano mygit-local"
fi

if [ "$REMOTE_INSTALL" = true ]; then
    cp "$PROJECT_ROOT/bin/mygit" /usr/local/bin/mygit
    chmod +x /usr/local/bin/mygit
    log_success "Zainstalowano mygit (zdalny)"
fi

# =============================================================================
# KROK 7: Testowanie instalacji
# =============================================================================
echo ""
log_info "Krok 7: Testowanie instalacji..."

if [ "$LOCAL_INSTALL" = true ]; then
    if mygit-local --help &> /dev/null; then
        log_success "mygit-local działa poprawnie"
    else
        log_error "mygit-local nie działa poprawnie"
    fi
fi

if [ "$REMOTE_INSTALL" = true ]; then
    if mygit --help &> /dev/null; then
        log_success "mygit działa poprawnie"
    else
        log_error "mygit nie działa poprawnie"
    fi
fi

# =============================================================================
# KROK 8: Podsumowanie
# =============================================================================
echo ""
echo "========================================="
echo "✅ INSTALACJA ZAKOŃCZONA SUKCESEM!"
echo "========================================="
echo ""

if [ "$LOCAL_INSTALL" = true ]; then
    echo "🧠 mygit-local (lokalny):"
    echo "  mygit-local init          # Utwórz repozytorium"
    echo "  mygit-local save 'opis'   # Zrób snapshot"
    echo "  mygit-local get           # Pobierz snapshot"
    echo "  mygit-local log           # Historia snapshotów"
    echo ""
fi

if [ "$REMOTE_INSTALL" = true ]; then
    echo "🌐 mygit (zdalny - Synology):"
    echo "  mygit init                # Zdalna inicjalizacja"
    echo "  mygit save 'opis'         # Zdalny snapshot"
    echo "  mygit get                 # Pobierz z Synology"
    echo "  mygit log                 # Zdalna historia"
    echo ""
    echo "🔧 Konfiguracja zdalna:"
    echo "  Host: $SSH_HOST:$SSH_PORT"
    echo "  User: $SSH_USER"
    echo "  Path: $REMOTE_DIR"
    echo "  Node path: $REMOTE_NODE_PATH"
    echo ""
fi

echo "📁 Panel webowy:"
echo "  cd $PROJECT_ROOT"
echo "  npm start"
echo "  Panel dostępny: http://localhost:3350"
echo ""
echo "🔄 Konfigurację można zmienić w pliku:"
echo "  /usr/local/bin/mygit"
echo ""

log_success "Instalacja zakończona!"