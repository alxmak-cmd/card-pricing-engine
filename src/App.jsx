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
  return base + inputs.pctInternational * COSTS.intlUplift + COSTS.networkFees;
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
  if (inputs.pctCredit > 0.7)
    insights.push("High credit mix increases interchange costs — flat-rate pricing absorbs this variability at the expense of margin.");
  if (inputs.monthlyVolume > 1_000_000)
    insights.push("At this volume scale, IC++ pricing aligns revenue directly to underlying interchange, improving margin predictability.");
  if (inputs.pctInternational > 0.2)
    insights.push("Cross-border volume adds ~1% cost uplift per transaction, introducing margin volatility across all models.");
  if (inputs.avgTransaction < 20)
    insights.push("Small average ticket size means per-transaction fixed fees represent a disproportionate share of total cost.");
  if (results["Flat"].marginPct < 0.15)
    insights.push("Flat rate margin is thin at this mix — consider IC++ to reduce exposure to high-cost card types.");
  if (inputs.pctCredit < 0.5 && inputs.monthlyVolume > 500_000)
    insights.push("Debit-heavy volume is a structural advantage — lower interchange costs improve margins across all pricing models.");
  if (insights.length === 0)
    insights.push("Merchant profile is well-balanced. Blended pricing offers simplicity without significant margin trade-off.");
  return insights;
}

// ── SENSITIVITY DATA ──────────────────────────────────────────────────────────

function buildSensitivityData(inputs) {
  const points = [];
  for (let pct = 0; pct <= 1; pct += 0.05) {
    const inp = { ...inputs, pctCredit: pct };
    const bc = computeBlendedCost(inp);
    const flat = computeMargin(flatRevenue(inp), inp.monthlyVolume, bc);
    const icpp = computeMargin(icppRevenue(inp), inp.monthlyVolume, bc);
    const blended = computeMargin(blendedRevenue(inp), inp.monthlyVolume, bc);
    points.push({ pct, flat: flat.marginPct * 100, icpp: icpp.marginPct * 100, blended: blended.marginPct * 100 });
  }
  return points;
}

// ── PRESETS ───────────────────────────────────────────────────────────────────

const PRESETS = {
  SaaS: { monthlyVolume: 5_000_000, avgTransaction: 50, pctCredit: 0.7, pctInternational: 0.1 },
  Marketplace: { monthlyVolume: 10_000_000, avgTransaction: 35, pctCredit: 0.55, pctInternational: 0.25 },
  Ecommerce: { monthlyVolume: 2_000_000, avgTransaction: 80, pctCredit: 0.85, pctInternational: 0.05 },
  "High Debit": { monthlyVolume: 5_000_000, avgTransaction: 50, pctCredit: 0.4, pctInternational: 0.1 },
};

const PRESET_DESCRIPTIONS = {
  SaaS: "Mid-market, recurring billing",
  Marketplace: "High volume, mixed cards",
  Ecommerce: "Consumer retail, credit-heavy",
  "High Debit": "Debit-dominant, lower costs",
};

// ── TOOLTIPS ──────────────────────────────────────────────────────────────────

const TOOLTIPS = {
  monthlyVolume: "Total dollar value of card transactions processed per month. Higher volume unlocks better economics on IC++ pricing.",
  avgTransaction: "Average size of a single transaction. Values under $20 make per-transaction fixed fees a significant cost driver.",
  pctCredit: "Share of transactions on credit cards vs debit. Credit cards carry higher interchange (~2.2% vs 0.8% for debit).",
  pctInternational: "Share of transactions from non-domestic cards. International cards add ~1% in cross-border fees on top of base interchange.",
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtPct(n) { return `${(n * 100).toFixed(1)}%`; }
function fmtVolLabel(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// ── ANIMATED NUMBER ───────────────────────────────────────────────────────────

function AnimatedNumber({ value, format }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current;
    const end = value;
    const duration = 350;
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

// ── TOOLTIP ───────────────────────────────────────────────────────────────────

function Tooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{
          width: "15px", height: "15px", borderRadius: "50%",
          background: "#1e1e26", border: "1px solid #2e2e3a",
          color: "#55556a", fontSize: "9px", fontWeight: 700,
          cursor: "help", display: "inline-flex", alignItems: "center",
          justifyContent: "center", marginLeft: "6px",
          fontFamily: "inherit", flexShrink: 0,
        }}
      >?</button>
      {show && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)", width: "220px",
          background: "#1e1e28", border: "1px solid #2e2e3e",
          borderRadius: "6px", padding: "10px 12px",
          fontSize: "0.72rem", lineHeight: 1.6, color: "#9090a8",
          zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          pointerEvents: "none",
        }}>{text}</div>
      )}
    </span>
  );
}

