"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer
} from "recharts";
import {
  Shield, AlertTriangle, ShieldAlert, HelpCircle, Info,
  RotateCcw, Download, Share2, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";

const VERDICT_CONFIG = {
  LIKELY_DEEPFAKE: {
    color: "text-red-500", border: "border-red-500/30", bg: "bg-red-500/10",
    chartColor: "#ef4444", Icon: ShieldAlert,
    label: "Likely Deepfake",
    note: "High probability of synthetic generation detected across multiple frames. Cross-reference with verified sources before sharing.",
  },
  SUSPICIOUS: {
    color: "text-amber-500", border: "border-amber-500/30", bg: "bg-amber-500/10",
    chartColor: "#f59e0b", Icon: AlertTriangle,
    label: "Suspicious",
    note: "Several frames show elevated AI-generation scores. Exercise caution and seek corroborating sources.",
  },
  INCONCLUSIVE: {
    color: "text-blue-400", border: "border-blue-400/30", bg: "bg-blue-400/10",
    chartColor: "#60a5fa", Icon: HelpCircle,
    label: "Inconclusive",
    note: "Anomalies detected but results are not definitive. Video quality or compression may be affecting results.",
  },
  LIKELY_AUTHENTIC: {
    color: "text-green-500", border: "border-green-500/30", bg: "bg-green-500/10",
    chartColor: "#22c55e", Icon: Shield,
    label: "Likely Authentic",
    note: "Low indicators of AI generation detected. Always verify context and source independently.",
  },
  ERROR: {
    color: "text-foreground/50", border: "border-border", bg: "bg-card/30",
    chartColor: "#6b7280", Icon: AlertCircle,
    label: "Error",
    note: "Analysis could not be completed.",
  },
};

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-foreground/50 mb-0.5">t = {d.timestamp_sec}s</p>
      <p className="font-bold text-foreground">{d.ai_probability}% AI probability</p>
    </div>
  );
}

function StatCard({ label, value, sub, colorClass = "text-foreground" }) {
  return (
    <div className="bg-background/60 border border-border rounded-2xl p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-foreground/40 mb-2">{label}</p>
      <p className={`text-3xl font-extrabold ${colorClass} leading-none`}>{value}</p>
      {sub && <p className="text-xs text-foreground/40 mt-1.5">{sub}</p>}
    </div>
  );
}

export default function VideoForensicsReport({ report, onReset }) {
  const [copied, setCopied] = useState(false);
  const cfg = VERDICT_CONFIG[report.verdict] || VERDICT_CONFIG.ERROR;
  const VerdictIcon = cfg.Icon;

  const hasTimeline = report.frame_timeline?.length > 0;

  const handleShare = async () => {
    const url = `${window.location.origin}/media-check?job=${encodeURIComponent(report.job_id)}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">

      {/* ── Verdict Hero ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`${cfg.bg} ${cfg.border} border rounded-2xl p-8 text-center`}
      >
        <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full ${cfg.bg} ${cfg.border} border mb-4`}>
          <VerdictIcon className={`w-8 h-8 ${cfg.color}`} />
        </div>
        <h2 className={`text-2xl font-extrabold ${cfg.color} mb-1`}>{cfg.label}</h2>
        <p className="text-xs font-bold uppercase tracking-widest text-foreground/40 mb-4">
          {report.risk_level} RISK · {report.filename}
        </p>
        <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border ${cfg.border} ${cfg.bg}`}>
          <span className={`text-2xl font-extrabold ${cfg.color}`}>{report.avg_ai_probability}%</span>
          <span className="text-xs text-foreground/50 uppercase tracking-wider">avg ai probability</span>
        </div>
      </motion.div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Avg AI Prob" value={`${report.avg_ai_probability}%`} colorClass={cfg.color} />
        <StatCard label="Peak AI Prob" value={`${report.max_ai_probability}%`} sub="highest frame" />
        <StatCard
          label="Suspicious Frames"
          value={`${report.suspicious_frame_count}/${report.total_frame_count}`}
          sub="above 1% threshold"
          colorClass={report.suspicious_frame_count > 0 ? "text-amber-500" : "text-green-500"}
        />
        <StatCard label="Suspicious %" value={`${report.suspicious_frame_percentage}%`} sub="of timeline" />
      </div>

      {/* ── Recharts Timeline ── */}
      {hasTimeline && (
        <div className="bg-background/60 border border-border rounded-2xl p-5">
          <p className="text-sm font-bold text-foreground mb-4">AI Detection Probability — Frame Timeline</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={report.frame_timeline} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={cfg.chartColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={cfg.chartColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="timestamp_sec" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 3"
                label={{ value: "1% threshold", position: "insideTopRight", fill: "#ef4444", fontSize: 10 }} />
              <Area type="monotone" dataKey="ai_probability" stroke={cfg.chartColor} strokeWidth={2} fill="url(#areaGrad)"
                dot={(props) => {
                  if (props.payload.ai_probability > 1) {
                    return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill="#ef4444" />;
                  }
                  return null;
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Interpretation ── */}
      <div className="bg-background/40 border border-border/50 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Info className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold text-foreground">What does this mean?</span>
        </div>
        <p className="text-sm text-foreground/60 leading-relaxed">{cfg.note}</p>
        <p className="text-xs text-foreground/30 mt-3 pt-3 border-t border-border/30">
          ⚠️ Powered by Hive Moderation API. Results should be combined with human review. No AI detection is 100% accurate.
        </p>
      </div>

      {/* ── Actions ── */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={onReset} className="rounded-full">
          <RotateCcw className="w-4 h-4 mr-2" /> Analyze Another
        </Button>
        <Button variant="outline" onClick={() => window.print()} className="rounded-full">
          <Download className="w-4 h-4 mr-2" /> Download PDF
        </Button>
        <Button onClick={handleShare} className="rounded-full bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-primary-foreground">
          <Share2 className="w-4 h-4 mr-2" /> {copied ? "Link Copied!" : "Share Report"}
        </Button>
      </div>

    </div>
  );
}
