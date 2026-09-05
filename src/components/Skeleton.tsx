export function Sk({
  w = "100%",
  h = 16,
  r = 8,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  style?: React.CSSProperties;
}) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

// Skeleton do dashboard da Home.
export function DashboardSkeleton() {
  return (
    <>
      <div className="dash-hero">
        <div className="dash-top">
          <div style={{ flex: 1, minWidth: 260 }}>
            <Sk w={220} h={22} r={999} />
            <Sk w={340} h={46} style={{ marginTop: 16 }} />
            <Sk w="80%" h={16} style={{ marginTop: 14 }} />
            <Sk w={320} h={44} r={12} style={{ marginTop: 20 }} />
          </div>
          <Sk w={148} h={148} r={999} />
        </div>
      </div>
      <div className="statline" style={{ marginTop: 14 }}>
        {[0, 1, 2, 3].map((i) => (
          <div className="stat" key={i}>
            <Sk w={34} h={34} r={10} />
            <Sk w={70} h={28} style={{ marginTop: 12 }} />
            <Sk w={90} h={12} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <Sk w={140} h={18} />
        <Sk h={210} r={14} style={{ marginTop: 14 }} />
      </div>
    </>
  );
}

// Skeleton do executor: espelha o modo foco (cabeçalho + corpo + dock).
export function QuestionSkeleton() {
  return (
    <section className="focus">
      <header className="focushead">
        <Sk w={62} h={26} r={7} />
        <div className="segbar">
          {Array.from({ length: 15 }).map((_, i) => (
            <i key={i} />
          ))}
        </div>
        <div className="clock" style={{ gap: 12 }}>
          <Sk w={96} h={26} r={7} />
          <Sk w={104} h={36} r={11} />
        </div>
      </header>

      <div className="focusbody">
        <Sk w={200} h={12} r={4} />
        <Sk w={280} h={12} r={4} style={{ marginTop: 10 }} />
        <div style={{ marginTop: 30, display: "grid", gap: 12 }}>
          <Sk h={18} />
          <Sk w="94%" h={18} />
          <Sk w="88%" h={18} />
          <Sk w="62%" h={18} />
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 34 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Sk key={i} h={62} r={14} />
          ))}
        </div>
      </div>

      <div className="dock">
        {[0, 1, 2].map((i) => (
          <Sk key={i} w={40} h={40} r={12} />
        ))}
        <span className="sep" />
        {[0, 1, 2].map((i) => (
          <Sk key={`c${i}`} w={64} h={34} r={11} />
        ))}
        <span className="sep" />
        <Sk w={40} h={40} r={12} />
      </div>
    </section>
  );
}
