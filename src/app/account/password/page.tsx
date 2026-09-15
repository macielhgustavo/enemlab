"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/enem-lab/states";
import { ensureFreshSession, loadSession, updatePasswordWithSession } from "@/lib/cloud/client";

export default function AccountPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (password.length < 8) {
      setError("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As duas senhas não coincidem.");
      return;
    }

    const stored = loadSession();
    if (!stored) {
      setError("Entre primeiro com Google ou GitHub para provar que esta conta é sua.");
      return;
    }

    setBusy(true);
    try {
      const session = await ensureFreshSession(stored);
      await updatePasswordWithSession(session, password);
      setPassword("");
      setConfirm("");
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível definir a senha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 p-5">
      <div className="flex items-center gap-3">
        <div className="accountIcon"><KeyRound size={20} /></div>
        <div>
          <p className="tele">Conta · segurança</p>
          <h1 className="text-2xl font-semibold">Acesso por senha</h1>
        </div>
      </div>

      <Card className="space-y-4">
        <p className="muted">
          Se este e-mail já foi criado com Google ou GitHub, não crie outro usuário. Entre com a conta existente e defina uma senha aqui; o UUID e todo o histórico permanecem os mesmos.
        </p>

        <form onSubmit={submit} className="accountForm">
          <label htmlFor="new-password">Nova senha</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="mínimo 8 caracteres"
          />

          <label htmlFor="confirm-password">Confirmar nova senha</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="repita a senha"
          />

          <Button variant="primary" loading={busy} type="submit">
            Definir senha de acesso
          </Button>
        </form>

        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
        {success ? (
          <InlineNotice>
            Senha definida. Agora você pode sair e entrar usando este mesmo e-mail + senha.
          </InlineNotice>
        ) : null}

        <div className="flex gap-4 text-sm">
          <Link href="/account" className="underline">Voltar para Conta</Link>
        </div>
      </Card>
    </main>
  );
}
