export function normalizeCatalogName(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ar-EG");
}

