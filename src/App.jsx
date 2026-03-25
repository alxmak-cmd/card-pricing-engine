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

// FIX 1: IC++ revenue = interchange passthrough + markup (full merchant payment)
// Margin = markup only. Previously only counted markup, causing false negative margins.
function icppRevenue(inputs) {
  const bc = computeBlendedCost(inputs);
  return inputs.monthlyVolume * (bc + PRICING.icppMarkup);
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

// ── ENRICHED INSIGHTS ─────────────────────────────────────────────────────────

function generateInsights(inputs, results, bc) {
  const insights = [];
  const txCount = Math.round(inputs.monthlyVolume / inputs.avgTransaction);
  const intlCostMonthly = inputs.monthlyVolume * inputs.pctInternational * COSTS.intlUplift;
  const creditPremium = inputs.pctCredit * (COSTS.creditInterchange - COSTS.debitInterchange) * inputs.monthlyVolume;

  if (inputs.pctCredit > 0.7) {
    insights.push({
      tag: "Card Mix",
      text: `Credit-heavy mix adds ${fmt$(creditPremium)}/mo in interchange vs. an all-debit portfolio — flat-rate pricing absorbs this at the expense of margin.`,
    });
  }
  if (inputs.monthlyVolume > 1_000_000) {
    const icppVsBlended = results["IC++"].margin - results["Blended"].margin;
    insights.push({
      tag: "Volume",
      text: `At ${fmtVolLabel(inputs.monthlyVolume)}/mo, IC++ ${icppVsBlended >= 0 ? `captures ${fmt$(Math.abs(icppVsBlended))} more margin` : `trails Blended by ${fmt$(Math.abs(icppVsBlended))}`} vs. Blended — interchange pass-through improves predictability at scale.`,
    });
  }
  if (inputs.pctInternational > 0.2) {
    insights.push({
      tag: "Cross-Border",
      text: `International transactions are costing ${fmt$(intlCostMonthly)}/mo in uplift fees — ${(inputs.pctInternational * 100).toFixed(0)}% cross-border exposure introduces margin volatility across all models.`,
    });
  }
  if (inputs.avgTransaction < 20) {
    const fixedFeeImpact = txCount * PRICING.flatFixed;
    insights.push({
      tag: "Ticket Size",
      text: `With ${txCount.toLocaleString()} transactions at $${inputs.avgTransaction} avg, flat fixed fees alone add up to ${fmt$(fixedFeeImpact)}/mo — small-ticket volume is fee-sensitive.`,
    });
  }
  if (results["Flat"].marginPct < 0.15) {
    insights.push({
      tag: "Risk",
      text: `Flat rate margin is ${(results["Flat"].marginPct * 100).toFixed(1)}% — below the 15% threshold. IC++ would reduce exposure to high-cost card types and improve margin floor.`,
    });
  }
  if (inputs.pctCredit < 0.5 && inputs.monthlyVolume > 500_000) {
    insights.push({
      tag: "Advantage",
      text: `Debit-dominant mix (${Math.round((1 - inputs.pctCredit) * 100)}% debit) is a structural cost advantage — blended interchange of ${fmtPct(bc)} is well below the credit-heavy benchmark of ~2.4%.`,
    });
  }
  if (insights.length === 0) {
    insights.push({
      tag: "Summary",
      text: `Merchant profile is well-balanced. Blended pricing captures adequate margin at ${fmtPct(results["Blended"].marginPct)} without the operational overhead of IC++.`,
    });
  }
  return insights;
}

// ── SENSITIVITY DATA ──────────────────────────────────────────────────────────

function buildSensitivityData(inputs) {
  const points = [];
  for (let pct = 0; pct <= 1; pct += 0.05) {
    const inp = { ...inputs, pctCredit: pct };
    const bc = computeBlendedCost(inp);
    const flat = computeMargin(flatRevenue(inp), inp.monthlyVolume, bc);
    const blended = computeMargin(blendedRevenue(inp), inp.monthlyVolume, bc);
    // IC++ margin % = markup / (interchange + markup) — the meaningful metric
    // since revenue includes interchange passthrough which is a pure cost passthrough
    const icppMarkupRevenue = inp.monthlyVolume * PRICING.icppMarkup;
    const icppTotalRevenue = icppRevenue(inp);
    const icppMarginPct = icppTotalRevenue > 0 ? icppMarkupRevenue / icppTotalRevenue * 100 : 0;
    points.push({ pct, flat: flat.marginPct * 100, icpp: icppMarginPct, blended: blended.marginPct * 100 });
  }
  return points;
}

// ── COMPETITIVE BENCHMARKS ────────────────────────────────────────────────────

const COMPETITORS = [
  {
    name: "Adyen",
    pricingModel: "IC++",
    markupPct: 0.004, fixedPerTx: 0.13,
    rateDisplay: "Interchange + 0.40% + $0.13/tx",
    note: "Requires volume commitment; negotiated",
  },
  {
    name: "Braintree",
    pricingModel: "Flat",
    flatPct: 0.0349, fixedPerTx: 0.00,
    rateDisplay: "3.49% + $0.00/tx",
    note: "No fixed fee; higher % rate",
  },
  {
    name: "Square",
    pricingModel: "Flat",
    flatPct: 0.029, fixedPerTx: 0.30,
    rateDisplay: "2.90% + $0.30/tx",
    note: "Online rate; in-person is 2.6%+$0.10",
  },
  {
    name: "Checkout.com",
    pricingModel: "IC++",
    markupPct: 0.006, fixedPerTx: 0.00,
    rateDisplay: "Interchange + 0.60% + $0.00/tx",
    note: "Standard published rate; enterprise varies",
  },
];

function computeMerchantCost(comp, inputs, ic) {
  const txCount = inputs.monthlyVolume / inputs.avgTransaction;
  if (comp.pricingModel === "IC++") {
    return inputs.monthlyVolume * ic + inputs.monthlyVolume * comp.markupPct + txCount * comp.fixedPerTx;
  }
  return inputs.monthlyVolume * comp.flatPct + txCount * comp.fixedPerTx;
}

function computeStripeMerchantCost(model, inputs) {
  const txCount = inputs.monthlyVolume / inputs.avgTransaction;
  if (model === "Flat")    return inputs.monthlyVolume * PRICING.flatRate + txCount * PRICING.flatFixed;
  if (model === "IC++")    return inputs.monthlyVolume * (computeBlendedCost(inputs) + PRICING.icppMarkup);
  if (model === "Blended") return inputs.monthlyVolume * PRICING.blendedRate + txCount * PRICING.blendedFixed;
  return 0;
}

// ── PRESETS ───────────────────────────────────────────────────────────────────

const PRESETS = {
  SaaS:        { monthlyVolume: 5_000_000,  avgTransaction: 50, pctCredit: 0.70, pctInternational: 0.10 },
  Marketplace: { monthlyVolume: 10_000_000, avgTransaction: 35, pctCredit: 0.55, pctInternational: 0.25 },
  Ecommerce:   { monthlyVolume: 2_000_000,  avgTransaction: 80, pctCredit: 0.85, pctInternational: 0.05 },
  "High Debit":{ monthlyVolume: 5_000_000,  avgTransaction: 50, pctCredit: 0.40, pctInternational: 0.10 },
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
  const makePath = (key) => data.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(d.pct)},${yScale(d[key])}`).join(" ");
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

// ── SHARED COMPONENTS ─────────────────────────────────────────────────────────

const MODEL_META = {
  "Flat":    { color: "#4f8ef7", label: "Flat Rate", desc: "Simple % + fixed fee per transaction" },
  "IC++":    { color: "#34c98a", label: "IC++",      desc: "Interchange pass-through + fixed markup" },
  "Blended": { color: "#9b7ff4", label: "Blended",   desc: "Balanced rate + fixed fee" },
};

function Panel({ children, style }) {
  return (
    <div style={{ background: "#16161a", border: "1px solid #1e1e28", borderRadius: "8px", padding: "1.25rem", ...style }}>
      {children}
    </div>
  );
}

function SectionHeader({ label, right }) {
  return (
    <div style={{
      fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em",
      textTransform: "uppercase", color: "#55556a",
      marginBottom: "1rem", paddingBottom: "0.75rem",
      borderBottom: "1px solid #1e1e28",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span>{label}</span>
      {right && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{right}</span>}
    </div>
  );
}

// ── METHODOLOGY PANEL ─────────────────────────────────────────────────────────

function MethodologyPanel({ inputs, results, rec }) {
  const [open, setOpen] = useState(false);
  const bc = computeBlendedCost(inputs);
  const txCount = Math.round(inputs.monthlyVolume / inputs.avgTransaction);

  const vol1M = inputs.monthlyVolume > 1_000_000;
  const creditLow = inputs.pctCredit < 0.6;
  const smallTicket = inputs.avgTransaction < 20;

  let decisiveStep = 2;
  if (vol1M && creditLow) decisiveStep = 0;
  else if (smallTicket) decisiveStep = 1;

  const steps = [
    {
      label: "Step 1 — IC++ threshold",
      desc: "IC++ outperforms when volume is high and credit mix is below 60% — interchange pass-through beats a flat markup at scale.",
      formula: `Volume ${fmtVolLabel(inputs.monthlyVolume)} ${vol1M ? ">" : "≤"} $1M  ·  Credit ${Math.round(inputs.pctCredit * 100)}% ${creditLow ? "<" : "≥"} 60%`,
      pass: vol1M && creditLow,
      result: vol1M && creditLow
        ? "✓ Both met → IC++ recommended"
        : `✗ ${!vol1M ? "Volume below $1M" : "Credit mix ≥ 60%"} → skip`,
      color: "#34c98a",
    },
    {
      label: "Step 2 — Flat rate threshold",
      desc: "Flat rate wins when ticket size is small — fixed per-transaction fees dominate costs and predictability matters more than rate.",
      formula: `Avg transaction $${inputs.avgTransaction} ${smallTicket ? "<" : "≥"} $20`,
      pass: smallTicket,
      result: smallTicket
        ? "✓ Small ticket → Flat Rate recommended"
        : "✗ Ticket above threshold → skip",
      color: "#4f8ef7",
    },
    {
      label: "Step 3 — Default to Blended",
      desc: "All other profiles use Blended — a balanced rate that captures adequate margin without interchange complexity.",
      formula: `${fmtVolLabel(inputs.monthlyVolume)} × 2.50% + ${txCount.toLocaleString()} txns × $0.25`,
      pass: decisiveStep === 2,
      result: `= ${fmt$(results["Blended"].revenue)} revenue · ${fmtPct(results["Blended"].marginPct)} margin`,
      color: "#9b7ff4",
    },
  ];

  return (
    <Panel>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", background: "none", border: "none", padding: 0,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          cursor: "pointer",
        }}
      >
        <div style={{
          fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "#55556a",
          paddingBottom: "0.75rem", borderBottom: "1px solid #1e1e28",
          width: "100%", textAlign: "left", display: "flex",
          justifyContent: "space-between", alignItems: "center",
          marginBottom: "0",
        }}>
          <span>How the recommendation is made</span>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.75rem",
            color: "#3a3a4a", display: "inline-block",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s", marginLeft: "8px",
          }}>▾</span>
        </div>
      </button>

      {!open && (
        <div style={{ fontSize: "0.78rem", color: "#55556a", lineHeight: 1.65, marginTop: "0.85rem" }}>
          A rules-based decision tree evaluates volume, credit mix, and ticket size to select the highest-margin model.{" "}
          <span
            onClick={() => setOpen(true)}
            style={{ color: "#4f8ef7", cursor: "pointer", textDecoration: "underline" }}
          >Show methodology →</span>
        </div>
      )}

      {open && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{
            background: "#111116", border: "1px solid #2a2a38", borderRadius: "6px",
            padding: "0.75rem 1rem", marginBottom: "1.25rem",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: "0.74rem", color: "#55556a" }}>Current recommendation for this profile:</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: MODEL_META[rec].color }} />
              <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#f0f0f4" }}>{MODEL_META[rec].label}</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {steps.map((step, i) => {
              const isDecisive = i === decisiveStep;
              const isDone = i < decisiveStep;
              return (
                <div key={i} style={{
                  paddingLeft: "0.875rem",
                  borderLeft: `2px solid ${isDecisive ? step.color : isDone ? "#2a2a38" : "#1e1e28"}`,
                  opacity: i > decisiveStep ? 0.38 : 1,
                  transition: "opacity 0.2s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <span style={{
                      fontSize: "0.69rem", fontWeight: 600, letterSpacing: "0.04em",
                      color: isDecisive ? step.color : "#55556a",
                    }}>{step.label}</span>
                    {isDecisive && (
                      <span style={{
                        fontSize: "0.58rem", padding: "1px 5px", borderRadius: "3px",
                        background: `${step.color}18`, color: step.color,
                        border: `1px solid ${step.color}40`,
                        fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                      }}>decisive</span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.73rem", color: "#55556a", marginBottom: "0.4rem", lineHeight: 1.55 }}>{step.desc}</div>
                  <div style={{
                    background: "#111116", borderRadius: "4px",
                    padding: "0.5rem 0.75rem",
                    fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.71rem",
                    lineHeight: 1.9,
                  }}>
                    <div style={{ color: isDecisive ? "#c0c0d8" : "#55556a" }}>{step.formula}</div>
                    <div style={{ color: isDecisive ? step.color : "#3a3a4a" }}>{step.result}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid #1e1e28" }}>
            <div style={{ fontSize: "0.65rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#3a3a4a", marginBottom: "0.6rem" }}>
              Interchange constants used in all calculations
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.35rem" }}>
              {[
                ["Debit interchange", "0.80%"],
                ["Credit interchange", "2.20%"],
                ["International uplift", "1.00%"],
                ["Network fees", "0.15%"],
                ["IC++ markup", "0.50%"],
                ["Flat rate", "2.90% + $0.30"],
                ["Blended rate", "2.50% + $0.25"],
              ].map(([k, v]) => (
                <div key={k} style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: "0.71rem", padding: "0.28rem 0.5rem",
                  background: "#111116", borderRadius: "4px",
                }}>
                  <span style={{ color: "#55556a" }}>{k}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#9090a8" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── COMPETITIVE BENCHMARK ─────────────────────────────────────────────────────

function CompetitiveBenchmark({ inputs, rec }) {
  const [selectedModel, setSelectedModel] = useState(rec);
  const ic = computeBlendedCost(inputs);

  const stripeCost = computeStripeMerchantCost(selectedModel, inputs);

  const compRows = COMPETITORS.map(comp => {
    const merchantCost = computeMerchantCost(comp, inputs, ic);
    const savings = merchantCost - stripeCost;
    const savingsPct = merchantCost > 0 ? savings / merchantCost : 0;
    return { ...comp, merchantCost, savings, savingsPct };
  });

  const stripeEffectiveRate = stripeCost / inputs.monthlyVolume;
  const allCosts = [stripeCost, ...compRows.map(r => r.merchantCost)];
  const maxCost = Math.max(...allCosts);

  const stripeRateDisplay = selectedModel === "Flat" ? "2.90% + $0.30/tx"
    : selectedModel === "IC++" ? "Interchange + 0.50% markup"
    : "2.50% + $0.25/tx";

  const ColHeader = ({ children }) => (
    <th style={{
      fontSize: "0.64rem", fontWeight: 500, letterSpacing: "0.07em",
      textTransform: "uppercase", color: "#55556a", textAlign: "left",
      padding: "0 0.75rem 0.6rem", borderBottom: "1px solid #1e1e28",
      whiteSpace: "nowrap",
    }}>{children}</th>
  );

  const prevRec = useRef(rec);
  useEffect(() => {
    if (rec !== prevRec.current) {
      setSelectedModel(rec);
      prevRec.current = rec;
    }
  }, [rec]);

  return (
    <Panel>
      <SectionHeader label="Competitive Benchmark" right="merchant all-in cost · published 2025 rates" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1.1rem", flexWrap: "wrap" }}>
        <div style={{ fontSize: "0.74rem", color: "#55556a", lineHeight: 1.65, maxWidth: "480px" }}>
          What this merchant pays all-in under each processor — interchange cost is identical across all rows since card mix is the same. Only the pricing model differs.
        </div>
        <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
          {["Flat", "IC++", "Blended"].map(m => (
            <button
              key={m}
              onClick={() => setSelectedModel(m)}
              style={{
                padding: "0.3rem 0.7rem", borderRadius: "5px", fontSize: "0.72rem",
                fontWeight: 500, border: "1px solid",
                borderColor: selectedModel === m ? MODEL_META[m].color + "60" : "#2a2a34",
                background: selectedModel === m ? MODEL_META[m].color + "14" : "transparent",
                color: selectedModel === m ? MODEL_META[m].color : "#55556a",
                transition: "all 0.15s", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "5px",
              }}
            >
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: selectedModel === m ? MODEL_META[m].color : "#3a3a4a" }} />
              {MODEL_META[m].label}
              {m === rec && <span style={{ fontSize: "0.58rem", opacity: 0.7 }}>★</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              <ColHeader>Processor</ColHeader>
              <ColHeader>Pricing model</ColHeader>
              <ColHeader>Rate structure</ColHeader>
              <ColHeader>Merchant pays/mo</ColHeader>
              <ColHeader>Effective rate</ColHeader>
              <ColHeader>vs. Stripe</ColHeader>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: "rgba(79,142,247,0.04)" }}>
              <td style={{ padding: "0.85rem 0.75rem", borderBottom: "1px solid #1a1a22" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: MODEL_META[selectedModel].color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: "#f0f0f4" }}>Stripe</span>
                  {selectedModel === rec && (
                    <span style={{
                      fontSize: "0.58rem", background: "rgba(79,142,247,0.12)", color: "#4f8ef7",
                      border: "1px solid rgba(79,142,247,0.25)", padding: "1px 5px",
                      borderRadius: "3px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
                    }}>recommended</span>
                  )}
                </div>
              </td>
              <td style={{ padding: "0.85rem 0.75rem", borderBottom: "1px solid #1a1a22", color: MODEL_META[selectedModel].color, fontWeight: 500 }}>
                {MODEL_META[selectedModel].label}
              </td>
              <td style={{ padding: "0.85rem 0.75rem", borderBottom: "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.71rem", color: "#55556a" }}>
                {stripeRateDisplay}
              </td>
              <td style={{ padding: "0.85rem 0.75rem", borderBottom: "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, color: "#f0f0f4" }}>
                <div>{fmt$(stripeCost)}</div>
                <div style={{ width: "80px", height: "2px", background: "#1e1e2a", borderRadius: "2px", marginTop: "5px" }}>
                  <div style={{ width: `${maxCost > 0 ? (stripeCost / maxCost) * 100 : 0}%`, height: "100%", background: MODEL_META[selectedModel].color, borderRadius: "2px" }} />
                </div>
              </td>
              <td style={{ padding: "0.85rem 0.75rem", borderBottom: "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", color: "#9090a8" }}>
                {fmtPct(stripeEffectiveRate)}
              </td>
              <td style={{ padding: "0.85rem 0.75rem", borderBottom: "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", color: "#55556a", fontSize: "0.72rem" }}>
                —
              </td>
            </tr>

            {compRows.map((comp, i) => {
              const merchantSaves = comp.savings > 0;
              const isLast = i === compRows.length - 1;
              const barW = maxCost > 0 ? (comp.merchantCost / maxCost) * 100 : 0;
              return (
                <tr key={comp.name}>
                  <td style={{ padding: "0.85rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22" }}>
                    <div style={{ fontWeight: 500, color: "#f0f0f4" }}>{comp.name}</div>
                    <div style={{ fontSize: "0.66rem", color: "#3a3a4a", marginTop: "2px" }}>{comp.note}</div>
                  </td>
                  <td style={{ padding: "0.85rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22", color: "#9090a8" }}>
                    {comp.pricingModel}
                  </td>
                  <td style={{ padding: "0.85rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.71rem", color: "#55556a" }}>
                    {comp.rateDisplay}
                  </td>
                  <td style={{ padding: "0.85rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", color: "#9090a8" }}>
                    <div>{fmt$(comp.merchantCost)}</div>
                    <div style={{ width: "80px", height: "2px", background: "#1e1e2a", borderRadius: "2px", marginTop: "5px" }}>
                      <div style={{ width: `${barW}%`, height: "100%", background: "#2a2a3a", borderRadius: "2px" }} />
                    </div>
                  </td>
                  <td style={{ padding: "0.85rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", color: "#9090a8" }}>
                    {fmtPct(comp.merchantCost / inputs.monthlyVolume)}
                  </td>
                  <td style={{ padding: "0.85rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" }}>
                    {merchantSaves ? (
                      <span style={{ color: "#34c98a" }}>−{fmt$(comp.savings)}</span>
                    ) : (
                      <span style={{ color: "#f25f5c" }}>+{fmt$(Math.abs(comp.savings))}</span>
                    )}
                    <div style={{ fontSize: "0.67rem", color: merchantSaves ? "#34c98a" : "#f25f5c", opacity: 0.7, marginTop: "1px" }}>
                      {merchantSaves ? "cheaper w/ Stripe" : "pricier w/ Stripe"}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: "0.85rem", paddingTop: "0.75rem", borderTop: "1px solid #1a1a22", fontSize: "0.67rem", color: "#3a3a4a", lineHeight: 1.6 }}>
        ★ = engine recommendation. All-in cost includes interchange pass-through for IC++ processors. Published rates as of 2025; enterprise and negotiated pricing will differ.
      </div>
    </Panel>
  );
}
// ── ABOUT THIS MODEL ──────────────────────────────────────────────────────────
// Paste this component anywhere after the MethodologyPanel component definition
// and before the main App() export.

function AboutThisModel() {
  const [open, setOpen] = useState(false);

  const Section = ({ title, items }) => (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{
        fontSize: "0.67rem", fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "#55556a", marginBottom: "0.6rem",
      }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
            <span style={{
              width: "5px", height: "5px", borderRadius: "50%",
              background: "#2a2a3a", flexShrink: 0, marginTop: "7px",
            }} />
            <span style={{ fontSize: "0.78rem", lineHeight: 1.65, color: "#9090a8" }}>
              {item.label
                ? <><span style={{ color: "#c0c0d8", fontWeight: 500 }}>{item.label}: </span>{item.text}</>
                : item
              }
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Panel>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", background: "none", border: "none", padding: 0,
          cursor: "pointer",
        }}
      >
        <div style={{
          fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "#55556a",
          paddingBottom: "0.75rem", borderBottom: "1px solid #1e1e28",
          width: "100%", textAlign: "left", display: "flex",
          justifyContent: "space-between", alignItems: "center",
        }}>
          <span>About This Model</span>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.75rem",
            color: "#3a3a4a",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s", marginLeft: "8px", display: "inline-block",
          }}>▾</span>
        </div>
      </button>

      {!open && (
        <div style={{ fontSize: "0.78rem", color: "#55556a", lineHeight: 1.65, marginTop: "0.85rem" }}>
          A simplified illustration of a merchant-profile-aware pricing engine. Intentional assumptions and known limitations documented here.{" "}
          <span
            onClick={() => setOpen(true)}
            style={{ color: "#4f8ef7", cursor: "pointer", textDecoration: "underline" }}
          >Show details →</span>
        </div>
      )}

      {open && (
        <div style={{ marginTop: "1.1rem" }}>

          <Section title="How costs are calculated" items={[
            { label: "Interchange", text: "Two rates only — 0.80% for debit, 2.20% for credit. Real interchange has hundreds of categories by card type, MCC, rewards tier, and card-present vs. not-present." },
            { label: "Network fees", text: "A flat 0.15% is added to every transaction regardless of card type. In practice these vary by network (Visa vs. Mastercard), transaction type, and volume tier." },
            { label: "International uplift", text: "A flat 1.0% applied to cross-border volume. No distinction between regions, card networks, or currency corridors." },
            { label: "IC++ margin", text: "Modeled as volume × 0.5% markup only. Stripe's margin on IC++ is always exactly the markup — interchange passes through to the networks in full." },
          ]} />

          <Section title="Pricing model assumptions" items={[
            { label: "Flat Rate & Blended fixed fees", text: "Applied uniformly per transaction ($0.30 and $0.25 respectively). No minimum transaction size, volume discounts, or tiered fee structures." },
            { label: "IC++ fixed fee", text: "Not modeled. Real IC++ pricing often includes a small per-transaction fee in addition to the markup percentage." },
            { label: "Recommendation logic", text: "Three rules: IC++ if volume > $1M and credit mix < 60%; Flat Rate if avg transaction < $20; Blended otherwise. No MCC awareness, risk scoring, or account history." },
          ]} />

          <Section title="Competitive benchmark assumptions" items={[
            { label: "Rates", text: "Published 2025 standard rates — not negotiated or enterprise pricing. Adyen and Checkout.com rates in particular are lower at volume commitments." },
            { label: "Interchange cost", text: "Identical across all processors in the table — same card mix means same interchange cost regardless of who is processing. Only the pricing model markup differs." },
            { label: "Fees excluded", text: "Monthly platform fees, setup fees, and chargeback fees are not included. Stripe, Adyen, and others charge these at enterprise scale." },
          ]} />

          <Section title="What this model does not include" items={[
            "Chargebacks and dispute fees",
            "Monthly or annual platform fees",
            "Card-present vs. card-not-present rate differences",
            "Premium card surcharges (Amex, Visa Infinite, high-tier rewards cards)",
            "Volume-based interchange discounts",
            "Currency conversion fees (separate from international uplift)",
            "MCC-specific interchange categories (airlines, grocery, utilities, etc.)",
          ]} />

          <div style={{
            marginTop: "1rem", paddingTop: "0.85rem",
            borderTop: "1px solid #1e1e28",
            fontSize: "0.72rem", color: "#3a3a4a", lineHeight: 1.65,
          }}>
            This engine is a simplified illustration of a rules-based pricing architecture — not a representation of how Stripe or any processor actually prices. Real systems use granular interchange tables, MCC-level logic, and merchant risk profiles. The value is in the decision framework, not the specific rates.
          </div>

        </div>
      )}
    </Panel>
  );
}


// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function App() {
  const [inputs, setInputs] = useState(PRESETS["SaaS"]);
  const [activePreset, setActivePreset] = useState("SaaS");
  const [showChart, setShowChart] = useState(false);
  const [exported, setExported] = useState(false);

  const set = (key) => (val) => { setInputs(p => ({ ...p, [key]: val })); setActivePreset(null); };

  const bc = computeBlendedCost(inputs);
  const results = {
    "Flat":    computeMargin(flatRevenue(inputs),    inputs.monthlyVolume, bc),
    "IC++":    computeMargin(icppRevenue(inputs),    inputs.monthlyVolume, bc),
    "Blended": computeMargin(blendedRevenue(inputs), inputs.monthlyVolume, bc),
  };
  const rec = recommendModel(inputs);
  const insights = generateInsights(inputs, results, bc);
  const maxMargin = Math.max(...Object.values(results).map(r => Math.max(r.margin, 0)));

  const handleExport = () => {
    exportResults(inputs, results, rec);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  const ActionBtn = ({ label, onClick, active }) => (
    <button onClick={onClick} style={{
      padding: "0.45rem 0.85rem", borderRadius: "6px",
      fontSize: "0.75rem", fontWeight: 500,
      border: active ? "1px solid rgba(79,142,247,0.35)" : "1px solid #2a2a34",
      background: active ? "rgba(79,142,247,0.1)" : "#16161a",
      color: active ? "#4f8ef7" : "#9090a8",
      transition: "all 0.15s",
    }}>{label}</button>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d10; color: #f0f0f4; font-family: 'Geist', -apple-system, sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
        input[type=range] { appearance: none; -webkit-appearance: none; }
        button { cursor: pointer; font-family: inherit; }
      `}</style>

      <div style={{ minHeight: "100vh", padding: "2rem 1.5rem", maxWidth: "1200px", margin: "0 auto" }}>

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "2rem", paddingBottom: "1.5rem", borderBottom: "1px solid #1a1a22", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#55556a", marginBottom: "0.35rem" }}>Pricing Intelligence</div>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: "1.5rem", fontStyle: "italic", color: "#f0f0f4", letterSpacing: "-0.01em" }}>Card Processing Economics</div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
            <ActionBtn label={showChart ? "Hide Chart" : "Sensitivity Chart"} onClick={() => setShowChart(v => !v)} active={showChart} />
            <ActionBtn label={exported ? "Exported ✓" : "Export Results"} onClick={handleExport} active={exported} />
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

        {/* TWO-COLUMN LAYOUT */}
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.25rem", alignItems: "start" }}>

          {/* LEFT — inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <Panel>
              <SectionHeader label="Merchant Profile" />
              <NumberInput label="Monthly Volume" value={inputs.monthlyVolume} onChange={set("monthlyVolume")} tooltip={TOOLTIPS.monthlyVolume} />
              <NumberInput label="Avg Transaction" value={inputs.avgTransaction} onChange={set("avgTransaction")} tooltip={TOOLTIPS.avgTransaction} />
              <SliderInput label="Credit Card Mix" value={inputs.pctCredit} min={0} max={1} step={0.01} onChange={set("pctCredit")} format={v => `${Math.round(v * 100)}% credit`} tooltip={TOOLTIPS.pctCredit} sublabel={`${Math.round(inputs.pctCredit * 100)}% credit · ${Math.round((1 - inputs.pctCredit) * 100)}% debit`} />
              <SliderInput label="International Mix" value={inputs.pctInternational} min={0} max={0.5} step={0.01} onChange={set("pctInternational")} format={v => fmtPct(v)} tooltip={TOOLTIPS.pctInternational} />
            </Panel>

            <Panel>
              <SectionHeader label="Cost Summary" />
              {[
                ["Blended Cost Rate", <AnimatedNumber value={bc} format={fmtPct} />],
                ["Monthly Cost",      <AnimatedNumber value={inputs.monthlyVolume * bc} format={fmt$} />],
                ["Transactions / Mo", Math.round(inputs.monthlyVolume / inputs.avgTransaction).toLocaleString()],
                ["Debit Interchange", fmtPct(COSTS.debitInterchange)],
                ["Credit Interchange",fmtPct(COSTS.creditInterchange)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid #1a1a22", fontSize: "0.78rem" }}>
                  <span style={{ color: "#9090a8" }}>{k}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, color: "#f0f0f4" }}>{v}</span>
                </div>
              ))}
            </Panel>
          </div>

          {/* RIGHT — outputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {/* RECOMMENDATION */}
            <Panel>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                <div>
                  <div style={{ fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#55556a", marginBottom: "0.3rem" }}>Recommended Model</div>
                  <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: "1.75rem", fontStyle: "italic", color: "#f0f0f4", letterSpacing: "-0.01em" }}>{MODEL_META[rec].label}</div>
                  <div style={{ fontSize: "0.72rem", color: "#55556a", marginTop: "0.2rem" }}>{MODEL_META[rec].desc}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "1.5rem", fontWeight: 500, color: "#f0f0f4" }}>
                    <AnimatedNumber value={results[rec].marginPct} format={fmtPct} />
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "#55556a", marginBottom: "0.2rem" }}>margin rate</div>
                  {/* FIX 2: Dynamic color on margin — green if positive, red if negative */}
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.85rem", color: results[rec].margin >= 0 ? "#34c98a" : "#f25f5c" }}>
                    <AnimatedNumber value={results[rec].margin} format={fmt$} /> /mo
                  </div>
                </div>
              </div>
            </Panel>

            {/* MODEL COMPARISON TABLE */}
            <Panel>
              <SectionHeader label="Model Comparison" />
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Model", "Revenue", "Cost", "Margin", "Margin %"].map(h => (
                      <th key={h} style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.07em", textTransform: "uppercase", color: "#55556a", textAlign: "left", padding: "0 0.75rem 0.6rem", borderBottom: "1px solid #1e1e28" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {["Flat", "IC++", "Blended"].map((model, idx) => {
                    const r = results[model];
                    const isRec = model === rec;
                    const isPos = r.margin >= 0;
                    const barW = maxMargin > 0 ? Math.max(0, r.margin / maxMargin) * 100 : 0;
                    const isLast = idx === 2;
                    return (
                      <tr key={model} style={{ background: isRec ? "rgba(255,255,255,0.02)" : "transparent" }}>
                        <td style={{ padding: "0.9rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: MODEL_META[model].color, flexShrink: 0 }} />
                            <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "#f0f0f4" }}>{MODEL_META[model].label}</span>
                            {isRec && <span style={{ fontSize: "0.6rem", background: "rgba(79,142,247,0.1)", color: "#4f8ef7", border: "1px solid rgba(79,142,247,0.25)", padding: "2px 6px", borderRadius: "3px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Rec</span>}
                          </div>
                        </td>
                        {[fmt$(r.revenue), fmt$(r.cost)].map((val, i) => (
                          <td key={i} style={{ padding: "0.9rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", color: "#9090a8" }}>{val}</td>
                        ))}
                        <td style={{ padding: "0.9rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", color: isPos ? "#34c98a" : "#f25f5c" }}>
                          <div><AnimatedNumber value={r.margin} format={fmt$} /></div>
                          <div style={{ width: "100%", height: "2px", background: "#1e1e2a", borderRadius: "2px", marginTop: "5px" }}>
                            <div style={{ width: `${barW}%`, height: "100%", background: MODEL_META[model].color, borderRadius: "2px", transition: "width 0.4s ease" }} />
                          </div>
                        </td>
                        <td style={{ padding: "0.9rem 0.75rem", borderBottom: isLast ? "none" : "1px solid #1a1a22", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", color: isPos ? "#34c98a" : "#f25f5c" }}>
                          <AnimatedNumber value={r.marginPct} format={fmtPct} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>

            {/* SENSITIVITY CHART */}
            {showChart && (
              <Panel>
                <SectionHeader label="Sensitivity Analysis — Margin % vs Credit Mix" />
                <SensitivityChart inputs={inputs} />
              </Panel>
            )}

            {/* METHODOLOGY EXPLAINER */}
            <MethodologyPanel inputs={inputs} results={results} rec={rec} />

            {/* COMPETITIVE BENCHMARK */}
            <CompetitiveBenchmark inputs={inputs} rec={rec} />

            {/* ENRICHED INSIGHTS */}
            <Panel>
              <SectionHeader label="Analysis" right={`${insights.length} insight${insights.length !== 1 ? "s" : ""}`} />
              {insights.map((ins, i) => (
                <div key={i} style={{
                  display: "flex", gap: "0.75rem", alignItems: "flex-start",
                  padding: "0.75rem 0",
                  borderBottom: i < insights.length - 1 ? "1px solid #1a1a22" : "none",
                }}>
                  <span style={{
                    fontSize: "0.59rem", fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace",
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    background: "#1e1e28", color: "#55556a",
                    padding: "2px 6px", borderRadius: "3px",
                    flexShrink: 0, marginTop: "2px", whiteSpace: "nowrap",
                  }}>{ins.tag}</span>
                  <span style={{ fontSize: "0.8rem", lineHeight: 1.65, color: "#9090a8" }}>{ins.text}</span>
                </div>
              ))}
            </Panel>

{/* ABOUT THIS MODEL */}
            <AboutThisModel />

          </div>
        </div>
      </div>
    </>
  );
}
