export type Role = "ADMIN" | "REP" | "CLIENT";
export type Locale = "ar" | "en";

export interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  jobTitle: string | null;
  clientId: string | null;
  locale: Locale;
  isActive: boolean;
  supplyContactName: string | null;
  supplyContactPhone: string | null;
}

export type ClientStatus = "ACTIVE" | "PROSPECT" | "INACTIVE";

export interface Client {
  id: string;
  code: string | null;
  name: string;
  status: ClientStatus;
  repId: string;
  rep?: User;
  city: string | null;
  address: string | null;
  crNumber: string | null;
  vatNumber: string | null;
  paymentTermsDays: number;
  overdueStopDays: number | null;
  creditLimit: number;
  openingBalance: number;
  purchasingName: string | null;
  purchasingPhone: string | null;
  purchasingEmail: string | null;
  notes: string | null;
  createdAt: string;
}

export type Unit = "TON" | "BAG" | "M3" | "PIECE" | "KG" | "METER" | "GALLON" | "TRAILER";

export interface Brand {
  id: string;
  name: string;
  nameEn: string | null;
}

export interface Product {
  id: string;
  name: string;
  nameEn: string | null;
  category: string;
}

export interface Variant {
  id: string;
  productId: string;
  product: Product;
  brandId: string | null;
  brand: Brand | null;
  spec: string;
  unit: Unit;
  minQty: number | null;
  supplierName: string | null;
  isActive: boolean;
  erpName: string | null;
  colors: string[];
  zones: VariantZone[];
}

export interface VariantZone {
  id: string;
  zone: string;
  /** ERP unit text, e.g. "580 Bags" */
  label: string;
  loadQty: number | null;
}

export interface ImportSummary {
  rows: number;
  items: number;
  brandsCreated: number;
  productsCreated: number;
  variantsCreated: number;
  variantsUpdated: number;
  zones: number;
  notInFile: number;
}

/* ---------- Phase 2: projects, payments, orders ---------- */

export interface ClientProject {
  id: string;
  clientId: string;
  name: string;
  mapsUrl: string | null;
  contacts: string | null;
  isActive: boolean;
}

export interface ClientAccount {
  creditLimit: number;
  openingBalance: number;
  ordersTotal: number;
  paid: number;
  pending: number;
  guarantees: number;
  approvedCredit: number;
  usagePct: number | null;
  balance: number;
  available: number;
  paymentTermsDays: number;
}

export interface FileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export type PaymentMethod = "TRANSFER" | "CASH" | "CHEQUE" | "LC";

export interface Payment {
  id: string;
  clientId: string;
  orderId: string | null;
  amount: number;
  date: string;
  method: PaymentMethod;
  status: "PENDING" | "RECEIVED" | "BOUNCED" | "RETURNED";
  lcAttention: boolean;
  creditApprovedAmount: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalUntil: string | null;
  approvalValid: boolean;
  approvalFile: FileMeta | null;
  dueDate: string | null;
  bank: string | null;
  collectedDate: string | null;
  reference: string | null;
  notes: string | null;
  file: FileMeta | null;
  removedAt: string | null;
  removedReason: string | null;
}

export type OrderStatus =
  | "NEW"
  | "SENT_TO_SUPPLY"
  | "SUPPLY_RECEIVED"
  | "AT_SUPPLIER"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "INVOICED"
  | "CANCELLED";

export type DocumentType = "PO" | "DELIVERY_NOTE" | "PURCHASE_INVOICE" | "SALES_INVOICE" | "OTHER";

export interface Totals {
  subtotal: number;
  vat: number;
  total: number;
}

export interface OrderSummary {
  id: string;
  number: string;
  orderDate: string;
  status: OrderStatus;
  client: { id: string; name: string };
  project: { id: string; name: string } | null;
  lineCount: number;
  totals: Totals;
  dueDate: string;
  deliveredPct: number;
  lastActivityAt: string;
}

export interface OrdersSummary {
  open: number;
  done: number;
  cancelled: number;
  staleDays: number;
  staleCount: number;
  stale: OrderSummary[];
  followUps: FollowUp[];
  nearLimit: CreditWatchRow[];
  overdueClients: CreditWatchRow[];
  receivables: { balance: number; overdue: number };
  byStatus: Partial<Record<OrderStatus, number>>;
}

