"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function destination() {
    const next = new URLSearchParams(window.location.search).get("next");
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        setError("Usuário ou senha incorretos.");
        return;
      }

      window.location.assign(destination());
    } catch {
      setError("Não foi possível entrar agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="landing-page login-page">
      <div className="landing-technical-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(65%_50%_at_50%_0%,color-mix(in_oklab,var(--brand)_12%,transparent),transparent_70%)]" />

      <section className="login-card" aria-labelledby="login-title">
        <a href="/" className="mb-8 inline-flex items-center gap-2 text-xs text-muted transition-colors hover:text-text">
          <ArrowLeft size={14} /> Voltar para a landing page
        </a>

        <span className="grid size-11 place-items-center rounded-lg border border-brand/25 bg-brand/10 text-brand">
          <LockKeyhole size={19} />
        </span>
        <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.18em] text-brand">Acesso ao painel</p>
        <h1 id="login-title" className="mt-3 text-3xl font-semibold tracking-[-0.03em]">Entrar no Studium Labs</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Use as credenciais administrativas para acessar a plataforma atual.
        </p>

        <form onSubmit={submit} className="mt-8">
          <div className="login-field">
            <label htmlFor="username">Usuário</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error ? <p className="login-error" role="alert">{error}</p> : null}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "Entrando…" : "Entrar no painel"}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
          ACESSO DE TESTE: admin / admin
        </p>
      </section>
    </div>
  );
}
