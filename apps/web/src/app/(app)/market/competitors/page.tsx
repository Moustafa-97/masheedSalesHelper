"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card, Input, Muted, Notice, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCompetitors } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { Competitor } from "@/lib/types";

/** Admin: one name per company. Rename a spelling, or merge two names of the same company. */
function Row({ c, all }: { c: Competitor; all: Competitor[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(c.name);
  const [into, setInto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      for (const key of ["competitors", "market-prices", "lost-deals", "market-analysis"]) qc.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="grid gap-2 md:grid-cols-[2fr_auto_2fr_auto] md:items-end">
        <Input label={t("competitorName")} hint={t("usedTimes", { count: c.uses ?? 0 })} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="secondary" disabled={!name.trim() || name === c.name} onClick={() => run(() => api(`/competitors/${c.id}`, { method: "PATCH", body: { name } }))}>
          {t("rename")}
        </Button>
        <Select label={t("mergeInto")} value={into} onChange={(e) => setInto(e.target.value)}>
          <option value="">—</option>
          {all.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Button
          variant="danger"
          disabled={!into}
          onClick={() =>
            window.confirm(t("mergeConfirm", { from: c.name, into: all.find((x) => x.id === into)?.name ?? "" })) &&
            run(() => api(`/competitors/${c.id}/merge`, { method: "POST", body: { intoId: into } }))
          }
        >
          {t("merge")}
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

export default function CompetitorsPage() {
  const { t } = useI18n();
  const { data: competitors = [], isLoading } = useCompetitors();
  return (
    <>
      <PageHeader title={t("competitors")} subtitle={t("competitorsHint")} />
      {isLoading ? (
        <Muted>{t("loading")}</Muted>
      ) : competitors.length === 0 ? (
        <Muted>{t("empty")}</Muted>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {competitors.map((c) => <Row key={c.id} c={c} all={competitors} />)}
          </ul>
        </Card>
      )}
    </>
  );
}
