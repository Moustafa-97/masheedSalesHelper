"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  Brand,
  Client,
  ClientAccount,
  ClientProject,
  OrderDetail,
  OrderSummary,
  Payment,
  Product,
  User,
  Variant,
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

export type OrderFilters = { clientId?: string; projectId?: string; status?: string; q?: string; from?: string; to?: string };

export const ordersQuery = (filters: OrderFilters) => query(filters);

export const useOrders = (filters: OrderFilters = {}) =>
  useQuery({ queryKey: ["orders", filters], queryFn: () => api<OrderSummary[]>(`/orders${query(filters)}`) });

export const useOrder = (id: string) =>
  useQuery({ queryKey: ["orders", id], queryFn: () => api<OrderDetail>(`/orders/${id}`) });
