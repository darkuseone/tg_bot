import type { Stats } from "./repo";

export function formatStats(stats: Stats): string {
  const conversion = stats.starts === 0 ? 0 : Math.round((stats.purchases / stats.starts) * 1000) / 10;
  const sources = stats.bySource.length
    ? stats.bySource.map((row) => `• ${row.source || "без метки"} — ${row.count}`).join("\n")
    : "• пока нет";
  const products = stats.byProduct.length
    ? stats.byProduct.map((row) => `• ${row.product} — ${row.count}`).join("\n")
    : "• пока нет";
  return [
    "Статистика",
    "",
    `Старты: ${stats.starts}`,
    `Покупки: ${stats.purchases}`,
    `Конверсия: ${conversion}%`,
    "",
    "Источники:",
    sources,
    "",
    "Продукты:",
    products,
  ].join("\n");
}
