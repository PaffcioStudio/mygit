#!/bin/bash

# Jeśli nie jesteś root, uruchom ponownie skrypt z sudo
if [ "$EUID" -ne 0 ]; then
    echo "🧠 Dezinstalowanie mygit wymaga uprawnień root."
    exec sudo "$0" "$@"
fi

echo "🧠 Dezinstalowanie mygit..."

# Lista plików do usunięcia
FILES=("mygit-local" "mygit")

# Pętla przez pliki i usuwaj
for file in "${FILES[@]}"; do
    file_path="/usr/local/bin/$file"
    if [ -f "$file_path" ]; then
        rm "$file_path"
        echo "✅ Usunięto: $file_path"
    else
        echo "⚠️  Plik nie istnieje: $file_path"
    fi
done

echo "🗑️  Dezinstalacja zakończona."