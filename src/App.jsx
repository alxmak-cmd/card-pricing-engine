import { useState, useEffect, useRef } from "react";

// ── PRICING ENGINE ────────────────────────────────────────────────────────────

const COSTS = {
  debitInterchange: 0.008,
  creditInterchange: 0.022,
  intlUplift: 0.01,
  networkFees: 0.0015,
};

const PRICING = {
  flatRate: 0.029,
  flatFixed: 0.30,
  icppMarkup: 0.005,
  blendedRate: 0.025,
  blendedFixed: 0.25,
};

function computeBlendedCost(inputs) {
  const pctDebit = 1 - inputs.pctCredit;
  const base = pctDebit * COSTS.debitInterchange + inputs.pctCredit * COSTS.creditInterchange;
  const intlImpact = inputs.pctInternational * COSTS.intlUplift;
  return base + intlImpact + COSTS.networkFees;
}

function flatRevenue(inputs) {
  const txCount = inputs.monthlyVolume / inputs.avgTransaction;
  return inputs.monthlyVolume * PRICING.flatRate + txCount * PRICING.flatFixed;
}

function icppRevenue(inputs) {
  return inputs.monthlyVolume * PRICING.icppMarkup;
}

function blendedRevenue(inputs) {
  const txCount = inputs.monthlyVolume / inputs.avgTransaction;
  return inputs.monthlyVolume * PRICING.blendedRate + txCount * PRICING.blendedFixed;
}

function computeMargin(revenue, volume, blendedCost) {
  const cost = volume * blendedCost;
  const margin = revenue - cost;
  const marginPct = revenue > 0 ? margin / revenue : 0;
  return { cost, revenue, margin, marginPct };
}

function recommendModel(inputs) {
  if (inputs.monthlyVolume > 1_000_000 && inputs.pctCredit < 0.6) return "IC++";
  if (inputs.avgTransaction < 20) return "Flat";
  return "Blended";
}

function generateInsights(inputs, results) {
  const insights = [];
  const rec = recommendModel(inputs);

  if (inputs.pctCredit > 0.7) {
    insights.push({ icon: "◈", text: "High credit mix increases interchange costs, compressing flat-rate margins." });
  }
  if (inputs.monthlyVolume > 1_000_000) {
    insights.push({ icon: "◈", text: "At this volume, IC++ aligns costs directly to interchange — better margin predictability." });
  }
  if (inputs.pctInternational > 0.2) {
    insights.push({ icon: "◈", text: "Cross-border volume adds ~1% uplift per transaction, creating margin volatility." });
  }
  if (inputs.avgTransaction < 20) {
    insights.push({ icon: "◈", text: "Small average ticket means fixed per-transaction fees dominate cost structure." });
  }
  if (rec === "Blended") {
    insights.push({ icon: "◈", text: "Blended pricing offers simplicity while capturing adequate margin at current mix." });
  }
  if (results.flat.marginPct < 0.15) {
    insights.push({ icon: "◈", text: "Flat rate margin is thin — consider IC++ to reduce exposure to high-cost cards." });
  }
  if (insights.length === 0) {
    insights.push({ icon: "◈", text: "Profile looks healthy. Blended pricing is efficient for this merchant segment." });
  }
  return insights;
}

// ── PRESETS ───────────────────────────────────────────────────────────────────

