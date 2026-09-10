"use client";

import { useMemo, useState } from "react";
import { Cloud, LogOut, Mail, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useCloudSync } from "@/components/CloudSyncProvider";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { LoadingState, InlineNotice } from "@/components/enem-lab/states";

function statusLabel(status: ReturnType<typeof useCloudSync>["status"]) {
  if (status === "syncing") return "Sincronizando";
  if (status === "offline") return "Offline — dados locais preservados";
  if (status === "error") return "Atenção necessária";
  if (status === "needs-merge") return "Aguardando mesclagem inicial";
  if (status === "idle") return "Nuvem em dia";
  return "Local";
}

export default function AccountPage() {
  const cloud = useCloudSync();
  const db = useStore((s) => s.db);
  const hydrated = useHydrated();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const profile = useMemo(() => {
    const meta = cloud.user?.user_metadata || {};
    const name = String(meta.full_name || meta.name || meta.user_name || cloud.user?.email || "Conta ENEM Lab");
    const avatar = typeof meta.avatar_url === "string" ? meta.avatar_url : "";
    return { name, avatar };
  }, [cloud.user]);

  if (!hydrated || cloud.status === "loading") {
    return (
      <Card>
        <LoadingState lines={3} label="Carregando sua conta" />
      </Card>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "login") {
        await cloud.signInEmail(email, password);
      } else {
        const result = await cloud.signUpEmail(email, password);
        if (result === "confirm-email") setMessage("Conta criada. Confirme o e-mail antes de entrar.");
      }
    } catch {
      // O provider já expõe a mensagem de erro.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="accountPage">
      <PageHeader
        eyebrow="Identidade e continuidade"
        title="Conta e nuvem"
        description="Seu histórico continua localmente e pode acompanhar você entre computador e celular."
      />

      {!cloud.user ? (
        <div className="accountAuthGrid">
          <Card className="accountAuthCard">
            <div className="accountIcon"><Cloud size={20} /></div>
            <h2>Entrar no ENEM Lab</h2>
            <p className="muted">Você pode continuar sem conta. Ao entrar, nenhum dado local é apagado automaticamente.</p>

            <div className="oauthStack">
              <button className="oauthButton google" type="button" onClick={() => cloud.signInOAuth("google")}>
                <span className="oauthGlyph">G</span>Continuar com Google
              </button>
              <button className="oauthButton" type="button" onClick={() => cloud.signInOAuth("github")}>
                <span className="oauthGlyph">GH</span>Continuar com GitHub
              </button>
            </div>

            <div className="accountDivider"><span>ou</span></div>

            <form onSubmit={submit} className="accountForm">
              <label htmlFor="account-email">E-mail</label>
              <div className="accountInput"><Mail size={16} /><input id="account-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" /></div>
              <label htmlFor="account-password">Senha</label>
              <div className="accountInput"><ShieldCheck size={16} /><input id="account-password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" /></div>
              <Button variant="primary" loading={busy} type="submit">
                {mode === "login" ? "Entrar com e-mail" : "Criar conta"}
              </Button>
            </form>

            <button className="accountMode" type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(null); }}>
              {mode === "login" ? "Ainda não tenho conta" : "Já tenho uma conta"}
            </button>
            {/* `role="alert"` vem do InlineNotice: erro de login que aparece
                calado deixa quem não vê a tela achando que o botão não
                funcionou. */}
            {(cloud.error || message) && (
              <InlineNotice tone="danger">{message || cloud.error}</InlineNotice>
            )}
          </Card>

          <Card className="accountPromiseCard">
            <span className="tele">Como funciona</span>
            <h2>Local primeiro. Nuvem quando você quiser.</h2>
            <div className="accountPromiseList">
              <div><b>1</b><span>Você segue estudando normalmente mesmo deslogado ou sem internet.</span></div>
              <div><b>2</b><span>No primeiro login deste navegador, o ENEM Lab pede permissão para mesclar os dados.</span></div>
              <div><b>3</b><span>Depois disso, mudanças são sincronizadas automaticamente e conflitos preservam o máximo de progresso possível.</span></div>
            </div>
            <div className="accountLocalStats">
              <span><strong>{db.attempts.length}</strong> tentativas locais</span>
              <span><strong>{Object.keys(db.srs).length}</strong> revisões SRS</span>
              <span><strong>{Object.keys(db.notes).length}</strong> notas</span>
            </div>
          </Card>
        </div>
      ) : (
        <div className="accountSignedGrid">
          <Card className="accountProfileCard">
            <div className="accountProfileHead">
              {profile.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar} alt="Avatar da conta" />
              ) : <div className="accountAvatarFallback"><UserRound size={24} /></div>}
              <div><span className="tele">Conta conectada</span><h2>{profile.name}</h2><div className="muted">{cloud.user.email || "Identidade OAuth"}</div></div>
            </div>
            <div className={`cloudStatus ${cloud.status}`}><i />{statusLabel(cloud.status)}</div>
            <div className="accountMetaGrid">
              <div><span>Última sincronização</span><b>{cloud.lastSyncAt ? new Date(cloud.lastSyncAt).toLocaleString("pt-BR") : "ainda não"}</b></div>
              <div><span>Revisão da nuvem</span><b>#{cloud.revision}</b></div>
              <div><span>Histórico local</span><b>{db.attempts.length} tentativas</b></div>
              <div><span>SRS</span><b>{Object.keys(db.srs).length} itens</b></div>
            </div>
            <div className="row accountActions">
              <Button
                variant="secondary"
                size="sm"
                loading={cloud.status === "syncing"}
                disabled={cloud.status === "needs-merge"}
                onClick={() => void cloud.syncNow()}
              >
                <RefreshCw size={14} /> Sincronizar agora
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void cloud.signOut()}>
                <LogOut size={14} /> Sair
              </Button>
            </div>
            {cloud.error && <div className="accountError">{cloud.error}</div>}
          </Card>

          <Card className={`mergeCard ${cloud.status === "needs-merge" ? "active" : ""}`}>
            <span className="tele">Proteção de dados</span>
            {cloud.status === "needs-merge" ? (
              <>
                <h2>Mesclar este navegador com sua nuvem</h2>
                <p className="muted">Este é o primeiro vínculo desta conta neste navegador. O ENEM Lab vai unir tentativas, notas e revisões antes de ativar o sync automático.</p>
                <div className="mergeSummary"><span>{db.attempts.length} tentativas locais</span><span>{cloud.cloudExists ? "Há dados na nuvem" : "Nuvem ainda vazia"}</span></div>
                <Button variant="primary" onClick={() => void cloud.mergeAndEnable()}>
                  Mesclar e ativar sincronização
                </Button>
                <p className="mergeFine">Nada é substituído silenciosamente. Em conflitos de histórico, a versão com mais progresso é preservada.</p>
              </>
            ) : (
              <>
                <h2>Backup automático ativo</h2>
                <p className="muted">O navegador continua sendo uma cópia completa do seu estudo. A nuvem adiciona continuidade entre dispositivos, não substitui os backups JSON e snapshots.</p>
                <div className="cloudReady"><ShieldCheck size={22} /><div><b>RLS ativo</b><span>Somente sua conta autenticada pode ler e gravar seu estado.</span></div></div>
              </>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
