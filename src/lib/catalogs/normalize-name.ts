export function formatCatalogName(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeCatalogName(value: string) {
  return formatCatalogName(value).toLocaleLowerCase("ar-EG");
}
