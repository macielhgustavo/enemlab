"use client";
import { useMemo, useState } from "react";
import { Check, Copy, Flag, X } from "lucide-react";

const STORAGE_KEY = "enem_lab_question_format_reports_v1";
const TYPES = ["Texto/acentos", "Fórmula", "Imagem", "Tabela/gráfico", "Outro"] as const;

type IssueType = (typeof TYPES)[number];

type StoredReport = {
  id: string;
  at: string;
  route: string;
  question: string;
  area: string;
  types: IssueType[];
  note: string;
  userAgent: string;
};

function readContext() {
  if (typeof document === "undefined") return { question: "Questão", area: "" };
  return {
    question: document.querySelector<HTMLElement>(".examContent .qTitle")?.innerText?.trim() || "Questão",
    area: document.querySelector<HTMLElement>(".examContent .qArea")?.innerText?.trim() || "",
  };
}

function saveReport(report: StoredReport) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as StoredReport[]) : [];
    list.unshift(report);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    // O relatório continua disponível para copiar mesmo se o storage estiver bloqueado.
  }
}

export default function QuestionIssueReporter() {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<IssueType[]>([]);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const context = useMemo(() => (open ? readContext() : { question: "Questão", area: "" }), [open]);

  const toggleType = (type: IssueType) => {
    setTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  };

  const payload = (): StoredReport => ({
    id: `fmt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    route: window.location.href,
    question: context.question,
    area: context.area,
    types,
    note: note.trim(),
    userAgent: navigator.userAgent,
  });

  const diagnosticText = (report: StoredReport) =>
    [
      "ENEM Lab — problema de formatação",
      report.question,
      report.area,
      `Tipo: ${report.types.join(", ") || "não informado"}`,
      report.note ? `Observação: ${report.note}` : "",
      `Rota: ${report.route}`,
      `Data: ${report.at}`,
    ]
      .filter(Boolean)
      .join("\n");

  const copyDiagnostic = async () => {
    const report = payload();
    try {
      await navigator.clipboard.writeText(diagnosticText(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const submit = () => {
    const report = payload();
    saveReport(report);
    setSaved(true);
  };

  const close = () => {
    setOpen(false);
    setTypes([]);
    setNote("");
    setSaved(false);
    setCopied(false);
  };

  return (
    <>
      <button className="questionIssueFab" type="button" onClick={() => setOpen(true)}>
        <Flag size={14} /> Reportar formatação
      </button>

      {open && (
        <div className="questionIssueBackdrop" role="presentation" onMouseDown={close}>
          <section
            className="questionIssueDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="question-issue-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="questionIssueHead">
              <div>
                <span>qualidade da questão</span>
                <h2 id="question-issue-title">Reportar problema de formatação</h2>
              </div>
              <button type="button" onClick={close} aria-label="Fechar">
                <X size={18} />
              </button>
            </div>

            <div className="questionIssueRef">
              <b>{context.question}</b>
              {context.area && <span>{context.area}</span>}
            </div>

            {saved ? (
              <div className="questionIssueSaved">
                <Check size={22} />
                <div>
                  <b>Relatório salvo neste navegador.</b>
                  <span>Ele não altera sua resposta nem interrompe a sessão.</span>
                </div>
              </div>
            ) : (
              <>
                <label>O que está errado?</label>
                <div className="questionIssueTypes">
                  {TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={types.includes(type) ? "selected" : ""}
                      onClick={() => toggleType(type)}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                <label htmlFor="question-issue-note">Detalhes opcionais</label>
                <textarea
                  id="question-issue-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Ex.: o expoente sumiu, a imagem está cortada, faltou acento..."
                  rows={4}
                />
              </>
            )}

            <div className="questionIssueActions">
              <button className="btn secondary" type="button" onClick={copyDiagnostic}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copiado" : "Copiar diagnóstico"}
              </button>
              {!saved && (
                <button className="btn" type="button" onClick={submit} disabled={!types.length && !note.trim()}>
                  Salvar relatório
                </button>
              )}
              {saved && (
                <button className="btn" type="button" onClick={close}>
                  Voltar à questão
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}