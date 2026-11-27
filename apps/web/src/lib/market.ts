import type { LostReason, PriceSource } from "./types";

/** Common payment terms; any other number of days can be typed. 0 = cash. */
export const CREDIT_OPTIONS = [0, 30, 45, 60, 90];

export const LOST_REASONS: LostReason[] = ["PRICE", "PAYMENT_TERMS", "DELIVERY", "AVAILABILITY", "RELATIONSHIP", "OTHER"];

export const MANUAL_SOURCES: PriceSource[] = ["MARKET", "CLIENT", "SUPPLIER"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return iso(d);
};
