#!/usr/bin/env bash

#═══════════════════════════════════════════════════════════════════════════════
#  MYGIT — INSTALATOR / DEZINSTALATOR
#═══════════════════════════════════════════════════════════════════════════════

set -e

# ── Kolory ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'
BOLD='\033[1m'; RESET='\033[0m'

# ── Ścieżki ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_SRC="$SCRIPT_DIR/bin/mygit"
INSTALL_BIN="/usr/local/bin/mygit"

# Katalog konfiguracji (dla prawdziwego użytkownika, nawet gdy uruchamiamy jako root)
REAL_USER="${SUDO_USER:-$USER}"
if [[ "$REAL_USER" == "root" ]]; then
  USER_HOME="/root"
else
  USER_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6 2>/dev/null || echo "$HOME")"
fi
CONFIG_DIR="$USER_HOME/.config/mygit"
CONFIG_FILE="$CONFIG_DIR/config"

#═══════════════════════════════════════════════════════════════════════════════
# FUNKCJE POMOCNICZE
#═══════════════════════════════════════════════════════════════════════════════

print_header() {
    echo -e "${CYAN}${BOLD}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              MYGIT — INSTALATOR v2.2                        ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${RESET}"
}

print_section() { echo ""; echo -e "${BLUE}${BOLD}▶ $1${RESET}"; echo -e "${GRAY}$(printf '─%.0s' {1..60})${RESET}"; }
print_success()  { echo -e "  ${GREEN}✓${RESET} $1"; }
print_error()    { echo -e "  ${RED}✗${RESET} $1"; }
print_warning()  { echo -e "  ${YELLOW}⚠${RESET} $1"; }
print_info()     { echo -e "  ${CYAN}ℹ${RESET} $1"; }
print_item()     { echo -e "  ${GRAY}•${RESET} $1"; }

separator() { echo ""; echo -e "${GRAY}$(printf '─%.0s' {1..60})${RESET}"; echo ""; }

confirm() {
    local prompt="$1" default="${2:-n}"
    local hint
    [[ "$default" == "y" ]] && hint="${GREEN}T${RESET}${GRAY}/n${RESET}" || hint="${GRAY}t/${RESET}${RED}N${RESET}"
    while true; do
        echo -ne "  ${YELLOW}?${RESET} ${prompt} [${hint}]: "
        read -r answer; answer="${answer:-$default}"
        case "${answer,,}" in
            t|tak|y|yes) return 0 ;;
            n|nie|no)    return 1 ;;
            *) echo -e "  ${RED}Odpowiedz 't' (tak) lub 'n' (nie)${RESET}" ;;
        esac
    done
}

#═══════════════════════════════════════════════════════════════════════════════
# WYKRYWANIE STANU
#═══════════════════════════════════════════════════════════════════════════════

detect_installation() {
    [[ -f "$INSTALL_BIN" ]] && echo "installed" || echo "none"
}

get_installed_version() {
    if [[ -f "$INSTALL_BIN" ]]; then
        grep -m1 'VERSION' "$INSTALL_BIN" 2>/dev/null | grep -oP '\d+\.\d+(\.\d+)?' | head -1 || echo "unknown"
    else
        echo "none"
    fi
}

get_new_version() {
    if [[ -f "$BIN_SRC" ]]; then
        grep -m1 'VERSION' "$BIN_SRC" 2>/dev/null | grep -oP '\d+\.\d+(\.\d+)?' | head -1 || echo "unknown"
    else
        echo "unknown"
    fi
}

check_deps() {
    local missing=0
    for cmd in curl jq zip unzip; do
        command -v "$cmd" >/dev/null 2>&1 || { print_error "Brakuje: $cmd"; missing=1; }
    done
    return $missing
}

require_root() {
    if [[ "$EUID" -ne 0 ]]; then
        print_warning "Operacja wymaga uprawnień root — ponawiam z sudo..."
        exec sudo "$0" "$@"
    fi
}

#═══════════════════════════════════════════════════════════════════════════════
# WYŚWIETLANIE STATUSU
#═══════════════════════════════════════════════════════════════════════════════

