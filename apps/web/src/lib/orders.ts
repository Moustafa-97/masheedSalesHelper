import { api, formatNumber } from "./api";
import type { DocumentType, FileMeta, OrderDetail, OrderStatus, User } from "./types";

/** The order's steps in sequence; CANCELLED is outside the flow. */
export const ORDER_FLOW: OrderStatus[] = [
  "NEW",
  "SENT_TO_SUPPLY",
  "SUPPLY_RECEIVED",
  "AT_SUPPLIER",
  "IN_TRANSIT",
  "DELIVERED",
  "INVOICED",
];

export const DOCUMENT_TYPES: DocumentType[] = ["PO", "DELIVERY_NOTE", "PURCHASE_INVOICE", "SALES_INVOICE", "OTHER"];

export const statusTone = (s: OrderStatus) =>
  s === "CANCELLED" ? "neutral" : s === "INVOICED" ? "ok" : s === "DELIVERED" ? "ok" : s === "NEW" ? "warn" : "info";

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatMoney = (n: number | null | undefined) => money.format(n ?? 0);
export const formatQty = formatNumber;

/** Upload one file; returns its id to attach to an order or a payment. */
export async function uploadFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api<FileMeta>("/files", { method: "POST", body: form });
}

export const fileUrl = (id: string) => `/api/files/${id}`;

const UNIT_AR: Record<string, string> = {
  TON: "طن",
  BAG: "كيس",
  M3: "م³",
  PIECE: "حبة",
  KG: "كجم",
  METER: "متر",
  GALLON: "جالون",
  TRAILER: "تريلا",
};

/**
 * The message for the supply contact, without any prices:
 * order number, client, project, location, site contacts, then the quantities.
 */
export function supplyMessage(order: OrderDetail) {
  const lines = order.lines
    .filter((l) => !l.removedAt)
    .map((l) => `- ${formatQty(l.qty)} ${UNIT_AR[l.unit] ?? l.unit} ${l.description}${l.color ? ` (لون: ${l.color})` : ""}`);
  return [
    `طلبية رقم: ${order.number}`,
    `العميل: ${order.client.name}`,
    order.project && `المشروع: ${order.project.name}`,
    order.project?.mapsUrl && `الموقع: ${order.project.mapsUrl}`,
    order.project?.contacts && `أرقام التواصل:\n${order.project.contacts}`,
    "",
    "الطلبية:",
    ...lines,
    order.notes && `\nملاحظات: ${order.notes}`,
  ]
    .filter((x): x is string => typeof x === "string")
    .join("\n");
}

/** wa.me link to the rep's supply contact (or WhatsApp's contact picker when none is set). */
export function whatsappLink(text: string, me: Pick<User, "supplyContactPhone"> | undefined) {
  const phone = me?.supplyContactPhone?.replace(/\D/g, "");
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(text)}`;
}
