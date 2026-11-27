import type { QuotationStatus, Unit } from "./types";

/** Printed on every quotation (from Masheed's template). */
export const COMPANY = {
  nameAr: "شركة مَشيد للتجارة والنقل المحدودة",
  footer: ["P.O. Box: 1618 Alkhobar 31952", "Tel.:+966138870114-Ext.4131", "Fax. +966138876920", "Al Khobar,Riyadh,Jeddah,Yanbu"],
};

export const UNIT_EN: Record<Unit, string> = {
  TON: "Ton",
  BAG: "Bags",
  M3: "M³",
  PIECE: "Pcs",
  KG: "Kg",
  METER: "M",
  GALLON: "Gallon",
  TRAILER: "Trailer",
};

/** The template's terms; payment follows the client's account (credit or cash). */
export function defaultTerms({ credit, validityDays = 7 }: { credit: boolean; validityDays?: number }) {
  return [
    "- The above shown prices are eligible to change in case of any future increase or decrease from Cement or Steel manufacturers or Transportation cost.",
    "- Delivery: Delivered As Agreed, upon order confirmation to your factory.",
    '- Availability: available "Conditioned to prior sale and/or purchase Confirmation by the customer".',
    `- Payment: ${credit ? "Credit" : "Cash"}.`,
    `- Price Validity: ${validityDays} day.`,
  ].join("\n");
}

/** 2026-11-18 -> 18\11\2026, as on the template. */
export const printDate = (iso: string) => iso.split("-").reverse().join("\\");

export const defaultPdfName = (date: string) => `Quotation ${date}`;

const one = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money2 = (n: number) => one.format(n);

export const quoteTone = (s: QuotationStatus) =>
  s === "ACCEPTED" ? "ok" : s === "LOST" ? "danger" : s === "SENT" ? "info" : "neutral";
