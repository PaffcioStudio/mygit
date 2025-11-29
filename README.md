# mygit — lokalny system wersjonowania snapshotów

<p align="center">
  <img src="screenshots/1.png" alt="UI" width="800">
</p>

mygit to lekki, szybki i niezależny system snapshotów dla projektów, który nie wymaga korzystania z Git, GitHub ani zewnętrznych repozytoriów. Narzędzie pozwala tworzyć lokalne punkty przywracania (snapshoty), przeglądać historię, porównywać zmiany, pobierać wersje plików i zarządzać repozytoriami przez interfejs webowy oraz CLI.

---

<details>
<summary><b>📸 Zrzuty ekranu</b> (kliknij aby rozwinąć)</summary>
<br>

<p align="center">
  <img src="screenshots/2.png" alt="" width="800"><br><br>
  <img src="screenshots/3.png" alt="" width="800"><br><br>
  <img src="screenshots/4.png" alt="" width="800">
</p>

</details>

---

## ✨ Najważniejsze cechy
- Snapshoty projektów w jednym poleceniu
- Historia, diff, przeglądanie plików i folderów
- Przeglądarka snapshotów z UI (Web UI)
- Statystyki repozytoriów i wersji
- Możliwość pobierania snapshotów
- Wsparcie dla wielu repozytoriów
- Działa w sieci lokalnej i zdalnie (Synology, Linux, Docker)
- Lekki, bez zależności, zero konfiguracji

---

# 📦 Instalacja

## Wymagania
- Linux lub DSM (Synology)
- Node.js 18+
- Bash

## 1. Pobierz projekt
```
git clone https://github.com/USER/mygit
cd mygit
```

## 2. Nadaj uprawnienia instalatorowi
```
chmod +x ./_install_linux.sh
```

## 3. Instalacja systemowa
```
sudo ./_install_linux.sh
```

Binarki zostaną zainstalowane w:
```
/usr/local/bin/
```

Po instalacji dostępne komendy:
- `mygit`
- `mygit-local`

---

# 🧪 Szybki start (CLI)

## Utwórz repozytorium
```
mygit init
```

## Dodaj snapshot
```
mygit save "Opis zmian"
```

## Historia snapshotów
```
mygit log
```

---

# 🌐 Uruchomienie Web UI
```
node server.mjs
```

Domyślny adres:
```
http://localhost:5050
```

---

# 📁 Struktura projektu
```
/bin/
  mygit
  mygit-local
/screenshots/
  1.png
  2.png
  3.png
  4.png
/public/
server.mjs
_install_linux.sh
```

---

# 🧹 Odinstalowanie
```
sudo rm /usr/local/bin/mygit
sudo rm /usr/local/bin/mygit-local
```

---

# 📄 Licencja
GNU Affero General Public License v3.0
