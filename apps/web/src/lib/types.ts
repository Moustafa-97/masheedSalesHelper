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
  creditLimit: number;
  openingBalance: number;
  purchasingName: string | null;
  purchasingPhone: string | null;
  purchasingEmail: string | null;
  notes: string | null;
  createdAt: string;
}

export type Unit = "TON" | "BAG" | "M3" | "PIECE" | "KG" | "METER";

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
  minQty: number;
  supplierName: string | null;
  isActive: boolean;
}