export interface StatementEntry {
  date: string;
  type: "ORDER" | "PAYMENT";
  id: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementHeld {
  id: string;
  method: PaymentMethod | GuaranteeType;
  amount: number | null;
  date: string | null;
  dueDate: string | null;
  reference: string | null;
  bank: string | null;
}

export interface Statement {
  client: { id: string; name: string; code: string | null };
  from: string | null;
  to: string | null;
  opening: number;
  entries: StatementEntry[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
  pending: StatementHeld[];
  guarantees: StatementHeld[];
}

export interface OrderLine {
  id: string;
  variantId: string;
  description: string;
  unit: Unit;
  color: string | null;
  qty: number;
  unitPrice: number;
  purchasePrice: number | null;
  belowMinReason: string | null;
  minQty: number | null;
  delivered: number;
  remaining: number;
  removedAt: string | null;
  removedReason: string | null;
}

export interface OrderDocument {
  id: string;
  type: DocumentType;
  reference: string | null;
  file: FileMeta;
  createdAt: string;
  removedAt: string | null;
  removedReason: string | null;
}

export interface Delivery {
  id: string;
  date: string;
  reference: string | null;
  documentId: string | null;
  notes: string | null;
  lines: { id: string; orderLineId: string; qty: number }[];
  removedAt: string | null;
  removedReason: string | null;
}

export interface SalesInvoice {
  id: string;
  number: string;
  date: string;
  amount: number;
  documentId: string | null;
  removedAt: string | null;
  removedReason: string | null;
}

export interface OrderEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  user: { id: string; name: string };
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  number: string;
  orderDate: string;
  status: OrderStatus;
  vatRate: number;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  clientId: string;
  projectId: string | null;
  client: {
    id: string;
    name: string;
    paymentTermsDays: number;
    purchasingName: string | null;
    purchasingPhone: string | null;
  };
  project: ClientProject | null;
  createdBy: { id: string; name: string };
  lines: OrderLine[];
  totals: Totals;
  margin: { purchaseSubtotal: number; amount: number } | null;
  dueDate: string;
  checklist: {
    fullyDelivered: boolean;
    hasDeliveryNote: boolean;
    hasPurchaseInvoice: boolean;
    hasSalesInvoice: boolean;
  };
  documents: OrderDocument[];
  deliveries: Delivery[];
  invoices: SalesInvoice[];
  events: OrderEvent[];
  createdAt: string;
}

export interface FollowUp {
  id: string;
  source: "PAYMENT" | "GUARANTEE";
  kind: "CHEQUE_DUE" | "LC_ATTENTION" | "GUARANTEE_OLD" | "GUARANTEE_EXPIRING" | "AWAITING_REPLACEMENT";
  type: string;
  amount: number | null;
  date: string | null;
  clientId: string;
  clientName: string;
}

export interface CreditWatchRow {
  clientId: string;
  clientName: string;
  creditLimit: number;
  balance: number;
  available: number;
  usagePct: number | null;
  overdue: number;
  maxDaysOverdue: number;
  overdueStop: boolean;
  awaitingReplacement: number;
}

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";

export interface CreditProfile {
  aging: Record<AgingBucket, number>;
  items: {
    type: "OPENING" | "ORDER";
    id: string | null;
    reference: string;
    date: string;
    dueDate: string;
    amount: number;
    outstanding: number;
    daysOverdue: number;
    bucket: AgingBucket;
  }[];
  overdue: number;
  maxDaysOverdue: number;
  unapplied: number;
  avgCollectionDays: number | null;
  paidOrders: number;
  coveragePct: number | null;
  noGuaranteeApproval: { approvedBy: string | null; approvedAt: string | null; amount: number | null } | null;
  awaitingReplacement: number;
  overdueStopDays: number;
  overdueStop: boolean;
}

export type GuaranteeType = "EPN" | "LC" | "LG" | "CHEQUE" | "NO_GUARANTEE";

export interface Guarantee {
  id: string;
  type: GuaranteeType;
  status: "ACTIVE" | "RETURNED" | "CONVERTED" | "BOUNCED" | "EXPIRED";
  amount: number | null;
  reference: string | null;
  issuer: string | null;
  date: string | null;
  expiryDate: string | null;
  file: FileMeta | null;
  creditApprovedAmount: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalFile: FileMeta | null;
  paymentId: string | null;
  replacedByGuaranteeId: string | null;
  awaitingReplacement: boolean;
  notes: string | null;
  removedAt: string | null;
  removedReason: string | null;
}
