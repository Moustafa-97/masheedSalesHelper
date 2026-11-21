"use client";

import { useRouter } from "next/navigation";
import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function NewClientPage() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <>
      <PageHeader title={t("newClient")} />
      <ClientForm onSaved={(c) => router.push(`/clients/${c.id}`)} />
    </>
  );
}
