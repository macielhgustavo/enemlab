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
  return (
    <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />
  );
}

// Skeleton do dashboard da Home.
export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando seu painel">
      <div className="el-head" aria-hidden="true">
        <Sk w={180} h={12} />
        <Sk w={220} h={40} style={{ marginTop: 12 }} />
        <Sk w="65%" h={20} style={{ marginTop: 8 }} />
      </div>
      <div className="hrow hrow-1" aria-hidden="true">
        <div className="hcard mission">
          <Sk w={120} h={12} />
          <Sk w="90%" h={56} style={{ marginTop: 16 }} />
          <Sk w="75%" h={16} style={{ marginTop: 12 }} />
          <Sk w={152} h={44} style={{ marginTop: 24 }} />
        </div>
        <div className="hcard goal">
          <Sk w={136} h={136} r={999} />
        </div>
        <div className="statcol el-stack">
          {[0, 1, 2].map((i) => (
            <div className="el-metric el-metric--plain" key={i}>
              <Sk w="70%" h={16} />
              <Sk w={64} h={34} />
            </div>
          ))}
        </div>
      </div>
      <div className="hrow hrow-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div className="hcard" key={i}>
            <Sk w="60%" h={20} />
            <Sk h={230} style={{ marginTop: 16 }} />
          </div>
        ))}
      </div>
    </div>
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 6,
            marginTop: 16,
          }}
        >
          {[0, 1, 2].map((i) => (
            <Sk key={i} h={34} r={10} />
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(8,1fr)",
            gap: 5,
            marginTop: 16,
          }}
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <Sk key={i} h={30} r={8} />
          ))}
        </div>
      </aside>
    </section>
  );
}
