/**
 * Reads Masheed's ERP product export (Zone, Category, Brand, Product name, Size, Color, Unit),
 * one row per item and region, and turns it into one entry per item with its regions and loads.
 */
import ExcelJS from 'exceljs';
import { Unit } from './product.entities.js';

export interface ErpRow {
  zone: string;
  category: string;
  brand: string;
  name: string;
  color: string;
  unit: string;
}

export interface ErpZoneLoad {
  zone: string;
  label: string;
  loadQty: number | null;
}

export interface ErpItem {
  erpName: string;
  brand: string;
  category: string;
  shortName: string;
  unit: Unit;
  colors: string[];
  zones: ErpZoneLoad[];
}

const COLUMNS = {
  zone: 'zone',
  category: 'category',
  brand: 'brand',
  name: 'product name',
  color: 'color',
  unit: 'unit',
} as const;

export class ErpFormatError extends Error {}

const clean = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'richText' in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  }
  if (typeof v === 'object' && 'result' in (v as object)) return clean((v as { result: unknown }).result);
  return String(v).replace(/﻿/g, '').replace(/\s+/g, ' ').trim();
};

/** Parses the first worksheet. Throws ErpFormatError when the expected columns are missing. */
export async function readErpWorkbook(buffer: Buffer | ArrayBuffer): Promise<ErpRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as ArrayBuffer);
  } catch {
    throw new ErpFormatError('The file is not a valid .xlsx workbook');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ErpFormatError('The workbook has no sheets');

  const header = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => header.set(clean(cell.value).toLowerCase(), col));
  const missing = Object.values(COLUMNS).filter((c) => !header.has(c));
  if (missing.length) throw new ErpFormatError(`Missing columns: ${missing.join(', ')}`);

  const rows: ErpRow[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const get = (k: keyof typeof COLUMNS) => clean(row.getCell(header.get(COLUMNS[k])!).value);
    const r: ErpRow = {
      zone: get('zone'),
      category: get('category'),
      brand: get('brand'),
      name: get('name'),
      color: get('color'),
      unit: get('unit'),
    };
    // The export ends with a blank row and an "Applied filters" note: both have no product name.
    if (r.name && r.brand && r.category) rows.push(r);
  });
  return rows;
}

const GENERIC_WORDS = new Set(['cement', 'gypsum', 'steel', 'factory', 'company', 'co', 'block', 'paints']);
const words = (s: string) => s.toLowerCase().match(/[a-z؀-ۿ]+/g) ?? [];

/** True when a leading chunk like "Alsafwa Cement" or "Hadeed (Sabic)" only names the brand. */
function namesBrand(chunk: string, brand: string): boolean {
  const brandWords = new Set(words(brand));
  const brandJoined = words(brand).join('');
  const chunkWords = words(chunk);
  if (!chunkWords.length) return false;
  return chunkWords.every(
    (w) => brandWords.has(w) || GENERIC_WORDS.has(w) || (w.length > 1 && brandJoined.includes(w)),
  );
}

const TYPOS: [RegExp, string][] = [
  [/\bEboxy\b/gi, 'Epoxy'],
  [/\bMidum\b/gi, 'Medium'],
  [/\bGuage\b/gi, 'Gauge'],
];

/**
 * A shorter display name without the brand, shared across brands so the same product groups together:
 * "Hadeed (Sabic), Steel Rebar, Grade 60, D:12mm, L:12 M" -> "Rebar G60 · 12mm · 12m".
 */
export function shortName(brand: string, erpName: string): string {
  let n = erpName.replace(/\s+/g, ' ').trim();

  const sep = n.match(/^(.+?)(\s*,\s*|\s*-\s*)(.+)$/);
  if (sep && namesBrand(sep[1], brand)) n = sep[3];

  for (const [re, to] of TYPOS) n = n.replace(re, to);

  n = n
    .replace(
      /^Steel (Rebar|Epoxy)\s*,\s*Grade (\d+)\s*,\s*D\s*:\s*0?(\d+)\s*mm\s*,\s*L\s*:\s*0?(\d+)\s*M$/i,
      (_, kind: string, g, d, l) => `${kind.toLowerCase() === 'epoxy' ? 'Epoxy Rebar' : 'Rebar'} G${g} · ${d}mm · ${l}m`,
    )
    .replace(
      /^Steel Reinforcing Mesh\s*,\s*Grade (\d+)\s*,\s*D\s*:\s*(\d+)\s*mm\s*,\s*Grid\s*:\s*([\d*]+)\s*,?$/i,
      (_, g, d, grid: string) => `Mesh G${g} · ${d}mm · ${grid.replace('*', '×')}`,
    )
    // "Cement Block, Hollow 3 Cells" -> "Block Hollow 3 Cells", but "Cement Block, Solid Block" -> "Solid Block"
    .replace(/^Cement Block\s*,\s*(.*)$/i, (_, rest: string) => (/\bblock\b/i.test(rest) ? rest : `Block ${rest}`))
    .replace(/(\S)\(/g, '$1 (')
    .replace(/\s*,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // "Finishing cement" and "Finishing Cement" are the same product.
  n = n.replace(/\bcement\b/g, 'Cement');
  return n || erpName;
}

/** "580 Bags" -> BAG, 580; "Ton" -> TON, null; "Trailer 18" -> TRAILER, 18. */
export function parseLoad(label: string): { unit: Unit; loadQty: number | null } {
  const num = label.match(/\d+(?:\.\d+)?/);
  const loadQty = num ? Number(num[0]) : null;
  const l = label.toLowerCase();
  const unit = /ton/.test(l)
    ? Unit.TON
    : /bag|pallet/.test(l)
      ? Unit.BAG
      : /pc|piece/.test(l)
        ? Unit.PIECE
        : /gal/.test(l)
          ? Unit.GALLON
          : /trailer/.test(l)
            ? Unit.TRAILER
            : /m3|m³/.test(l)
              ? Unit.M3
              : /kg/.test(l)
                ? Unit.KG
                : Unit.PIECE;
  return { unit, loadQty };
}

/** One entry per ERP item name, with every region and load it is sold in. */
export function groupErpRows(rows: ErpRow[]): ErpItem[] {
  const items = new Map<string, ErpItem & { unitVotes: Map<Unit, number> }>();
  for (const r of rows) {
    let item = items.get(r.name);
    if (!item) {
      item = {
        erpName: r.name,
        brand: r.brand,
        category: r.category,
        shortName: shortName(r.brand, r.name),
        unit: Unit.PIECE,
        colors: [],
        zones: [],
        unitVotes: new Map(),
      };
      items.set(r.name, item);
    }
    if (r.color && !item.colors.includes(r.color)) item.colors.push(r.color);
    const label = r.unit || 'Unit';
    const { unit, loadQty } = parseLoad(label);
    item.unitVotes.set(unit, (item.unitVotes.get(unit) ?? 0) + 1);
    if (r.zone && !item.zones.some((z) => z.zone === r.zone && z.label === label)) {
      item.zones.push({ zone: r.zone, label, loadQty });
    }
  }
  return [...items.values()].map(({ unitVotes, ...item }) => ({
    ...item,
    unit: [...unitVotes.entries()].sort((a, b) => b[1] - a[1])[0][0],
  }));
}
