"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { examYears } from "@/lib/domain/constants";
import { buildTrainingAttempt, type NewTrainingParams } from "@/lib/services/attempts";
import { buildItaFirstPhaseAttempt } from "@/lib/services/ita-attempts";
import { itaYears, itaAnswerKey } from "@/lib/providers";
import { Card } from "@/components/ui";
import type { AttemptMode, AreaId, Language } from "@/lib/domain/types";

const SUBJECT_PT: Record<string, string> = {
  mathematics: "Matemática",
  physics: "Física",
  chemistry: "Química",
  english: "Inglês",
  portuguese: "Português",
};

const MODES: { value: AttemptMode; label: string }[] = [
  { value: "sprint15", label: "Sprint — 15" },
  { value: "sprint30", label: "Sprint — 30" },
  { value: "area", label: "Área — 45" },
  { value: "adaptive15", label: "Adaptive — 15" },
  { value: "unseen15", label: "Nunca vi — 15" },
  { value: "unseen30", label: "Nunca vi — 30" },
  { value: "unseen90", label: "Prova inédita — 90 (vários anos)" },
  { value: "full", label: "Prova completa — 180" },
  { value: "real1", label: "ENEM Real — Dia 1 + redação" },
  { value: "real2", label: "ENEM Real — Dia 2" },
];

const AREAS: { value: AreaId | "all"; label: string }[] = [
  { value: "matematica", label: "Matemática" },
  { value: "ciencias-natureza", label: "Ciências da Natureza" },
  { value: "ciencias-humanas", label: "Ciências Humanas" },
  { value: "linguagens", label: "Linguagens" },
  { value: "all", label: "Todas" },
];

function defaultMinutes(mode: AttemptMode): number {
  if (mode === "full") return 600;
  if (mode === "real1") return 330;
  if (mode === "real2") return 300;
  if (mode === "area") return 150;
  if (mode === "sprint30" || mode === "unseen30") return 90;
  if (mode === "unseen90") return 270;
  return 50;
}