show_status() {
    local status="$1" installed_ver="$2" new_ver="$3"
    print_section "Stan instalacji"
    echo ""

    if [[ "$status" == "none" ]]; then
        print_info "mygit nie jest zainstalowany"
        echo ""
        echo -e "  Wersja do instalacji:  ${BOLD}${new_ver}${RESET}"
    else
        if [[ "$installed_ver" == "$new_ver" ]]; then
            echo -e "  Wersja zainstalowana:  ${BOLD}${installed_ver}${RESET}  ${GREEN}(aktualna)${RESET}"
        else
            echo -e "  Wersja zainstalowana:  ${BOLD}${installed_ver}${RESET}"
            echo -e "  Nowa wersja:           ${BOLD}${new_ver}${RESET}  ${CYAN}(dostępna aktualizacja)${RESET}"
        fi
        echo ""
        [[ -f "$INSTALL_BIN" ]]  && print_success "Binarka:        $INSTALL_BIN" \
                                 || print_warning "Binarka:        brak ($INSTALL_BIN)"
        [[ -d "$CONFIG_DIR" ]]   && print_success "Konfiguracja:   $CONFIG_DIR" \
                                 || print_item    "Konfiguracja:   brak (utworzona przy 1. uruchomieniu)"
    fi
    echo ""
}

#═══════════════════════════════════════════════════════════════════════════════
# MENU
#═══════════════════════════════════════════════════════════════════════════════

show_menu() {
    local status="$1" installed_ver="$2" new_ver="$3"
    echo -e "${BOLD}  Co chcesz zrobić?${RESET}"
    echo ""

    if [[ "$status" == "none" ]]; then
        echo -e "  ${BOLD}[1]${RESET} Zainstaluj mygit ${GRAY}(${new_ver})${RESET}"
        echo -e "  ${BOLD}[2]${RESET} Anuluj"
    else
        if [[ "$installed_ver" == "$new_ver" ]]; then
            echo -e "  ${BOLD}[1]${RESET} Reinstaluj  ${GRAY}(ta sama wersja ${new_ver})${RESET}"
        else
            echo -e "  ${BOLD}[1]${RESET} Aktualizuj  ${GRAY}(${installed_ver} → ${new_ver})${RESET}"
        fi
        echo -e "  ${BOLD}[2]${RESET} Odinstaluj"
        echo -e "  ${BOLD}[3]${RESET} Anuluj"
    fi
    echo ""
}

#═══════════════════════════════════════════════════════════════════════════════
# INSTALACJA
#═══════════════════════════════════════════════════════════════════════════════

install_internal() {
    print_section "Instalacja mygit"
    echo ""

    # Sprawdź plik źródłowy
    if [[ ! -f "$BIN_SRC" ]]; then
        print_error "Nie znaleziono pliku bin/mygit w $SCRIPT_DIR"
        exit 1
    fi

    # Sprawdź zależności
    print_info "Sprawdzanie zależności..."
    if ! check_deps; then
        echo ""
        print_error "Zainstaluj brakujące pakiety:"
        echo -e "  ${CYAN}sudo apt install curl jq zip unzip${RESET}"
        exit 1
    fi
    print_success "Wszystkie zależności dostępne"

    # Kopiuj binarkę
    print_info "Instalowanie binarki..."
    cp "$BIN_SRC" "$INSTALL_BIN"
    chmod +x "$INSTALL_BIN"
    print_success "Zainstalowano: $INSTALL_BIN"

    # Konfiguracja serwera
    separator

    echo -e "  ${CYAN}${BOLD}Konfiguracja serwera${RESET}"
    echo ""

    # Odczytaj istniejącą konfigurację jeśli jest
    local existing_host="" existing_port=""
    if [[ -f "$CONFIG_FILE" ]]; then
        existing_host="$(grep '^HOST=' "$CONFIG_FILE" 2>/dev/null | cut -d= -f2)"
        existing_port="$(grep '^PORT=' "$CONFIG_FILE" 2>/dev/null | cut -d= -f2)"
        print_info "Znaleziono istniejącą konfigurację (host: ${existing_host:-brak}, port: ${existing_port:-brak})"
        echo ""
        if ! confirm "Zmienić konfigurację serwera?" "n"; then
            print_success "Zachowano istniejącą konfigurację"
            separator
            show_install_summary
            return
        fi
        echo ""
    fi

    echo -ne "  ${YELLOW}?${RESET} Adres serwera mygit ${GRAY}[${existing_host:-localhost}]${RESET}: "
    read -r host
    host="${host:-${existing_host:-localhost}}"

    echo -ne "  ${YELLOW}?${RESET} Port serwera ${GRAY}[${existing_port:-3333}]${RESET}: "
    read -r port
    port="${port:-${existing_port:-3333}}"

    # Zapisz konfigurację
    mkdir -p "$CONFIG_DIR"
    cat > "$CONFIG_FILE" <<EOF
HOST=$host
PORT=$port
EOF
    # Upewnij się, że właściciel pliku konfiguracyjnego to prawdziwy użytkownik
    [[ "$EUID" -eq 0 && -n "$SUDO_USER" ]] && chown -R "$SUDO_USER:" "$CONFIG_DIR" 2>/dev/null || true

    print_success "Konfiguracja zapisana → $CONFIG_FILE"

    separator
    show_install_summary
}

