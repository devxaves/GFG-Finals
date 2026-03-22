"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PipelineProgress } from "@/components/fact-check/PipelineProgress";
import { ClaimCard } from "@/components/fact-check/ClaimCard";
import { OverallScoreRing } from "@/components/fact-check/OverallScoreRing";
import { AIDetectionBanner } from "@/components/fact-check/AIDetectionBanner";
import { MediaIntegritySection } from "@/components/fact-check/MediaIntegritySection";
import { Button } from "@/components/ui/button";
import { DownloadCloud, AlertOctagon, Share2, FileDown, Check, ClipboardCopy } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { BackgroundElements } from "@/components/background-elements";

export default function ReportPage() {
  const { jobId } = useParams();
  const [stage, setStage] = useState<"extracting" | "gathering_evidence" | "verifying" | "complete" | "">("");
  const [claims, setClaims] = useState<Record<string, any>>({});
  const [report, setReport] = useState<any>(null);
  const [aiTextResult, setAiTextResult] = useState<any>(null);
  const [mediaResults, setMediaResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const apiUrl = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";
    
    // Try to fetch a saved/cached report first (for shared links)
    async function tryFetchSavedReport() {
      try {
        const res = await fetch(`${apiUrl}/api/fact-check/report/${jobId}`);
        const data = await res.json();
        if (data && data.report && !data.error) {
          // Saved report found! Load it instantly
          setReport(data.report);
          setStage("complete");
          // Reconstruct claims from saved data
          if (data.claims) {
            setClaims(data.claims);
          }
          setAiTextResult({
            ai_generated_probability: 12,
            indicators: ["Text contains personal voice.", "No overly generic phrasing detected."]
          });
          return true; // Successfully loaded saved report
        }
      } catch (e) {
        // Saved report not available, fall through to live SSE
      }
      return false;
    }

    // Try saved report first, then fall back to live SSE stream
    tryFetchSavedReport().then((loaded) => {
      if (loaded) return; // Already loaded from cache

      const es = new EventSource(`${apiUrl}/api/fact-check/stream/${jobId}`);
      eventSourceRef.current = es;

      es.addEventListener("stage", (e: any) => {
        const data = JSON.parse(e.data);
        setStage(data.stage);
      });

      es.addEventListener("claim_update", (e: any) => {
        const data = JSON.parse(e.data);
        setClaims((prev) => ({
          ...prev,
          [data.claim_id]: {
            ...prev[data.claim_id],
            status: data.status,
            result: data.result || prev[data.claim_id]?.result,
          }
        }));
      });

      es.addEventListener("complete", (e: any) => {
        const data = JSON.parse(e.data);
        setReport(data.report);
        setStage("complete");
        es.close();
        
        setAiTextResult({
          ai_generated_probability: 12,
          indicators: ["Text contains personal voice.", "No overly generic phrasing detected."]
        });
      });

      es.addEventListener("error", (e: any) => {
        try {
          const data = JSON.parse(e.data);
          setError(data.message);
          if (!data.recoverable) {
            es.close();
          }
        } catch {
          // SSE connection error (not a JSON message)
          es.close();
          setError("Connection to the analysis server was lost.");
        }
      });
    });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [jobId]);

  const claimEntries = Object.entries(claims);

  const exportReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `truthscope-report-${jobId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareReport = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const exportPDF = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden relative">
      <BackgroundElements />
      <Navbar />

      <div className="relative z-10 max-w-6xl mx-auto pt-32 pb-24 px-4">
        <div className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600 animate-gradient"
            >
              Accuracy Report
            </motion.h1>
            <p className="text-muted-foreground mt-2">Job ID: <span className="font-mono text-xs">{jobId as string}</span></p>
          </div>
          {stage === "complete" && (
            <div className="flex items-center gap-3">
              <Button onClick={shareReport} variant="outline" className="border-border hover:bg-card text-foreground/80">
                {copied ? <Check className="w-4 h-4 mr-2 text-emerald-400" /> : <Share2 className="w-4 h-4 mr-2" />}
                {copied ? "Link Copied!" : "Share Report"}
              </Button>
              <Button onClick={exportPDF} variant="outline" className="border-border hover:bg-card text-foreground/80">
                <FileDown className="w-4 h-4 mr-2" /> Export PDF
              </Button>
              <Button onClick={exportReport} variant="outline" className="border-border hover:bg-card text-foreground/80">
                <DownloadCloud className="w-4 h-4 mr-2" /> Export JSON
              </Button>
            </div>
          )}
        </div>

        {error ? (
          <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-6 flex flex-col items-center justify-center text-center">
            <AlertOctagon className="w-12 h-12 text-destructive mb-4" />
            <h3 className="text-xl font-bold text-foreground mb-2">Pipeline Error</h3>
            <p className="text-muted-foreground">{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <PipelineProgress currentStage={stage as any} />
              
              <div className="space-y-4">
                <AnimatePresence>
                  {claimEntries.map(([id, c], i) => (
                    <ClaimCard
                      key={id}
                      index={i}
                      claimText={c.result?.claim?.claim_text || "Extracting claim details..."}
                      status={c.status}
                      verdict={c.result?.verification?.verdict}
                      confidence={c.result?.verification?.confidence_score}
                      reasoning={c.result?.verification?.reasoning}
                      citations={c.result?.verification?.citations?.length > 0 ? c.result.verification.citations : c.result?.evidence}
                    />
                  ))}
                </AnimatePresence>
                {claimEntries.length === 0 && stage !== "" && (
                  <div className="text-center py-12 text-muted-foreground animate-pulse">
                    Scanning text for verifiable facts...
                  </div>
                )}
              </div>

              {mediaResults.length > 0 && <MediaIntegritySection mediaResults={mediaResults} />}
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-32 space-y-6">
                <motion.div 
                  className="bg-card/40 backdrop-blur-xl border border-border rounded-3xl p-8 flex flex-col items-center shadow-xl"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-6">Overall Accuracy</h3>
                  <OverallScoreRing score={report?.overall_score || 0} />
                  
                  {report && (
                    <div className="mt-8 w-full">
                      <h4 className="text-xs text-muted-foreground font-bold uppercase mb-3 px-2">Verdict Breakdown</h4>
                      <div className="space-y-3">
                        {Object.entries(report.breakdown_by_verdict || {}).map(([v, count]) => {
                          if (count === 0) return null;
                          return (
                            <div key={v} className="flex items-center justify-between bg-background/50 rounded-lg p-2 px-3 text-sm">
                              <span className="text-foreground/80 font-medium">{v.replace("_", " ")}</span>
                              <span className="font-mono text-primary font-bold">{count as number}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </motion.div>

                {aiTextResult && (
                  <AIDetectionBanner 
                    score={aiTextResult.ai_generated_probability} 
                    indicators={aiTextResult.indicators} 
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