export default function PracticePage() {
  const router = useRouter();
  const db = useStore((s) => s.db);
  const addAttempt = useStore((s) => s.addAttempt);
  const hydrated = useHydrated();

  const [year, setYear] = useState(2023);
  const [lang, setLang] = useState<Language>("ingles");
  const [mode, setMode] = useState<AttemptMode>("sprint15");
  const [area, setArea] = useState<AreaId | "all">("matematica");
  const [minutes, setMinutes] = useState(50);
  const [strict, setStrict] = useState(false);
  const [strategy, setStrategy] = useState(false);
  const [alerts, setAlerts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [itaYear, setItaYear] = useState(() => itaYears()[0] ?? 2026);
  const [itaSubject, setItaSubject] = useState("");
  const [status, setStatus] = useState<string>("");

  const areaDisabled = ["full", "real1", "real2", "adaptive15", "unseen90"].includes(mode);
  const minutesDisabled = mode === "real1" || mode === "real2";

  function changeMode(m: AttemptMode) {
    setMode(m);
    setMinutes(defaultMinutes(m));
    if (m === "full" || m === "real1" || m === "real2") setArea("all");
  }

  function startIta() {
    setBusy(true);
    try {
      const a = buildItaFirstPhaseAttempt(itaYear, { subject: itaSubject || null });
      addAttempt(a);
      router.push(`/exam/${a.id}`);
    } catch (e) {
      setStatus((e as Error).message);
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setStatus("Montando treino…");
    try {
      const params: NewTrainingParams = { year, lang, mode, area, minutes, strict, strategy, alerts };
      const attempt = await buildTrainingAttempt(db, params);
      addAttempt(attempt);
      router.push(`/exam/${attempt.id}`);
    } catch (e) {
      setStatus((e as Error).message);
      setBusy(false);
    }
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  return (
    <>
      <Card>
        <div className="row between">
          <div>
            <h2>Novo treino</h2>
            <div className="muted">
              Do sprint de 15 ao ENEM Real. Questões em cache abrem sem nova chamada à API.
            </div>
          </div>
        </div>

        <div className="grid grid3" style={{ marginTop: 15 }}>
          <div>
            <label htmlFor="treino-ano">Ano</label>
            <select id="treino-ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {examYears().map((y) => (
                <option key={y} value={y}>
                  {y}
                  {y >= 2014 ? "" : " • arquivo"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="treino-idioma">Idioma</label>
            <select id="treino-idioma" value={lang} onChange={(e) => setLang(e.target.value as Language)}>
              <option value="ingles">Inglês</option>
              <option value="espanhol">Espanhol</option>
            </select>
          </div>
          <div>
            <label htmlFor="treino-modo">Modo</label>
            <select id="treino-modo" value={mode} onChange={(e) => changeMode(e.target.value as AttemptMode)}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid2" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="treino-area">Área</label>
            <select id="treino-area"
              value={area}
              disabled={areaDisabled}
              onChange={(e) => setArea(e.target.value as AreaId | "all")}
            >
              {AREAS.map((ar) => (
                <option key={ar.value} value={ar.value}>
                  {ar.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="treino-minutos">Tempo máximo (min)</label>
            <input id="treino-minutos"
              type="number"
              min={10}
              max={700}
              value={minutes}
              disabled={minutesDisabled}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </div>
        </div>

        <label className="toggle" style={{ marginTop: 13 }}>
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />{" "}
          Modo rígido: o relógio continua mesmo se fechar a prova.
        </label>
        <label className="toggle" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={strategy}
            onChange={(e) => setStrategy(e.target.checked)}
          />{" "}
          Estratégia em 3 passagens.
        </label>
        <label className="toggle" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />{" "}
          Alertas discretos de ritmo durante a prova.
        </label>

        {status && (
          <div className="notice" style={{ marginTop: 14 }}>
            {busy && <span className="loader" style={{ display: "inline-block", marginRight: 8 }} />}
            {status}
          </div>
        )}

        <div className="row between" style={{ marginTop: 15 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Banco estruturado: 2009–2023
          </span>
          <button className="btn" onClick={start} disabled={busy}>
            Começar
          </button>
        </div>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <div className="htitle">
          <h2>ITA — 1ª fase</h2>
          <span className="badge2">gabarito oficial</span>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          As provas do ITA são publicadas como documento digitalizado, então o enunciado
          é lido na prova oficial e você marca a alternativa aqui. A correção usa o
          gabarito oficial, e o desempenho fica separado do ENEM.
        </p>
        <div className="row" style={{ alignItems: "flex-end", gap: 12, marginTop: 14 }}>
          <div style={{ maxWidth: 150 }}>
            <label htmlFor="ita-edicao">Edição</label>
            <select id="ita-edicao" value={itaYear} onChange={(e) => setItaYear(Number(e.target.value))}>
              {itaYears().map((y) => (
                <option key={y} value={y}>
                  ITA {y}
                </option>
              ))}
            </select>
          </div>
          <div style={{ maxWidth: 190 }}>
            <label htmlFor="ita-materia">Matéria</label>
            <select id="ita-materia" value={itaSubject} onChange={(e) => setItaSubject(e.target.value)}>
              <option value="">Prova completa</option>
              {Object.entries(itaAnswerKey(itaYear)?.subjects ?? {}).map(([id]) => (
                <option key={id} value={id}>
                  {SUBJECT_PT[id] ?? id}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" onClick={startIta} disabled={busy}>
            Começar ITA
          </button>
        </div>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <h2>Modos de treino</h2>
        <div className="grid grid4" style={{ marginTop: 14 }}>
          <div className="modeCard">
            <small className="muted">RÁPIDO</small>
            <br />
            <b>Sprint 15</b>
            <p className="muted">Bloco curto, ótimo para rotina.</p>
          </div>
          <div className="modeCard">
            <small className="muted">FOCO</small>
            <br />
            <b>Área 45</b>
            <p className="muted">Uma área completa do ENEM.</p>
          </div>
          <div className="modeCard">
            <small className="muted">ADAPTATIVO</small>
            <br />
            <b>Adaptive 15</b>
            <p className="muted">Escolhido a partir das suas fraquezas.</p>
          </div>
          <div className="modeCard">
            <small className="muted">SIMULAÇÃO</small>
            <br />
            <b>ENEM Real</b>
            <p className="muted">Dia 1 ou Dia 2 com tempo oficial.</p>
          </div>
        </div>
      </Card>
    </>
  );
}
