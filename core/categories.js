import fs from "fs-extra";
import path from "path";
import { config } from "./utils.js";

const CATEGORIES_FILE = path.join(config.dataDir, "categories.json");

// Domyślne kategorie
const DEFAULT_CATEGORIES = {
  categories: [
    {
      id: "bez-kategorii",
      name: "Bez kategorii",
      color: "#94a3b8", // neutralny szary
      icon: "📦",
      isDefault: true
    },
    {
      id: "web",
      name: "Web / Frontend",
      color: "#3b82f6", // niebieski
      icon: "🌐"
    },
    {
      id: "backend",
      name: "Backend / API",
      color: "#10b981", // zielony
      icon: "⚙️"
    },
    {
      id: "ai",
      name: "AI / Automatyzacja",
      color: "#f59e0b", // bursztynowy
      icon: "🤖"
    },
    {
      id: "dev-platform",
      name: "Platformy developerskie",
      color: "#0ea5e9", // jasny niebieski
      icon: "🧠"
    },
    {
      id: "infra",
      name: "System / Infrastruktura",
      color: "#22c55e", // mocniejszy zielony
      icon: "🖥️"
    },
    {
      id: "media",
      name: "Media / Wideo / Audio",
      color: "#ec4899", // róż / magenta
      icon: "🎬"
    },
    {
      id: "security",
      name: "Bezpieczeństwo",
      color: "#f43f5e", // czerwony
      icon: "🔐"
    },
    {
      id: "game",
      name: "Gry",
      color: "#ef4444", // czerwony gamingowy
      icon: "🎮"
    },
    {
      id: "tools",
      name: "Narzędzia pomocnicze",
      color: "#6366f1", // fiolet
      icon: "🔧"
    }
  ]
};

/**
 * Inicjalizuje plik kategorii jeśli nie istnieje
 */
export async function initCategories() {
  if (!await fs.pathExists(CATEGORIES_FILE)) {
    await fs.writeJson(CATEGORIES_FILE, DEFAULT_CATEGORIES, { spaces: 2 });
    console.log("📁 Utworzono plik kategorii z domyślnymi wartościami");
  }
}

/**
 * Pobiera wszystkie kategorie
 */
export async function getCategories() {
  await initCategories();
  try {
    const data = await fs.readJson(CATEGORIES_FILE);
    return data.categories || DEFAULT_CATEGORIES.categories;
  } catch (e) {
    console.error("Błąd odczytu kategorii:", e);
    return DEFAULT_CATEGORIES.categories;
  }
}

/**
 * Pobiera kategorię po ID lub nazwie
 */
export async function getCategory(idOrName) {
  const categories = await getCategories();
  return categories.find(c => 
    c.id === idOrName || 
    c.name.toLowerCase() === idOrName.toLowerCase()
  );
}

/**
 * Dodaje nową kategorię
 */
export async function addCategory(name, color = "#64748b", icon = "📁") {
  const categories = await getCategories();
  
  // Sprawdź czy nie istnieje
  const exists = categories.find(c => 
    c.name.toLowerCase() === name.toLowerCase()
  );
  
  if (exists) {
    throw new Error(`Kategoria '${name}' już istnieje`);
  }
  
  // Generuj ID
  const id = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  
  const newCategory = {
    id,
    name,
    color,
    icon,
    isDefault: false
  };
  
  categories.push(newCategory);
  
  await fs.writeJson(CATEGORIES_FILE, { categories }, { spaces: 2 });
  console.log(`✅ Dodano kategorię: ${name}`);
  
  return newCategory;
}

/**
 * Usuwa kategorię (tylko niestandardowe)
 */
export async function deleteCategory(idOrName) {
  const categories = await getCategories();
  
  const toDelete = categories.find(c => 
    c.id === idOrName || c.name.toLowerCase() === idOrName.toLowerCase()
  );
  
  if (!toDelete) {
    throw new Error(`Kategoria '${idOrName}' nie istnieje`);
  }
  
  if (toDelete.isDefault) {
    throw new Error(`Nie można usunąć domyślnej kategorii`);
  }
  
  const filtered = categories.filter(c => c.id !== toDelete.id);
  
  await fs.writeJson(CATEGORIES_FILE, { categories: filtered }, { spaces: 2 });
  console.log(`✅ Usunięto kategorię: ${toDelete.name}`);
  
  return toDelete;
}

/**
 * Pobiera domyślną kategorię
 */
export async function getDefaultCategory() {
  const categories = await getCategories();
  return categories.find(c => c.isDefault) || categories[0];
}