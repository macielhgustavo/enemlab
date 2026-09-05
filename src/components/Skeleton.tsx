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

// Skeleton da questão no executor de prova.
export function QuestionSkeleton() {
  return (
    <section className="examGrid">
      <div className="card questionCard">
        <div className="questionTop">
          <div style={{ flex: 1 }}>
            <Sk w={180} h={13} />
            <Sk w={260} h={12} style={{ marginTop: 8 }} />
          </div>
          <Sk w={54} h={22} r={999} />
        </div>
        <Sk h={16} style={{ marginTop: 8 }} />
        <Sk w="92%" h={16} style={{ marginTop: 10 }} />
        <Sk w="85%" h={16} style={{ marginTop: 10 }} />
        <Sk w="60%" h={16} style={{ marginTop: 10 }} />
        <div style={{ display: "grid", gap: 11, marginTop: 24 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Sk key={i} h={52} r={14} />
          ))}
        </div>
      </div>
      <aside className="card sidebar">
        <Sk w={120} h={28} />
        <Sk h={9} r={999} style={{ marginTop: 16 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <Sk key={i} h={34} r={10} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 5, marginTop: 16 }}>
          {Array.from({ length: 16 }).map((_, i) => (
            <Sk key={i} h={30} r={8} />
          ))}
        </div>
      </aside>
    </section>
  );
}
