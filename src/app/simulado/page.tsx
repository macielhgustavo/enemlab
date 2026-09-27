"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, FileCheck2, ShieldCheck, TimerReset } from "lucide-react";
import { useActiveProvider } from "@/components/ExamSwitch";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { EmptyState } from "@/components/enem-lab/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useHydrated } from "@/lib/hooks";
import { getProvider } from "@/lib/providers";
import { examLabel, phaseLabel } from "@/lib/providers/label";
import {
  buildSimulationAttempt,
  simulationEntriesForProvider,
  simulationEntryKey,
  simulationTiming,
} from "@/lib/services/simulation";
import { useStore } from "@/lib/store";

export default function SimulationPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const addAttempt = useStore((state) => state.addAttempt);
  const { providerId } = useActiveProvider();
  const [selectedKey, setSelectedKey] = useState("");
  const [language, setLanguage] = useState("ingles");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const entries = useMemo(() => simulationEntriesForProvider(providerId), [providerId]);
  const metadata = getProvider(providerId).metadata;
  const selected =
    entries.find((entry) => simulationEntryKey(entry) === selectedKey) ?? entries[0] ?? null;
  const effectiveLanguage = metadata.languages.some((item) => item.id === language)
    ? language
    : metadata.languages[0]?.id ?? "ingles";
  const timing = selected ? simulationTiming(selected) : null;

  if (!hydrated) {
    return (
      <Card>
        <span className="muted">Carregando simulados…</span>
      </Card>
    );
  }

  async function startSimulation() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const attempt = await buildSimulationAttempt(selected, effectiveLanguage);
      addAttempt(attempt);
      router.push(`/exam/${attempt.id}`);
    } catch (err) {
      setError((err as Error).message || "Não foi possível iniciar este simulado.");
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Módulo · simulado"
        title="Simulado completo"
        context={<Badge variant="accent">{examLabel(providerId)}</Badge>}
        description="Meça desempenho em uma edição e bloco oficiais, com timer total, navegação livre e correção somente no final."
        meta={<span>{entries.length} bloco(s) compatível(is)</span>}
      />

      {!entries.length ? (
        <Card>
          <EmptyState
            title="Simulado indisponível para esta prova"
            description="O catálogo atual não possui um bloco objetivo validado que o runner consiga executar inteiro. Nenhuma prova parcial será apresentada como simulado."
          />
        </Card>
      ) : (
        <div className="grid grid2">
          <Card>
            <div className="htitle">
              <div>
                <div className="eyebrow">PROVA E BLOCO</div>
                <h2>Escolha o que medir</h2>
              </div>
              <FileCheck2 size={20} aria-hidden="true" />
            </div>

            <label htmlFor="simulation-entry">Edição / bloco</label>
            <select
              id="simulation-entry"
              value={selected ? simulationEntryKey(selected) : ""}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              {entries.map((entry) => (
                <option key={simulationEntryKey(entry)} value={simulationEntryKey(entry)}>
                  {entry.editionId} · {phaseLabel(entry.phase)}
                  {entry.questionCount !== null ? ` · ${entry.questionCount} questões` : ""}
                </option>
              ))}
            </select>

            {metadata.languages.length > 1 ? (
              <div style={{ marginTop: 14 }}>
                <label htmlFor="simulation-language">Língua estrangeira</label>
                <select
                  id="simulation-language"
                  value={effectiveLanguage}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  {metadata.languages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {selected ? (
              <div className="reportBlocks" style={{ marginTop: 18 }}>
                <div className="reportBlock">
                  <strong>
                    {examLabel(providerId)} {selected.editionId} · {phaseLabel(selected.phase)}
                  </strong>
                  <span className="muted">
                    {selected.questionCount === null
                      ? "A contagem será conferida ao carregar o bloco."
                      : `${selected.questionCount} questões objetivas no catálogo.`}
                  </span>
                </div>
                <div className="reportBlock">
                  <strong>
                    {selected.statementAvailable ? "Enunciados no app" : "Leitura na prova oficial"}
                  </strong>
                  <span className="muted">
                    {selected.statementAvailable
                      ? "O runner apresenta o conteúdo disponível no provider."
                      : "O runner mantém a marcação no Studium e referencia o documento oficial para leitura."}
                  </span>
                </div>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="htitle">
              <div>
                <div className="eyebrow">CONDIÇÕES</div>
                <h2>Sessão de medição</h2>
              </div>
              <TimerReset size={20} aria-hidden="true" />
            </div>

            <div className="reportBlocks">
              <div className="reportBlock">
                <strong>Timer total · modo rígido</strong>
                <span className="muted">
                  {timing?.minutes
                    ? `${timing.minutes} min · ${timing.basis === "configured" ? "duração já configurada para esta prova" : "estimativa interna proporcional ao bloco"}`
                    : "A duração será calculada quando o bloco for carregado."}
                </span>
              </div>
              <div className="reportBlock">
                <strong>Sem correção durante a prova</strong>
                <span className="muted">
                  Respostas, marcadas e confiança ficam registradas; gabarito e diagnóstico aparecem apenas depois de finalizar.
                </span>
              </div>
              <div className="reportBlock">
                <strong>Salvar e sair não pausa o relógio</strong>
                <span className="muted">
                  O estado fica preservado para voltar depois, mas no modo rígido o tempo continua contando desde o início.
                </span>
              </div>
            </div>

            {error ? <div className="notice" style={{ marginTop: 14 }}>{error}</div> : null}

            <div className="row" style={{ marginTop: 18 }}>
              <Button variant="primary" onClick={startSimulation} loading={busy} disabled={!selected}>
                <Clock3 size={15} aria-hidden="true" /> Iniciar simulado
              </Button>
              <span className="muted" style={{ fontSize: 12 }}>
                <ShieldCheck size={14} style={{ verticalAlign: "middle" }} /> bloco validado e isolado por edição
              </span>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
