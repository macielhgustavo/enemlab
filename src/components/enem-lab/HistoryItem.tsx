import * as React from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { examLabel } from "@/lib/providers/label";
import { pct, shortSec } from "@/lib/format";
import type { Attempt } from "@/lib/domain/types";
import { cn } from "@/lib/cn";

/**
 * Uma linha do histórico.
 *
 * Era uma `<table>` de seis colunas. Tabela é boa para comparar números em
 * coluna, e aqui só um dos campos é número — o resto é identidade da prova,
 * data e um botão. No celular, seis colunas viravam rolagem horizontal.
 *
 * A banca vem sempre do `providerId` da própria tentativa, nunca de um
 * padrão: o histórico mistura provas de propósito, e duas linhas do mesmo
 * ano de bancas diferentes precisam se distinguir à primeira vista.
 */
export function HistoryItem({
  attempt,
  sessionId,
  className,
}: {
  attempt: Attempt;
  sessionId?: string;
  className?: string;
}) {
  const r = attempt.result;
  const concluida = !!r;
  const acerto = r ? pct(r.correct, r.total) : null;

  const tom = acerto === null ? "neutral" : acerto >= 70 ? "success" : acerto >= 50 ? "warning" : "danger";

  return (
    <Card padding="sm" className={cn("el-histitem", className)}>
      <div className="el-histitem__id">
        <Badge variant="outline">{examLabel(attempt.providerId)}</Badge>
        <b className="heading-sm">{attempt.year}</b>
        <span className="caption">
          {attempt.realDay ? `real dia ${attempt.realDay}` : attempt.mode}
        </span>
      </div>

      <div className="el-histitem__score">
        {concluida ? (
          <>
            <span className="telemetry el-histitem__pct">{acerto}%</span>
            <span className="caption">
              {r.correct}/{r.total} · {r.blank} em branco
            </span>
          </>
        ) : (
          <Badge variant="warning">Em andamento</Badge>
        )}
      </div>

      <div className="el-histitem__meta caption">
        <span>
          {new Date(attempt.startedAt).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </span>
        {attempt.elapsed > 0 && (
          <span className="el-histitem__time">
            <Clock size={12} aria-hidden="true" /> {shortSec(Math.round(attempt.elapsed))}
          </span>
        )}
        {sessionId && <span className="mono el-histitem__session">{sessionId}</span>}
      </div>

      <div className="el-histitem__cta">
        <Button asChild variant={concluida ? "secondary" : "primary"} size="sm">
          <Link href={concluida ? `/result/${attempt.id}` : `/exam/${attempt.id}`}>
            {concluida ? "Ver resultado" : "Continuar"} <ArrowRight size={14} />
          </Link>
        </Button>
      </div>

      <span className={cn("el-histitem__rail", `el-histitem__rail--${tom}`)} aria-hidden="true" />
    </Card>
  );
}
