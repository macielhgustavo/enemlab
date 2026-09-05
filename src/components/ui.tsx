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
