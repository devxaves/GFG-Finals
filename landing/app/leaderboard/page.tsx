"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { BackgroundElements } from "@/components/background-elements";
import { 
  Trophy, 
  TrendingUp, 
  ShieldAlert, 
  CheckCircle2, 
  Eye,
  AlertTriangle,
  ArrowRight,
  Loader2
} from "lucide-react";
import Link from "next/link";

interface LeaderboardItem {
  rank: number;
  article_title: string;
  article_url: string;
  overall_score: number;
  verdict: string;
  scan_count: number;
  worst_claim: string;
  job_id: string;
  domain: string;
}

interface LeaderboardData {
  leaderboard: LeaderboardItem[];
  total_articles_scanned: number;
  total_claims_verified: number;
  timeframe: string;
}

export default function LeaderboardPage() {
  const [timeframe, setTimeframe] = useState<"week" | "month" | "all">("week");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      setLoading(true);
      try {
        const apiUrl = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";
        const res = await fetch(`${apiUrl}/api/leaderboard?timeframe=${timeframe}`);
        const json = await res.json();
        if (json.leaderboard) {
          setData(json);
        }
      } catch (e) {
        console.error("Failed to fetch leaderboard:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, [timeframe]);

  const getVerdictColor = (verdict: string) => {
    switch (verdict) {
      case "FALSE": return "bg-rose-100 text-rose-700 border-rose-200";
      case "MISLEADING": return "bg-amber-100 text-amber-700 border-amber-200";
      case "UNVERIFIABLE": return "bg-slate-100 text-slate-700 border-slate-200";
      default: return "bg-emerald-100 text-emerald-700 border-emerald-200";
    }
  };

  const getScoreColor = (score: number) => {
    if (score < 40) return "text-rose-600";
    if (score < 75) return "text-amber-600";
    return "text-emerald-600";
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden relative selection:bg-purple-500/30 font-sans">
      <BackgroundElements />
      <Navbar />

      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 pt-32 pb-24">
        {/* Header Section */}
        <div className="text-center mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 style={{ fontFamily: 'Syne, sans-serif' }} className="text-5xl md:text-6xl font-extrabold tracking-tight mb-4 text-foreground">
              MISINFORMATION RADAR
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              The most misleading content analyzed {timeframe === 'week' ? 'this week' : timeframe === 'month' ? 'this month' : 'of all time'}, ranked by credibility score.
            </p>
          </motion.div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {[
            { label: "Total Articles Scanned", value: data?.total_articles_scanned || 0, icon: ShieldAlert, color: "text-purple-600" },
            { label: "Total Claims Verified", value: data?.total_claims_verified || 0, icon: CheckCircle2, color: "text-blue-600" },
            { label: "Lowest Score", value: `${data?.leaderboard?.[0]?.overall_score || 0}%`, icon: AlertTriangle, color: "text-rose-600" }
          ].map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className="bg-card/60 backdrop-blur-xl border border-border rounded-2xl p-6 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow"
            >
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">{stat.label}</p>
                <div className="text-3xl font-bold font-mono">
                  {loading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : stat.value}
                </div>
              </div>
              <div className={`p-4 rounded-xl bg-muted/50 ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Timeframe Toggles */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex bg-muted/50 backdrop-blur-md p-1.5 rounded-full border border-border/50 shadow-sm">
            {(["week", "month", "all"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTimeframe(t)}
                className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${
                  timeframe === t 
                    ? "bg-white text-purple-700 shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-white/50"
                }`}
              >
                {t === "week" ? "This Week" : t === "month" ? "This Month" : "All Time"}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div 
              key="loader"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex justify-center py-20"
            >
              <Loader2 className="w-10 h-10 animate-spin text-purple-600" />
            </motion.div>
          ) : data?.leaderboard && data.leaderboard.length > 0 ? (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Top 3 Featured Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* #1 RANK */}
                {data.leaderboard[0] && (
                  <Link href={`/fact-check/report/${data.leaderboard[0].job_id}`} className="block lg:col-span-2 hover:-translate-y-1 transition-transform">
                    <div className="relative bg-white border border-rose-200 rounded-3xl p-8 shadow-[0_0_40px_rgba(225,29,72,0.1)] overflow-hidden group">
                      <div className="absolute top-0 left-0 w-2 h-full bg-rose-500 rounded-l-3xl"></div>
                      <div className="absolute top-4 right-8 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Trophy className="w-48 h-48 text-rose-500" />
                      </div>
                      
                      <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start md:items-center">
                        <div className="flex-shrink-0 relative">
                          <svg className="w-32 h-32 transform -rotate-90">
                            <circle className="text-rose-100" strokeWidth="8" stroke="currentColor" fill="transparent" r="58" cx="64" cy="64" />
                            <circle className="text-rose-500 transition-all duration-1000 ease-out" strokeWidth="8" strokeDasharray={364} strokeDashoffset={364 - (364 * data.leaderboard[0].overall_score) / 100} strokeLinecap="round" stroke="currentColor" fill="transparent" r="58" cx="64" cy="64" />
                          </svg>
                          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                            <span className="text-3xl font-black text-rose-600">{data.leaderboard[0].overall_score}%</span>
                          </div>
                          <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 whitespace-nowrap bg-rose-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg">
                            #1 MOST MISLEADING
                          </div>
                        </div>

                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            {data.leaderboard[0].domain && (
                              <img src={`https://www.google.com/s2/favicons?domain=${data.leaderboard[0].domain}&sz=32`} className="w-5 h-5 rounded" alt="" />
                            )}
                            <span className="text-sm font-semibold text-muted-foreground">{data.leaderboard[0].domain || "Unknown Source"}</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${getVerdictColor(data.leaderboard[0].verdict)}`}>
                              {data.leaderboard[0].verdict}
                            </span>
                          </div>
                          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4 line-clamp-2 leading-tight">
                            {data.leaderboard[0].article_title}
                          </h2>
                          <div className="bg-rose-50/50 border border-rose-100 p-4 rounded-xl mb-4">
                            <div className="text-xs font-bold text-rose-500 mb-1 flex items-center gap-1 uppercase tracking-wider"><AlertTriangle className="w-3 h-3"/> Worst Claim:</div>
                            <p className="text-sm font-mono text-rose-900 line-clamp-2">"{data.leaderboard[0].worst_claim}"</p>
                          </div>
                          <div className="flex items-center justify-between text-sm text-muted-foreground font-medium">
                            <span className="flex items-center gap-1.5 bg-muted/50 px-3 py-1.5 rounded-full"><Eye className="w-4 h-4"/> {data.leaderboard[0].scan_count} Scans</span>
                            <span className="flex items-center gap-1 text-purple-600 font-bold group-hover:underline">View Report <ArrowRight className="w-4 h-4" /></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                )}

                {/* #2 & #3 RANKS */}
                {data.leaderboard.slice(1, 3).map((item, idx) => (
                  <Link key={item.job_id} href={`/fact-check/report/${item.job_id}`} className="block hover:-translate-y-1 transition-transform">
                    <div className="bg-white border border-amber-200/60 rounded-3xl p-6 shadow-lg hover:shadow-[0_0_30px_rgba(245,158,11,0.1)] transition-shadow h-full flex flex-col group">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 font-black flex items-center justify-center border border-amber-200 shadow-sm">
                            #{item.rank}
                          </div>
                          {item.domain && <img src={`https://www.google.com/s2/favicons?domain=${item.domain}&sz=32`} className="w-5 h-5 rounded" alt="" />}
                          <span className="text-sm font-medium text-muted-foreground truncate max-w-[120px]">{item.domain}</span>
                        </div>
                        <div className={`text-xl font-black ${getScoreColor(item.overall_score)}`}>{item.overall_score}%</div>
                      </div>
                      <h3 className="text-lg font-bold mb-auto line-clamp-2 text-foreground group-hover:text-purple-600 transition-colors">
                        {item.article_title}
                      </h3>
                      <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full border ${getVerdictColor(item.verdict)}`}>
                            {item.verdict}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Eye className="w-3 h-3"/> {item.scan_count} scans</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Ranks 4-20 List */}
              <div className="bg-white border border-border rounded-3xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-6 py-4 font-semibold">Rank</th>
                        <th className="px-6 py-4 font-semibold">Source & Article</th>
                        <th className="px-6 py-4 font-semibold">Score</th>
                        <th className="px-6 py-4 font-semibold hidden md:table-cell">Verdict</th>
                        <th className="px-6 py-4 font-semibold hidden lg:table-cell">Worst Claim</th>
                        <th className="px-6 py-4 font-semibold text-right">Scans</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.leaderboard.slice(3).map((item) => (
                        <tr key={item.job_id} className="hover:bg-muted/30 transition-colors group cursor-pointer" onClick={() => window.location.href = `/fact-check/report/${item.job_id}`}>
                          <td className="px-6 py-4">
                            <span className="text-xl font-black text-muted-foreground/60">#{item.rank}</span>
                          </td>
                          <td className="px-6 py-4 max-w-[250px]">
                            <div className="flex items-center gap-2 mb-1">
                              {item.domain && <img src={`https://www.google.com/s2/favicons?domain=${item.domain}&sz=32`} className="w-4 h-4 rounded" alt="" />}
                              <span className="text-xs font-semibold text-muted-foreground truncate">{item.domain}</span>
                            </div>
                            <p className="font-bold text-sm text-foreground line-clamp-2 group-hover:text-purple-600 transition-colors">{item.article_title}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-lg font-black ${getScoreColor(item.overall_score)}`}>{item.overall_score}%</span>
                          </td>
                          <td className="px-6 py-4 hidden md:table-cell">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getVerdictColor(item.verdict)} whitespace-nowrap`}>
                              {item.verdict}
                            </span>
                          </td>
                          <td className="px-6 py-4 hidden lg:table-cell max-w-[300px]">
                            <p className="text-xs font-mono text-muted-foreground line-clamp-2 italic">"{item.worst_claim}"</p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-semibold bg-muted px-2.5 py-1 rounded-full">
                              <Eye className="w-3.5 h-3.5" /> {item.scan_count}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              No misinformation tracked for this timeframe.
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
