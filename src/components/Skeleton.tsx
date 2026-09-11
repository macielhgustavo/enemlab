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
    <div className="performance-dashboard" aria-busy="true" aria-label="Carregando seu painel">
      <div className="dashboard-intro" aria-hidden="true">
        <div>
          <Sk w={220} h={11} />
          <Sk w={210} h={46} style={{ marginTop: 10 }} />
          <Sk w={310} h={15} style={{ marginTop: 8 }} />
        </div>
      </div>
      <div className="dashboard-grid" aria-hidden="true">
        <div className="dash-panel dash-mission">
          <div className="dash-mission__content" style={{ width: "72%" }}>
            <Sk w={150} h={11} />
            <Sk w="88%" h={48} style={{ marginTop: 18 }} />
            <Sk w="68%" h={15} style={{ marginTop: 12 }} />
            <Sk w={168} h={40} style={{ marginTop: 24 }} />
          </div>
          <Sk w={116} h={116} r={999} />
        </div>
        <div className="dash-panel dash-readiness">
          <div style={{ padding: 22 }}>
            <Sk w={110} h={17} />
            <Sk w={154} h={154} r={999} style={{ margin: "24px auto 0" }} />
          </div>
        </div>
        <div className="dash-loop">
          {[0, 1, 2, 3].map((index) => (
            <div className="dash-loop__step" key={index}>
              <Sk w={32} h={32} r={9} />
              <Sk w="70%" h={13} />
            </div>
          ))}
        </div>
        <div className="dash-panel dash-evolution">
          <div style={{ padding: 22 }}>
            <Sk w={190} h={18} />
            <Sk h={220} style={{ marginTop: 18 }} />
          </div>
        </div>
        <div className="dash-panel dash-reviews">
          <div style={{ padding: 22 }}>
            <Sk w={120} h={18} />
            <Sk h={220} style={{ marginTop: 18 }} />
          </div>
        </div>
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
