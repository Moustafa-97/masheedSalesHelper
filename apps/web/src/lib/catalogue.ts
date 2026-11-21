import type { Locale, Variant, VariantZone } from "./types";

/** Arabic names for the ERP's regions and categories; anything unknown shows as exported. */
const ZONES_AR: Record<string, string> = {
  Riyadh: "الرياض",
  Jeddah: "جدة",
  Makkah: "مكة",
  Madinah: "المدينة",
  Dammam: "الدمام",
  AlJubail: "الجبيل",
  AlAhsa: "الأحساء",
  AlKhafji: "الخفجي",
  KhamisMus: "خميس مشيط",
  Jazan: "جازان",
  Yanbu: "ينبع",
  Qassim: "القصيم",
  Taif: "الطائف",
  AlUla: "العلا",
};

const CATEGORIES_AR: Record<string, string> = {
  Steel: "حديد",
  "Grey Cement": "أسمنت رمادي",
  "White Cement": "أسمنت أبيض",
  "Construction Finishing": "مواد تشطيب",
  "Blocks & Bricks": "بلوك وطوب",
  Gypsum: "جبس",
  Precasting: "خرسانة مسبقة الصب",
  "Sand and Aggregates": "رمل وبحص",
  Wood: "خشب",
};

const ZONES_EN: Record<string, string> = { KhamisMus: "Khamis Mushait", AlJubail: "Al Jubail", AlAhsa: "Al Ahsa", AlKhafji: "Al Khafji", AlUla: "AlUla" };

export const zoneName = (zone: string, locale: Locale) =>
  (locale === "ar" ? ZONES_AR[zone] : ZONES_EN[zone]) ?? zone;

export const categoryName = (category: string, locale: Locale) =>
  (locale === "ar" ? CATEGORIES_AR[category] : undefined) ?? category;

const LOAD_WORDS: [RegExp, { ar: string; en: string }][] = [
  [/pallet/i, { ar: "كيس على بالتات", en: "bags, palletised" }],
  [/bag/i, { ar: "كيس", en: "bags" }],
  [/piece|pcs/i, { ar: "حبة", en: "pieces" }],
  [/trailer/i, { ar: "تريلا", en: "trailer" }],
  [/ton/i, { ar: "طن", en: "ton" }],
  [/gal/i, { ar: "جالون", en: "gallon" }],
];

/** "580 Bags" -> "580 كيس"; "Trailer 18" -> "تريلا 18"; "Ton" -> "طن". */
export function loadLabel(z: Pick<VariantZone, "label" | "loadQty">, locale: Locale) {
  const word = LOAD_WORDS.find(([re]) => re.test(z.label))?.[1][locale];
  if (!word) return z.label;
  if (z.loadQty === null) return word;
  return /trailer/i.test(z.label) ? `${word} ${z.loadQty}` : `${z.loadQty} ${word}`;
}

export const zonesOf = (variants: Variant[]) =>
  [...new Set(variants.flatMap((v) => v.zones.map((z) => z.zone)))].sort();

/** Riyadh first when it exists, since that's where the first rep works. */
export const DEFAULT_ZONE = "Riyadh";
