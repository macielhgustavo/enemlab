"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { FINAL_BUILD, FINAL_SCHEMA, examYears } from "@/lib/domain/constants";
import { rebuildSessions } from "@/lib/domain/stats";
import { runSelfTests, type SelfTest } from "@/lib/domain/selftests";
import { auditQuestionSet, type QuestionBankAudit } from "@/lib/domain/question-quality";
import { fetchExam } from "@/lib/api/enem";
import type { Language } from "@/lib/domain/types";
import { listSnapshots, saveSnapshot, getSnapshot, type Snapshot } from "@/lib/idb";
import { parseBackup } from "@/lib/validators/backup";
import { Card, Empty } from "@/components/ui";
import { useToast } from "@/components/Toast";

export default function DataPage() {
  const db = useStore((s) => s.db);
  const replaceDB = useStore((s) => s.replaceDB);
  const mergeDB = useStore((s) => s.mergeDB);
  const wipe = useStore((s) => s.wipe);
  const mutate = useStore((s) => s.mutate);
  const replaceDBFull = replaceDB;
  const { success, error: toastError } = useToast();
  const hydrated = useHydrated();
  const importRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLInputElement>(null);
  const [selfTests, setSelfTests] = useState<SelfTest[] | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [auditYear, setAuditYear] = useState(2023);
  const [auditLang, setAuditLang] = useState<Language>("ingles");
  const [bankAudit, setBankAudit] = useState<QuestionBankAudit | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState("");

  async function refreshSnapshots() {
    setSnapshots(await listSnapshots());
  }
  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    listSnapshots().then((s) => {
      if (alive) setSnapshots(s);
    });
    return () => {
      alive = false;
    };
  }, [hydrated]);

  async function restore(snapId: string) {
    const s = await getSnapshot(snapId);
    if (!s?.data) return;
    if (!confirm("Restaurar este snapshot e substituir o estado atual?")) return;
    replaceDBFull(s.data);
    success("Snapshot restaurado.");
  }

  async function runBankAudit() {
    setAuditBusy(true);
    setAuditError("");
    try {
      const questions = await fetchExam(auditYear, auditLang);
      setBankAudit(auditQuestionSet(questions));
    } catch (err) {
      const message = (err as Error).message || "Falha ao auditar o banco.";
      setAuditError(message);
      toastError(message);
    } finally {
      setAuditBusy(false);
    }
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  const raw = JSON.stringify(db);
  const sessions = rebuildSessions(db);

  function exportDB() {
    mutate((d) => {
      d.lastBackupAt = new Date().toISOString();
    });
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = "enem_lab_backup.json";
    a.click();
    URL.revokeObjectURL(u);
    saveSnapshot(db, "backup").then(refreshSnapshots);
    success("Backup exportado.");
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>, merge: boolean) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const parsed = parseBackup(await f.text());
      if (!parsed.ok) throw new Error(parsed.error);
      const x = parsed.data;
      const provs = parsed.providers.join(", ");
      if (merge) {
        mergeDB(x);
        success(`Backup mesclado: ${parsed.attempts} tentativa(s) de ${provs}.`);
      } else {
        if (confirm("Substituir todos os dados atuais?")) {
          replaceDB(x);
          success(`Backup importado: ${parsed.attempts} tentativa(s) de ${provs}.`);
        }
      }
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      e.target.value = "";
    }
  }

  return (
    <>
      <div className="grid grid2">
        <Card>
          <h2>Backup e sincronização manual</h2>
          <p className="muted">
            Exporte um pacote completo ou faça merge com outro navegador sem apagar o
            histórico atual.
          </p>
          <div className="row">
            <button className="btn" onClick={exportDB}>
              Exportar backup
            </button>
            <button className="btn secondary" onClick={() => importRef.current?.click()}>
              Substituir por backup
            </button>
            <button className="btn secondary" onClick={() => mergeRef.current?.click()}>
              Mesclar backup
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              hidden
              onChange={(e) => onImport(e, false)}
            />
            <input
              ref={mergeRef}
              type="file"
              accept=".json"
              hidden
              onChange={(e) => onImport(e, true)}
            />
          </div>
        </Card>

        <Card>
          <h2>Saúde do sistema</h2>
          <div className="healthGrid">
            <div className="healthItem">
              <small>Histórico</small>
              <b className="healthOk">{db.attempts.length} tentativas</b>
              <div className="muted">{sessions.length} sessão(ões)</div>
            </div>
            <div className="healthItem">
              <small>SRS</small>
              <b>{Object.keys(db.srs).length}</b>
              <div className="muted">itens na fila</div>
            </div>
            <div className="healthItem">
              <small>localStorage</small>
              <b>{(raw.length / 1024).toFixed(1)} KB</b>
              <div className="muted">histórico + notas</div>
            </div>
            <div className="healthItem">
              <small>Último backup</small>
              <b style={{ fontSize: 13 }}>
                {db.lastBackupAt
                  ? new Date(db.lastBackupAt).toLocaleString("pt-BR")
                  : "nunca"}
              </b>
            </div>
            <div className="healthItem">
              <small>Build</small>
              <b className="healthOk">{FINAL_BUILD}</b>
              <div className="muted">schema {FINAL_SCHEMA}</div>
            </div>
            <div className="healthItem">
              <small>Notas</small>
              <b>{Object.keys(db.notes).length}</b>
              <div className="muted">classificações de erro</div>
            </div>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 14 }}>
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div>
            <h2>Qualidade do banco de questões</h2>
            <div className="muted">
              Audita estrutura, gabarito, alternativas, mídia, codificação, fórmulas e confiança da classificação.
            </div>
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div>
              <label>Ano</label>
              <select value={auditYear} onChange={(e) => setAuditYear(Number(e.target.value))}>
                {examYears().map((year) => (
                  <option value={year} key={year}>{year}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Idioma</label>
              <select value={auditLang} onChange={(e) => setAuditLang(e.target.value as Language)}>
                <option value="ingles">Inglês</option>
                <option value="espanhol">Espanhol</option>
              </select>
            </div>
            <button className="btn secondary" disabled={auditBusy} onClick={runBankAudit}>
              {auditBusy ? "Auditando…" : "Auditar edição"}
            </button>
          </div>
        </div>

        {!bankAudit && !auditError && (
          <div className="notice" style={{ marginTop: 14 }}>
            A auditoria não altera questões. Treinos livres já evitam itens bloqueados; provas reais preservam a estrutura oficial e apenas sinalizam problemas.
          </div>
        )}
        {auditError && <div className="notice" style={{ marginTop: 14 }}>{auditError}</div>}

        {bankAudit && (
          <>
            <div className="healthGrid" style={{ marginTop: 14 }}>
              <div className="healthItem">
                <small>Questões</small>
                <b>{bankAudit.total}</b>
                <div className="muted">itens auditados</div>
              </div>
              <div className="healthItem">
                <small>Saudáveis</small>
                <b className="healthOk">{bankAudit.healthy}</b>
                <div className="muted">sem alerta relevante</div>
              </div>
              <div className="healthItem">
                <small>Revisar</small>
                <b style={{ color: "var(--warn)" }}>{bankAudit.review}</b>
                <div className="muted">avisos de qualidade</div>
              </div>
              <div className="healthItem">
                <small>Bloqueadas</small>
                <b style={{ color: "var(--bad)" }}>{bankAudit.blocked}</b>
                <div className="muted">fora de treinos livres</div>
              </div>
              <div className="healthItem">
                <small>Score médio</small>
                <b>{bankAudit.averageScore}/100</b>
                <div className="muted">qualidade estrutural</div>
              </div>
              <div className="healthItem">
                <small>Classificação</small>
                <b>{bankAudit.lowClassification}</b>
                <div className="muted">com baixa confiança • {bankAudit.unclassified} sem classe</div>
              </div>
            </div>

            <div className="testGrid" style={{ marginTop: 14 }}>
              {bankAudit.issueCounts.length === 0 && <div className="muted">Nenhum problema detectado.</div>}
              {bankAudit.issueCounts.slice(0, 8).map((item) => (
                <div className="testRow" key={item.code}>
                  <span
                    className={`testDot ${item.severity === "error" ? "bad" : item.severity === "warning" ? "warn" : ""}`}
                  />
                  <div>
                    <b>{item.label}</b>
                    <div className="muted" style={{ fontSize: 11 }}>{item.code}</div>
                  </div>
                  <span className="badge2">{item.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <Card>
          <div className="row between">
            <div>
              <h2>Autoteste da instalação</h2>
              <div className="muted">Verifica esquema, duplicatas, SRS, datas e sessões.</div>
            </div>
            <button className="btn secondary" onClick={() => setSelfTests(runSelfTests(db))}>
              Rodar autoteste
            </button>
          </div>
          <div className="testGrid" style={{ marginTop: 12 }}>
            {!selfTests && <div className="muted">Rode o autoteste para ver os resultados.</div>}
            {selfTests?.map((t) => (
              <div className="testRow" key={t.name}>
                <span className={`testDot ${t.ok ? "" : t.warn ? "warn" : "bad"}`} />
                <div>
                  <b>{t.name}</b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {t.detail}
                  </div>
                </div>
                <span className="badge2">{t.ok ? "OK" : "REVISAR"}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="row between">
            <div>
              <h2>Snapshots locais</h2>
              <div className="muted">Backups automáticos no navegador (últimos 5).</div>
            </div>
            <button
              className="btn secondary"
              onClick={() => saveSnapshot(db, "manual").then(refreshSnapshots)}
            >
              Criar snapshot
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            {snapshots.length === 0 && <Empty>Nenhum snapshot ainda.</Empty>}
            {snapshots.map((s) => (
              <div
                className="row between"
                key={s.id}
                style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}
              >
                <span className="muted">
                  {new Date(s.createdAt).toLocaleString("pt-BR")} • {s.reason}
                </span>
                <button className="btn secondary" onClick={() => restore(s.id)}>
                  Restaurar
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 14 }}>
        <h2>Privacidade e armazenamento</h2>
        <p className="muted">
          Histórico, SRS e notas ficam localmente neste navegador. Nada é enviado a um
          servidor.
        </p>
        <div className="row">
          <button
            className="btn danger"
            onClick={() => {
              if (confirm("Apagar histórico, SRS e notas?")) wipe();
            }}
          >
            Apagar histórico
          </button>
        </div>
      </Card>
    </>
  );
}
