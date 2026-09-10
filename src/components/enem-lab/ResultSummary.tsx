import * as React from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";

/**
 * Resumo de uma sessão corrigida.
 *
 * O resultado abria com quatro cartõezinhos de mesmo peso — aproveitamento,
 * em branco, tempo médio, erros com certeza — e o número que a pessoa veio
 * ver disputava espaço com os outros três. Aqui o placar é o assunto e o
 * resto é apoio.
 */
export interface ResumoItem {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

export function ResultSummary({
  correct,
  total,
  blank,
  items,
  note,
  actions,
  className,
}: {
  correct: number;
  total: number;
  blank: number;
  items: ResumoItem[];
  /** Ressalva sobre o que este número é e não é. */
  note?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const p = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <Card variant="raised" padding="lg" className={cn("el-result", className)}>
      <div className="el-result__score">
        <div className="el-result__big telemetry">
          {correct}
          <span className="el-result__of">/{total}</span>
        </div>
        <div className="el-result__pct">
          <span className="telemetry">{p}%</span>
          <span className="caption">de acerto</span>
        </div>
      </div>

      <Progress
        value={p}
        className="el-result__bar"
        label={`${correct} de ${total} questões corretas`}
      />

      <div className="el-result__facts">
        <div className="el-result__fact">
          <span className="label">Em branco</span>
          <b className="telemetry">{blank}</b>
        </div>
        {items.map((it) => (
          <div className="el-result__fact" key={it.label}>
            <span className="label">{it.label}</span>
            <b className="telemetry">{it.value}</b>
            {it.hint && <span className="caption">{it.hint}</span>}
          </div>
        ))}
      </div>

      {note && <p className="caption el-result__note">{note}</p>}
      {actions && <div className="el-result__actions">{actions}</div>}
    </Card>
  );
}