const PRESETS = {
  SaaS: { monthlyVolume: 5_000_000, avgTransaction: 50, pctCredit: 0.7, pctInternational: 0.1 },
  Marketplace: { monthlyVolume: 10_000_000, avgTransaction: 35, pctCredit: 0.55, pctInternational: 0.25 },
  Ecommerce: { monthlyVolume: 2_000_000, avgTransaction: 80, pctCredit: 0.85, pctInternational: 0.05 },
  "High Debit": { monthlyVolume: 5_000_000, avgTransaction: 50, pctCredit: 0.4, pctInternational: 0.1 },
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtPct(n) { return `${(n * 100).toFixed(1)}%`; }
function fmtVol(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// ── COMPONENTS ────────────────────────────────────────────────────────────────

function SliderInput({ label, value, min, max, step, onChange, format }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
        <span style={{ fontSize: "0.85rem", fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 600 }}>{format(value)}</span>
      </div>
      <div style={{ position: "relative", height: "2px", background: "var(--border)", borderRadius: "2px" }}>
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: "2px" }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{
            position: "absolute", top: "-8px", left: 0, width: "100%", height: "18px",
            opacity: 0, cursor: "pointer", margin: 0,
          }}
        />
        <div style={{
          position: "absolute", top: "50%", left: `${pct}%`, transform: "translate(-50%,-50%)",
          width: "12px", height: "12px", borderRadius: "50%", background: "var(--bg)",
          border: "2px solid var(--accent)", pointerEvents: "none",
        }} />
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
      </div>
      <input
        value={raw}
        onChange={e => { setRaw(e.target.value); const n = parseFloat(e.target.value.replace(/,/g, "")); if (!isNaN(n)) onChange(n); }}
        style={{
          width: "100%", background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
          color: "var(--accent)", fontSize: "0.85rem", fontFamily: "var(--font-mono)", fontWeight: 600,
          padding: "0.25rem 0", outline: "none", boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function AnimatedNumber({ value, format }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current;
    const end = value;
    const duration = 400;
    const startTime = performance.now();
    const tick = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setDisplay(start + (end - start) * ease);
      if (t < 1) requestAnimationFrame(tick);
      else prev.current = end;
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <span>{format(display)}</span>;
}

const MODEL_COLORS = { Flat: "#f59e0b", "IC++": "#10b981", Blended: "#6366f1" };
const MODEL_LABELS = { Flat: "Flat Rate", "IC++": "IC++", Blended: "Blended" };

function MarginBar({ value, max }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <div style={{ width: "100%", height: "3px", background: "var(--border)", borderRadius: "2px", marginTop: "0.3rem" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: "2px", transition: "width 0.4s ease" }} />
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function App() {
  const [inputs, setInputs] = useState(PRESETS["SaaS"]);
  const [activePreset, setActivePreset] = useState("SaaS");

  const set = (key) => (val) => { setInputs(p => ({ ...p, [key]: val })); setActivePreset(null); };

  const bc = computeBlendedCost(inputs);
  const results = {
    Flat: computeMargin(flatRevenue(inputs), inputs.monthlyVolume, bc),
    "IC++": computeMargin(icppRevenue(inputs), inputs.monthlyVolume, bc),
    Blended: computeMargin(blendedRevenue(inputs), inputs.monthlyVolume, bc),
  };
  const rec = recommendModel(inputs);
  const insights = generateInsights(inputs, results);
  const maxMargin = Math.max(...Object.values(results).map(r => r.margin));

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap');

        :root {
          --bg: #0a0a0f;
          --surface: #111118;
          --border: #1e1e2a;
          --muted: #4a4a60;
          --text: #e8e8f0;
          --accent: #c8ff46;
          --accent-dim: rgba(200,255,70,0.12);
          --font-display: 'Syne', sans-serif;
          --font-mono: 'DM Mono', monospace;
          --flat: #f59e0b;
          --icpp: #10b981;
          --blended: #6366f1;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg); color: var(--text); font-family: var(--font-display); }

        .app {
          min-height: 100vh;
          padding: 2rem;
          max-width: 1100px;
          margin: 0 auto;
        }

        .header {
          margin-bottom: 2.5rem;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .header-title {
          font-size: 1.05rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--accent);
        }

        .header-sub {
          font-size: 0.72rem;
          color: var(--muted);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-top: 0.25rem;
        }

        .presets {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .preset-btn {
          padding: 0.3rem 0.75rem;
          border-radius: 2px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted);
          font-family: var(--font-display);
          font-size: 0.72rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.15s;
        }
        .preset-btn:hover { border-color: var(--muted); color: var(--text); }
        .preset-btn.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

        .layout {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 1.5rem;
          align-items: start;
        }

        @media (max-width: 700px) {
          .layout { grid-template-columns: 1fr; }
          .app { padding: 1rem; }
        }

        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          padding: 1.5rem;
        }

        .panel-label {
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 1.5rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid var(--border);
        }

        .rec-block {
          background: var(--accent-dim);
          border: 1px solid var(--accent);
          padding: 1.25rem 1.5rem;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .rec-label {
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--accent);
          opacity: 0.7;
        }

        .rec-value {
          font-size: 1.6rem;
          font-weight: 800;
          color: var(--accent);
          letter-spacing: 0.02em;
        }

        .rec-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--accent);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        .table-wrap {
          overflow-x: auto;
          margin-bottom: 1.5rem;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-family: var(--font-mono);
          font-size: 0.8rem;
        }

        th {
          font-size: 0.62rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
          font-family: var(--font-display);
          font-weight: 600;
          text-align: left;
          padding: 0.5rem 0.75rem;
          border-bottom: 1px solid var(--border);
        }

        td {
          padding: 0.75rem;
          border-bottom: 1px solid var(--border);
          color: var(--text);
        }

        tr.recommended td { background: rgba(200,255,70,0.04); }

        .model-tag {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.8rem;
        }

        .model-dot {
          width: 6px; height: 6px; border-radius: 50%;
        }

        .margin-cell { min-width: 100px; }

        .insights-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .insight-item {
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
          font-size: 0.8rem;
          line-height: 1.5;
          color: #9090b0;
          padding: 0.75rem;
          border-left: 2px solid var(--border);
          transition: border-color 0.2s;
        }

        .insight-item:hover { border-color: var(--accent); color: var(--text); }

        .insight-icon { color: var(--accent); font-size: 0.7rem; margin-top: 0.2rem; flex-shrink: 0; }

        .cost-badge {
          font-size: 0.7rem;
          color: var(--muted);
          font-family: var(--font-mono);
          margin-top: 0.25rem;
        }

        input[type=range] { appearance: none; -webkit-appearance: none; }

        .section-divider {
          font-size: 0.62rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          margin: 1.25rem 0 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
        }

        .positive { color: #10b981; }
        .negative { color: #ef4444; }
        .neutral { color: var(--text); }
      `}</style>

      <div className="app">
        <div className="header">
          <div>
            <div className="header-title">Cards Pricing Engine</div>
            <div className="header-sub">Interchange intelligence for merchant pricing</div>
          </div>
          <div className="presets">
            {Object.keys(PRESETS).map(p => (
              <button
                key={p}
                className={`preset-btn ${activePreset === p ? "active" : ""}`}
                onClick={() => { setInputs(PRESETS[p]); setActivePreset(p); }}
              >{p}</button>
            ))}
          </div>
        </div>

        <div className="layout">
          {/* INPUT PANEL */}
          <div className="panel">
            <div className="panel-label">Merchant Profile</div>

            <NumberInput
              label="Monthly Volume ($)"
              value={inputs.monthlyVolume}
              onChange={set("monthlyVolume")}
            />

            <NumberInput
              label="Avg Transaction ($)"
              value={inputs.avgTransaction}
              onChange={set("avgTransaction")}
            />

            <SliderInput
              label="Credit Card Mix"
              value={inputs.pctCredit}
              min={0} max={1} step={0.01}
              onChange={set("pctCredit")}
              format={v => `${Math.round(v * 100)}% credit / ${Math.round((1 - v) * 100)}% debit`}
            />

            <SliderInput
              label="International %"
              value={inputs.pctInternational}
              min={0} max={0.5} step={0.01}
              onChange={set("pctInternational")}
              format={v => fmtPct(v)}
            />

            <div style={{ marginTop: "1.5rem", padding: "0.75rem", background: "var(--bg)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.62rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.5rem" }}>Blended Cost Rate</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", fontWeight: 500, color: "var(--text)" }}>
                <AnimatedNumber value={computeBlendedCost(inputs)} format={v => fmtPct(v)} />
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                {fmtVol(inputs.monthlyVolume)} × {fmtPct(computeBlendedCost(inputs))} = {fmt$(inputs.monthlyVolume * computeBlendedCost(inputs))}/mo
              </div>
            </div>
          </div>

          {/* OUTPUT PANEL */}
          <div>
            {/* Recommendation */}
            <div className="rec-block">
              <div>
                <div className="rec-label">Recommended Model</div>
                <div className="rec-value">{MODEL_LABELS[rec]}</div>
              </div>
              <div className="rec-dot" />
            </div>

            {/* Table */}
            <div className="panel" style={{ marginBottom: "1.5rem" }}>
              <div className="panel-label">Model Comparison</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Revenue</th>
                      <th>Cost</th>
                      <th>Margin</th>
                      <th>Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["Flat", "IC++", "Blended"].map(model => {
                      const r = results[model];
                      const isRec = model === rec;
                      const isPos = r.margin > 0;
                      return (
                        <tr key={model} className={isRec ? "recommended" : ""}>
                          <td>
                            <div className="model-tag">
                              <div className="model-dot" style={{ background: MODEL_COLORS[model] }} />
                              {MODEL_LABELS[model]}
                              {isRec && <span style={{ fontSize: "0.58rem", color: "var(--accent)", letterSpacing: "0.06em", marginLeft: "0.25rem" }}>★ REC</span>}
                            </div>
                          </td>
                          <td><AnimatedNumber value={r.revenue} format={fmt$} /></td>
                          <td><AnimatedNumber value={r.cost} format={fmt$} /></td>
                          <td className={isPos ? "positive" : "negative"}>
                            <AnimatedNumber value={r.margin} format={fmt$} />
                            <MarginBar value={r.margin} max={maxMargin} />
                          </td>
                          <td className={isPos ? "positive" : "negative"}>
                            <AnimatedNumber value={r.marginPct} format={fmtPct} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Insights */}
            <div className="panel">
              <div className="panel-label">Insights</div>
              <ul className="insights-list">
                {insights.map((ins, i) => (
                  <li key={i} className="insight-item">
                    <span className="insight-icon">{ins.icon}</span>
                    <span>{ins.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
