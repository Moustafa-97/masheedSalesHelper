"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Brand, Client, Product, User, Variant } from "./types";

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
