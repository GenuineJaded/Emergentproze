import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--ink-bg)" }}
      data-testid="home-page"
    >
      {/* Top bar — only the wordmark */}
      <div className="px-10 pt-10">
        <span
          className="font-wordmark text-[15px]"
          style={{ color: "var(--ink-text-dim)" }}
        >
          mercurius
        </span>
      </div>

      {/* Main content — left-aligned, generous space */}
      <main className="flex-1 flex flex-col justify-center px-10 max-w-2xl">
        <h1
          className="font-serif slow-rise slow-rise-delay-1 text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight"
          style={{ color: "var(--ink-text)" }}
          data-testid="home-title"
        >
          The Living Sketch
        </h1>

        <p
          className="font-serif slow-rise slow-rise-delay-2 mt-6 text-lg italic"
          style={{ color: "var(--ink-text-dim)", maxWidth: "32rem" }}
        >
          A linguistic bridge that knows it is a bridge. Two openings, for now —
          one geometric, one spoken.
        </p>

        <nav
          className="slow-rise slow-rise-delay-3 mt-16 flex flex-col gap-6"
          data-testid="home-nav"
        >
          <HomeLink
            to="/geometry"
            label="Geometry"
            sublabel="the bicone — perspective makes the shape"
            testId="home-link-geometry"
          />
          <HomeLink
            to="/mercurius"
            label="Mercurius"
            sublabel="the companion — speak from within the sketch"
            testId="home-link-mercurius"
          />
        </nav>

        <div
          className="slow-rise slow-rise-delay-4 mt-24 font-ui text-xs uppercase tracking-[0.18em]"
          style={{ color: "var(--ink-text-faint)" }}
        >
          Phase 0 · proof of concept
        </div>
      </main>

      <footer className="px-10 pb-10 font-ui text-xs" style={{ color: "var(--ink-text-faint)" }}>
        <span className="opacity-70">
          “Continuity is evidence of stabilization, not evidence of origin.”
        </span>
      </footer>
    </div>
  );
}

function HomeLink({ to, label, sublabel, testId }) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="group inline-flex flex-col gap-1 w-fit"
    >
      <span
        className="font-serif text-2xl sm:text-3xl transition-colors duration-500"
        style={{ color: "var(--ink-text)" }}
      >
        <span
          className="border-b border-transparent group-hover:border-current pb-0.5 transition-all duration-500"
          style={{ borderColor: "rgba(200,162,107,0.0)" }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--ink-accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(200,162,107,0.0)")}
        >
          {label}
        </span>
      </span>
      <span
        className="font-serif italic text-base"
        style={{ color: "var(--ink-text-faint)" }}
      >
        {sublabel}
      </span>
    </Link>
  );
}
