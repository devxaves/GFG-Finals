"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { BackgroundElements } from "@/components/background-elements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Calendar, 
  ExternalLink, 
  FileCheck2, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Filter,
  Sparkles,
  ArrowRight,
  Loader2
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";

interface HistoryItem {
  id: string;
  title: string;
  overallScore: number;
  claimCount: number;
  verdictBreakdown: Record<string, number>;
  completedAt: string;
}

type FilterType = "all" | "high_risk" | "verified" | "recent";

function getScoreColor(score: number) {
  if (score > 75) return "bg-emerald-500 text-white";
  if (score > 40) return "bg-amber-500 text-white";
  return "bg-rose-500 text-white";
}

function getScoreBorderColor(score: number) {
  if (score > 75) return "border-emerald-500/30 hover:border-emerald-500/50";
  if (score > 40) return "border-amber-500/30 hover:border-amber-500/50";
  return "border-rose-500/30 hover:border-rose-500/50";
}

function formatDate(dateString: string) {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function HistoryPage() {
  const { userId, isLoaded } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return; // Wait for clerk
    
    async function fetchHistory() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";
        const endpoint = userId 
          ? `${apiUrl}/api/fact-check/history?user_id=${userId}`
          : `${apiUrl}/api/fact-check/history`;
          
        const res = await fetch(endpoint);
        const data = await res.json();
        if (data.history) {
          setHistory(data.history);
        }
      } catch (e) {
        console.error("Failed to fetch history:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [userId, isLoaded]);

  const filters: { id: FilterType; label: string; icon: any }[] = [
    { id: "all", label: "All", icon: Filter },
    { id: "high_risk", label: "High Risk", icon: AlertTriangle },
    { id: "verified", label: "Verified", icon: CheckCircle2 },
    { id: "recent", label: "Recent", icon: Clock },
  ];

  const filteredHistory = history.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
    
    switch (activeFilter) {
      case "high_risk": return matchesSearch && item.overallScore < 40;
      case "verified": return matchesSearch && item.overallScore > 75;
      case "recent": return matchesSearch; // Already sorted by date
      default: return matchesSearch;
    }
  });

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden relative">
      <BackgroundElements />
      <Navbar />

      <div className="relative z-10 max-w-5xl mx-auto pt-32 pb-24 px-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600 animate-gradient mb-3">
            Fact-Check History
          </h1>
          <p className="text-lg text-muted-foreground">
            Revisit your previously analyzed articles and claims.
          </p>
        </motion.div>

        {/* Search + Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8 space-y-4"
        >
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search by title or source..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-14 pl-12 bg-card/40 backdrop-blur-xl border-border focus-visible:ring-primary text-lg rounded-2xl text-foreground placeholder:text-muted-foreground"
            />
          </div>
          
          <div className="flex gap-2 flex-wrap">
            {filters.map((filter) => {
              const Icon = filter.icon;
              const isActive = activeFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    isActive
                      ? "bg-gradient-to-r from-primary to-purple-600 text-primary-foreground shadow-[0_0_15px_rgba(147,51,234,0.3)]"
                      : "bg-card/40 text-muted-foreground border border-border hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {filter.label}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Results */}
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {filteredHistory.map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
                layout
              >
                <Link href={`/fact-check/report/${item.id}`}>
                  <div className={`group bg-card/40 backdrop-blur-xl border rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer hover:-translate-y-1 ${getScoreBorderColor(item.overallScore)}`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <Badge variant="outline" className="text-xs border-border text-muted-foreground font-medium">
                            {item.id.slice(0, 12)}...
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(item.completedAt)}
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors truncate">
                          {item.title}
                        </h3>
                        <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <FileCheck2 className="w-4 h-4" />
                            {item.claimCount} claims verified
                          </span>
                          {Object.entries(item.verdictBreakdown).map(([verdict, count]) => (
                            <span key={verdict} className="text-xs">
                              {verdict.replace("_", " ")}: <strong className="text-foreground/80">{count}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-lg ${getScoreColor(item.overallScore)}`}>
                          {item.overallScore}%
                        </div>
                        <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {filteredHistory.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20"
            >
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">No results found</h3>
              <p className="text-muted-foreground mb-6">Try adjusting your search or filters.</p>
              <Link href="/fact-check">
                <Button className="bg-gradient-to-r from-primary to-purple-600 text-primary-foreground rounded-full px-6">
                  Start a New Analysis <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