// ── SLIDER INPUT ──────────────────────────────────────────────────────────────

function SliderInput({ label, value, min, max, step, onChange, format, tooltip, sublabel }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#9090a8" }}>{label}</span>
          {tooltip && <Tooltip text={tooltip} />}
        </div>
        <span style={{ fontSize: "0.78rem", fontFamily: "'IBM Plex Mono', monospace", color: "#f0f0f4", fontWeight: 500 }}>{format(value)}</span>
      </div>
      {sublabel && <div style={{ fontSize: "0.68rem", color: "#55556a", marginBottom: "0.5rem" }}>{sublabel}</div>}
      <div style={{ position: "relative", height: "2px", background: "#1e1e2a", borderRadius: "2px", margin: "10px 0" }}>
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: "100%", background: "#4f8ef7", borderRadius: "2px" }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: "absolute", top: "-8px", left: 0, width: "100%", height: "18px", opacity: 0, cursor: "pointer", margin: 0 }}
        />
        <div style={{
          position: "absolute", top: "50%", left: `${pct}%`,
          transform: "translate(-50%,-50%)", width: "13px", height: "13px",
          borderRadius: "50%", background: "white", border: "2px solid #4f8ef7",
          pointerEvents: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
        <span style={{ fontSize: "0.65rem", color: "#55556a", fontFamily: "'IBM Plex Mono', monospace" }}>{format(min)}</span>
        <span style={{ fontSize: "0.65rem", color: "#55556a", fontFamily: "'IBM Plex Mono', monospace" }}>{format(max)}</span>
      </div>
    </div>
  );
}

// ── NUMBER INPUT ──────────────────────────────────────────────────────────────

function NumberInput({ label, value, onChange, tooltip }) {
  const [raw, setRaw] = useState(value.toLocaleString());
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setRaw(value.toLocaleString()); }, [value, focused]);
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#9090a8" }}>{label}</span>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <div style={{
        display: "flex", alignItems: "center",
        background: "#1c1c22", border: `1px solid ${focused ? "#4f8ef7" : "#2a2a34"}`,
        borderRadius: "6px", padding: "0 12px", transition: "border-color 0.15s",
      }}>
        <span style={{ color: "#55556a", fontSize: "0.82rem", marginRight: "4px", fontFamily: "'IBM Plex Mono', monospace" }}>$</span>
        <input
          value={focused ? raw.replace(/,/g, "") : raw}
          onFocus={() => { setFocused(true); setRaw(value.toString()); }}
          onBlur={() => { setFocused(false); setRaw(value.toLocaleString()); }}
          onChange={e => {
            setRaw(e.target.value);
            const n = parseFloat(e.target.value.replace(/,/g, ""));
            if (!isNaN(n) && n > 0) onChange(n);
          }}
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "#f0f0f4", fontSize: "0.85rem",
            fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
            padding: "9px 0",
          }}
        />
      </div>
    </div>
  );
}

// ── SENSITIVITY CHART ─────────────────────────────────────────────────────────

