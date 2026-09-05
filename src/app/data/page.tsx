"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { FINAL_BUILD, FINAL_SCHEMA } from "@/lib/domain/constants";
import { rebuildSessions } from "@/lib/domain/stats";
import { runSelfTests, type SelfTest } from "@/lib/domain/selftests";
import { listSnapshots, saveSnapshot, getSnapshot, type Snapshot } from "@/lib/idb";
import type { DB } from "@/lib/domain/types";
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

  async function refreshSnapshots() {
    setSnapshots(await listSnapshots());
  }
  useEffect(() => {
    if (hydrated) refreshSnapshots();
  }, [hydrated]);

  async function restore(snapId: string) {
    const s = await getSnapshot(snapId);
    if (!s?.data) return;
    if (!confirm("Restaurar este snapshot e substituir o estado atual?")) return;
    replaceDBFull(s.data);
    success("Snapshot restaurado.");
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
      const x = JSON.parse(await f.text()) as DB;
      if (!Array.isArray(x.attempts)) throw new Error("Backup inválido.");
      if (merge) {
        mergeDB(x);
        success("Backup mesclado sem apagar tentativas existentes.");
      } else {
        if (confirm("Substituir todos os dados atuais?")) {
          replaceDB(x);
          success("Backup importado.");
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
