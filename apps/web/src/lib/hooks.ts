"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  Brand,
  Client,
  ClientAccount,
  CreditProfile,
  Guarantee,
  ClientProject,
  OrderDetail,
  OrderSummary,
  OrdersSummary,
  Statement,
  Payment,
  AcceptedPrice,
  Quotation,
  QuotationSummary,
  Product,
  User,
  Variant,
  Competitor,
  LatestMarketPrice,
  LostDealDetail,
  LostEntry,
  MarketAnalysis,
  MarketPrice,
} from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<User>("/auth/me") });

export const useClients = (params: { q?: string; status?: string } = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  return useQuery({
    queryKey: ["clients", params],
    queryFn: () => api<Client[]>(`/clients${search ? `?${search}` : ""}`),
  });
};

export const useClient = (id: string) =>
  useQuery({ queryKey: ["clients", id], queryFn: () => api<Client>(`/clients/${id}`) });

export const useVariants = (includeInactive = false) =>
  useQuery({
    queryKey: ["variants", includeInactive],
    queryFn: () => api<Variant[]>(`/variants${includeInactive ? "?includeInactive=true" : ""}`),
  });

export const useProducts = () => useQuery({ queryKey: ["products"], queryFn: () => api<Product[]>("/products") });
export const useBrands = () => useQuery({ queryKey: ["brands"], queryFn: () => api<Brand[]>("/brands") });
export const useUsers = (enabled = true) =>
  useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/users"), enabled });

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return search ? `?${search}` : "";
};

export const useProjects = (clientId: string | undefined) =>
  useQuery({
    queryKey: ["projects", clientId],
    queryFn: () => api<ClientProject[]>(`/clients/${clientId}/projects`),
    enabled: !!clientId,
  });

export const useAccount = (clientId: string | undefined) =>
  useQuery({
    queryKey: ["account", clientId],
    queryFn: () => api<ClientAccount>(`/clients/${clientId}/account`),
    enabled: !!clientId,
  });

export const usePayments = (clientId: string) =>
  useQuery({ queryKey: ["payments", clientId], queryFn: () => api<Payment[]>(`/clients/${clientId}/payments`) });

export type OrderFilters = { state?: string; clientId?: string; projectId?: string; status?: string; q?: string; from?: string; to?: string };

export const ordersQuery = (filters: OrderFilters) => query(filters);

export const useOrders = (filters: OrderFilters = {}) =>
  useQuery({ queryKey: ["orders", filters], queryFn: () => api<OrderSummary[]>(`/orders${query(filters)}`) });

export const useOrder = (id: string) =>
  useQuery({ queryKey: ["orders", id], queryFn: () => api<OrderDetail>(`/orders/${id}`) });

export const useOrdersSummary = () =>
  useQuery({ queryKey: ["orders", "summary"], queryFn: () => api<OrdersSummary>("/orders/summary") });

export const useStatement = (clientId: string, from?: string, to?: string) =>
  useQuery({
    queryKey: ["statement", clientId, from, to],
    queryFn: () => api<Statement>(`/clients/${clientId}/statement${query({ from, to })}`),
  });

export const useCredit = (clientId: string) =>
  useQuery({
    queryKey: ["account", clientId, "credit"],
    queryFn: () => api<{ account: ClientAccount; profile: CreditProfile }>(`/clients/${clientId}/credit`),
  });

export const useGuarantees = (clientId: string) =>
  useQuery({ queryKey: ["guarantees", clientId], queryFn: () => api<Guarantee[]>(`/clients/${clientId}/guarantees`) });

export const useQuotations = (filters: { clientId?: string; status?: string; q?: string } = {}) =>
  useQuery({ queryKey: ["quotations", filters], queryFn: () => api<QuotationSummary[]>(`/quotations${query(filters)}`) });

export const useQuotation = (id: string) =>
  useQuery({ queryKey: ["quotations", id], queryFn: () => api<Quotation>(`/quotations/${id}`) });

export const useAcceptedPrices = (clientId: string | undefined) =>
  useQuery({
    queryKey: ["accepted-prices", clientId],
    queryFn: () => api<AcceptedPrice[]>(`/clients/${clientId}/accepted-prices`),
    enabled: !!clientId,
  });

export const useCompetitors = () => useQuery({ queryKey: ["competitors"], queryFn: () => api<Competitor[]>("/competitors") });

export type RangeFilters = { from?: string; to?: string };

export const useLostDeals = (filters: RangeFilters & { reason?: string; competitorId?: string }) =>
  useQuery({ queryKey: ["lost-deals", filters], queryFn: () => api<LostEntry[]>(`/lost-deals${query(filters)}`) });

export const useLostDeal = (id: string | undefined) =>
  useQuery({ queryKey: ["lost-deals", id], queryFn: () => api<LostDealDetail>(`/lost-deals/${id}`), enabled: !!id });

export const useMarketPrices = (filters: RangeFilters & { variantId?: string; competitorId?: string; q?: string }) =>
  useQuery({ queryKey: ["market-prices", filters], queryFn: () => api<MarketPrice[]>(`/market-prices${query(filters)}`) });

/** The latest market prices for these items (one per payment terms): the hint under a price. */
export const useLatestMarket = (variantIds: string[]) => {
  const ids = [...new Set(variantIds)].sort();
  return useQuery({
    queryKey: ["market-prices", "latest", ids.join(",")],
    queryFn: () => api<LatestMarketPrice[]>(`/market-prices/latest?variantIds=${ids.join(",")}`),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
};

export const useMarketAnalysis = (filters: RangeFilters) =>
  useQuery({ queryKey: ["market-analysis", filters], queryFn: () => api<MarketAnalysis>(`/market/analysis${query(filters)}`) });