function SensitivityChart({ inputs }) {
  const data = buildSensitivityData(inputs);
  const currentPct = inputs.pctCredit;
  const w = 500, h = 190, padL = 42, padR = 16, padT = 16, padB = 32;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const allVals = data.flatMap(d => [d.flat, d.icpp, d.blended]);
  const minVal = Math.floor(Math.min(...allVals)) - 2;
  const maxVal = Math.ceil(Math.max(...allVals)) + 2;

  const xScale = pct => padL + (pct / 1) * chartW;
  const yScale = val => padT + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;

  const makePath = (key) => {
    return data.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(d.pct)},${yScale(d[key])}`).join(" ");
  };

  const xNow = xScale(currentPct);
  const nearest = data.reduce((a, b) => Math.abs(a.pct - currentPct) < Math.abs(b.pct - currentPct) ? a : b);

  const yTicks = 4;
  const yStep = (maxVal - minVal) / yTicks;

  return (
    <div>
      <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        {[["#4f8ef7", "Flat Rate"], ["#34c98a", "IC++"], ["#9b7ff4", "Blended"]].map(([color, label]) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.72rem", color: "#9090a8" }}>
            <span style={{ width: 20, height: 2, background: color, display: "inline-block", borderRadius: 1 }} />{label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", overflow: "visible" }}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = minVal + yStep * i;
          const y = yScale(val);
          return (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="#1e1e2a" strokeWidth="1" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="9" fill="#55556a" fontFamily="'IBM Plex Mono', monospace">{val.toFixed(0)}%</text>
            </g>
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map(p => (
          <text key={p} x={xScale(p)} y={h - 4} textAnchor="middle" fontSize="9" fill="#55556a" fontFamily="'IBM Plex Mono', monospace">{Math.round(p * 100)}%</text>
        ))}
        <path d={makePath("flat")} fill="none" stroke="#4f8ef7" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={makePath("blended")} fill="none" stroke="#9b7ff4" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={makePath("icpp")} fill="none" stroke="#34c98a" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1={xNow} x2={xNow} y1={padT} y2={padT + chartH} stroke="#3a3a4a" strokeWidth="1" strokeDasharray="4,3" />
        <circle cx={xNow} cy={yScale(nearest.flat)} r="3.5" fill="#4f8ef7" />
        <circle cx={xNow} cy={yScale(nearest.blended)} r="3.5" fill="#9b7ff4" />
        <circle cx={xNow} cy={yScale(nearest.icpp)} r="3.5" fill="#34c98a" />
      </svg>
      <div style={{ fontSize: "0.67rem", color: "#55556a", textAlign: "center", marginTop: "0.3rem" }}>
        X-axis: credit card mix (0% → 100%) · Dashed line = current profile
      </div>
    </div>
  );
}

// ── EXPORT ────────────────────────────────────────────────────────────────────

function exportResults(inputs, results, rec) {
  const bc = computeBlendedCost(inputs);
  const lines = [
    "Cards Pricing Intelligence Engine",
    "==================================",
    "",
    "MERCHANT PROFILE",
    `Monthly Volume:    ${fmtVolLabel(inputs.monthlyVolume)}`,
    `Avg Transaction:   $${inputs.avgTransaction}`,
    `Credit Mix:        ${Math.round(inputs.pctCredit * 100)}%`,
    `International:     ${Math.round(inputs.pctInternational * 100)}%`,
    `Blended Cost Rate: ${fmtPct(bc)}`,
    "",
    "MODEL COMPARISON",
    "Model\t\tRevenue\t\tCost\t\tMargin\t\tMargin %",
    ...["Flat", "IC++", "Blended"].map(m => {
      const r = results[m];
      const label = m === "IC++" ? "IC++  " : m === "Flat" ? "Flat  " : "Blended";
      return `${label}\t\t${fmt$(r.revenue)}\t\t${fmt$(r.cost)}\t\t${fmt$(r.margin)}\t\t${fmtPct(r.marginPct)}`;
    }),
    "",
    `RECOMMENDATION: ${rec}`,
    "",
    `Generated: ${new Date().toLocaleString()}`,
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "pricing-analysis.txt"; a.click();
  URL.revokeObjectURL(url);
}

// ── MODEL META ────────────────────────────────────────────────────────────────

const MODEL_META = {
  "Flat":    { color: "#4f8ef7", label: "Flat Rate", desc: "Simple % + fixed fee per transaction" },
  "IC++":    { color: "#34c98a", label: "IC++",      desc: "Interchange pass-through + fixed markup" },
  "Blended": { color: "#9b7ff4", label: "Blended",   desc: "Balanced rate + fixed fee" },
};

// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function App() {
  const [inputs, setInputs] = useState(PRESETS["SaaS"]);
  const [activePreset, setActivePreset] = useState("SaaS");
  const [showChart, setShowChart] = useState(false);
  const [exported, setExported] = useState(false);

  const set = (key) => (val) => { setInputs(p => ({ ...p, [key]: val })); setActivePreset(null); };

  const bc = computeBlendedCost(inputs);
  const results = {
    "Flat":    computeMargin(flatRevenue(inputs), inputs.monthlyVolume, bc),
    "IC++":    computeMargin(icppRevenue(inputs), inputs.monthlyVolume, bc),
    "Blended": computeMargin(blendedRevenue(inputs), inputs.monthlyVolume, bc),
  };
  const rec = recommendModel(inputs);
  const insights = generateInsights(inputs, results);
  const maxMargin = Math.max(...Object.values(results).map(r => Math.max(r.margin, 0)));

  const handleExport = () => {
    exportResults(inputs, results, rec);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d10; color: #f0f0f4; font-family: 'Geist', -apple-system, sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
        input[type=range] { appearance: none; -webkit-appearance: none; }
        button { cursor: pointer; font-family: inherit; }
      `}</style>

      <div style={{ minHeight: "100vh", padding: "2rem 1.5rem", maxWidth: "1160px", margin: "0 auto" }}>

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "2rem", paddingBottom: "1.5rem", borderBottom: "1px solid #1a1a22", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#55556a", marginBottom: "0.35rem" }}>Pricing Intelligence</div>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: "1.5rem", fontStyle: "italic", color: "#f0f0f4", letterSpacing: "-0.01em" }}>Card Processing Economics</div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
            {[
              { label: showChart ? "Hide Chart" : "Sensitivity Chart", onClick: () => setShowChart(v => !v), active: showChart },
              { label: exported ? "Exported ✓" : "Export Results", onClick: handleExport, active: exported },
            ].map(({ label, onClick, active }) => (
              <button key={label} onClick={onClick} style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                padding: "0.45rem 0.85rem", borderRadius: "6px",
                fontSize: "0.75rem", fontWeight: 500,
                border: active ? "1px solid rgba(79,142,247,0.35)" : "1px solid #2a2a34",
                background: active ? "rgba(79,142,247,0.1)" : "#16161a",
                color: active ? "#4f8ef7" : "#9090a8",
                transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* PRESETS */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
          {Object.keys(PRESETS).map(p => (
            <button key={p} onClick={() => { setInputs(PRESETS[p]); setActivePreset(p); }} style={{
              display: "flex", flexDirection: "column", gap: "2px",
              padding: "0.6rem 1rem", borderRadius: "8px",
              border: activePreset === p ? "1px solid rgba(79,142,247,0.4)" : "1px solid #1e1e28",
              background: activePreset === p ? "rgba(79,142,247,0.08)" : "#16161a",
              color: activePreset === p ? "#4f8ef7" : "#9090a8",
              fontSize: "0.75rem", fontWeight: 500, textAlign: "left",
              transition: "all 0.15s",
            }}>
              <span>{p}</span>
              <span style={{ fontSize: "0.65rem", color: activePreset === p ? "rgba(79,142,247,0.6)" : "#55556a", fontWeight: 400 }}>{PRESET_DESCRIPTIONS[p]}</span>
            </button>
          ))}
        </div>

        {/* LAYOUT */}
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.25rem", alignItems: "start" }}>

          {/* LEFT PANEL */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {/* INPUTS */}
            <div style={{ background: "#16161a", border: "1px solid #1e1e28", borderRadius: "8px", padding: "1.25rem" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#55556a", marginBottom: "1.25rem", paddingBottom: "0.75rem", borderBottom: "1px solid #1e1e28" }}>
                Merchant Profile
              </div>
              <NumberInput label="Monthly Volume" value={inputs.monthlyVolume} onChange={set("monthlyVolume")} tooltip={TOOLTIPS.monthlyVolume} />
              <NumberInput label="Avg Transaction" value={inputs.avgTransaction} onChange={set("avgTransaction")} tooltip={TOOLTIPS.avgTransaction} />
              <SliderInput label="Credit Card Mix" value={inputs.pctCredit} min={0} max={1} step={0.01} onChange={set("pctCredit")} format={v => `${Math.round(v * 100)}% credit`} tooltip={TOOLTIPS.pctCredit} sublabel={`${Math.round(inputs.pctCredit * 100)}% credit · ${Math.round((1 - inputs.pctCredit) * 100)}% debit`} />
              <SliderInput label="International Mix" value={inputs.pctInternational} min={0} max={0.5} step={0.01} onChange={set("pctInternational")} format={v => fmtPct(v)} tooltip={TOOLTIPS.pctInternational} />
            </div>

            {/* COST SUMMARY */}
            <div style={{ background: "#16161a", border: "1px solid #1e1e28", borderRadius: "8px", padding: "1.25rem" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#55556a", marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid #1e1e28" }}>
                Cost Summary
              </div>
              {[
                ["Blended Cost Rate", <AnimatedNumber value={bc} format={fmtPct} />],
                ["Monthly Cost ($)", <AnimatedNumber value={inputs.monthlyVolume * bc} format={fmt$} />],
                ["Transactions / Mo", Math.round(inputs.monthlyVolume / inputs.avgTransaction).toLocaleString()],
                ["Debit Interchange", fmtPct(COSTS.debitInterchange)],
                ["Credit Interchange", fmtPct(COSTS.creditInterchange)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid #1a1a22", fontSize: "0.78rem" }}>
                  <span style={{ color: "#9090a8" }}>{k}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, color: "#f0f0f4" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {/* RECOMMENDATION */}
            <div style={{ background: "#16161a", border: "1px solid #2a2a38", borderRadius: "8px", padding: "1.25rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#55556a", marginBottom: "0.3rem" }}>Recommended Model</div>
                <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: "1.75rem", fontStyle: "italic", color: "#f0f0f4", letterSpacing: "-0.01em" }}>{MODEL_META[rec].label}</div>
                <div style={{ fontSize: "0.72rem", color: "#55556a", marginTop: "0.2rem" }}>{MODEL_META[rec].desc}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "1.5rem", fontWeight: 500, color: "#f0f0f4" }}>
                  <AnimatedNumber value={results[rec].marginPct} format={fmtPct} />
                </div>
                <div style={{ fontSize: "0.68rem", color: "#55556a", marginBottom: "0.2rem" }}>margin rate</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.85rem", color: "#34c98a" }}>
                  <AnimatedNumber value={results[rec].margin} format={fmt$} /> /mo
                </div>
              </div>
            </div>

            {/* MODEL TABLE */}
            <div style={{ background: "#16161a", border: "1px solid #1e1e28", borderRadius: "8px", padding: "1.25rem" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#55556a", marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid #1e1e28" }}>
                Model Comparison
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Model", "Revenue", "Cost", "Margin", "Margin %"].map(h => (
                      <th key={h} style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.07em", textTransform: "uppercase", color: "#55556a", textAlign: "left", padding: "0 0.75rem 0.6rem", borderBottom: "1px solid #1e1e28" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {["Flat", "IC++", "Blended"].map(model => {
                    const r = results[model];
                    const isRec = model === rec;
                    const isPos = r.margin >= 0;
                    const barW = maxMargin > 0 ? Math.max(0, r.margin / maxMargin) * 100 : 0;
                    return (
                      <tr key={model} style={{ background: isRec ? "rgba(255,255,255,0.02)" : "transparent" }}>
                        <td style={{ padding: "0.9rem 0.75rem", borderBottom: "1px solid #1a1a22" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: MODEL_META[model].color, flexShrink: 0 }} />
                            <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "#f0f0f4" }}>{MODEL_META[model].label}</span>
                            {isRec && <span style={{ fontSize: "0.6rem", background: "rgba(79,142,247,0.1)", color: "#4f8ef7", border: "1px solid rgba(79,142,247,0.25)", padding: "2px 6px", borderRadius: "3px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Rec</span>}
                          </div>
                        </td>
                        {[fmt$(r.revenue), fmt$(r.cost)].map((val, i) => (
                          <td key={i} style={{ padding: "0.9rem 0.75rem", borderBottom: "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", color: "#9090a8" }}>{val}</td>
                        ))}
                        <td style={{ padding: "0.9rem 0.75rem", borderBottom: "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", color: isPos ? "#34c98a" : "#f25f5c" }}>
                          <div><AnimatedNumber value={r.margin} format={fmt$} /></div>
                          <div style={{ width: "100%", height: "2px", background: "#1e1e2a", borderRadius: "2px", marginTop: "5px" }}>
                            <div style={{ width: `${barW}%`, height: "100%", background: MODEL_META[model].color, borderRadius: "2px", transition: "width 0.4s ease" }} />
                          </div>
                        </td>
                        <td style={{ padding: "0.9rem 0.75rem", borderBottom: "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", color: isPos ? "#34c98a" : "#f25f5c" }}>
                          <AnimatedNumber value={r.marginPct} format={fmtPct} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* SENSITIVITY CHART */}
            {showChart && (
              <div style={{ background: "#16161a", border: "1px solid #1e1e28", borderRadius: "8px", padding: "1.25rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#55556a", marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid #1e1e28" }}>
                  Sensitivity Analysis — Margin % vs Credit Mix
                </div>
                <SensitivityChart inputs={inputs} />
              </div>
            )}

            {/* INSIGHTS */}
            <div style={{ background: "#16161a", border: "1px solid #1e1e28", borderRadius: "8px", padding: "1.25rem" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#55556a", marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid #1e1e28", display: "flex", justifyContent: "space-between" }}>
                <span>Analysis</span>
                <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{insights.length} insight{insights.length !== 1 ? "s" : ""}</span>
              </div>
              {insights.map((text, i) => (
                <div key={i} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", padding: "0.75rem 0", borderBottom: i < insights.length - 1 ? "1px solid #1a1a22" : "none", fontSize: "0.8rem", lineHeight: 1.65, color: "#9090a8" }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.65rem", color: "#55556a", marginTop: "0.2rem", flexShrink: 0, width: "18px" }}>0{i + 1}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
