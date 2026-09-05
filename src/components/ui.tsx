import { pct } from "@/lib/format";

export function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="metric">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

export function AreaBar({ name, c, t }: { name: string; c: number; t: number }) {
  return (
    <div className="areaBar">
      <b>{name}</b>
      <div className="progress">
        <span style={{ width: `${pct(c, t)}%` }} />
      </div>
      <span>
        {c}/{t}
      </span>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Cabeçalho de página no padrão do centro de controle. */
export function PageHead({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="pagehead sm">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      {sub && <div className="sub">{sub}</div>}
      {right && <div className="headright">{right}</div>}
    </header>
  );
}

export function Card({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  );
}