show_install_summary() {
    echo -e "  ${GREEN}${BOLD}✓ Instalacja zakończona pomyślnie!${RESET}"
    echo ""
    print_item "mygit help             — lista wszystkich poleceń"
    print_item "mygit init             — inicjalizuj projekt"
    print_item "mygit save \"opis\"      — utwórz snapshot"
    print_item "mygit list             — pokaż repozytoria"
    echo ""
}

#═══════════════════════════════════════════════════════════════════════════════
# DEINSTALACJA
#═══════════════════════════════════════════════════════════════════════════════

uninstall_internal() {
    local interactive="${1:-true}"

    print_section "Deinstalacja mygit"
    echo ""

    echo -e "  ${BOLD}Zostanie usunięte:${RESET}"
    [[ -f "$INSTALL_BIN" ]] && print_item "Binarka: $INSTALL_BIN"
    echo ""

    # Konfiguracja — pytanie z opisem
    if [[ -d "$CONFIG_DIR" ]]; then
        echo -e "  ${BOLD}Twoja konfiguracja:${RESET}  ${CYAN}$CONFIG_DIR${RESET}"
        echo ""
        [[ -f "$CONFIG_FILE" ]] && print_item "${BOLD}config${RESET}  — adres i port serwera"
        echo ""
        echo -e "  ${YELLOW}Jeśli usuniesz konfigurację, przy reinstalacji trzeba będzie${RESET}"
        echo -e "  ${YELLOW}ponownie podać adres serwera.${RESET}"
        echo ""

        if confirm "Usunąć również konfigurację?" "n"; then
            rm -rf "$CONFIG_DIR"
            print_success "Konfiguracja usunięta"
        else
            print_success "Konfiguracja zachowana"
        fi
        echo ""
    fi

    if [[ "$interactive" == "true" ]]; then
        if ! confirm "Potwierdzasz deinstalację?" "n"; then
            print_info "Anulowano"; exit 0
        fi
        echo ""
    fi

    print_info "Usuwanie plików..."
    rm -f "$INSTALL_BIN" 2>/dev/null || true

    separator
    echo -e "  ${GREEN}${BOLD}✓ Deinstalacja zakończona${RESET}"
    echo ""
}

#═══════════════════════════════════════════════════════════════════════════════
# REINSTALACJA / AKTUALIZACJA
#═══════════════════════════════════════════════════════════════════════════════

reinstall_internal() {
    print_section "Aktualizacja / Reinstalacja"
    echo ""

    echo -e "  ${BOLD}Co się stanie:${RESET}"
    print_item "Binarka zostanie zastąpiona nową wersją"
    echo ""
    print_success "Konfiguracja ($CONFIG_DIR) zostanie zachowana"
    echo ""

    if ! confirm "Kontynuować?" "n"; then
        print_info "Anulowano"; exit 0
    fi

    echo ""
    uninstall_internal "false"
    echo ""
    install_internal
}

#═══════════════════════════════════════════════════════════════════════════════
# MAIN
#═══════════════════════════════════════════════════════════════════════════════

main() {
    # Większość operacji wymaga root (zapis do /usr/local/bin)
    require_root "$@"

    print_header

    local status installed_ver new_ver
    status=$(detect_installation)
    installed_ver=$(get_installed_version)
    new_ver=$(get_new_version)

    show_status "$status" "$installed_ver" "$new_ver"
    show_menu   "$status" "$installed_ver" "$new_ver"

    while true; do
        echo -ne "  ${BOLD}Wybór:${RESET} "
        read -r choice

        if [[ "$status" == "none" ]]; then
            case "$choice" in
                1) install_internal; break ;;
                2) print_info "Anulowano"; exit 0 ;;
                *) print_error "Wybierz 1 lub 2" ;;
            esac
        else
            case "$choice" in
                1) reinstall_internal; break ;;
                2) uninstall_internal "true"; break ;;
                3) print_info "Anulowano"; exit 0 ;;
                *) print_error "Wybierz 1, 2 lub 3" ;;
            esac
        fi
    done
}

main "$@"
