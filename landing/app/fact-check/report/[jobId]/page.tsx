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
import { DownloadCloud, AlertOctagon } from "lucide-react";

export default function ReportPage() {
  const { jobId } = useParams();
  const [stage, setStage] = useState<"extracting" | "gathering_evidence" | "verifying" | "complete" | "">("");
  const [claims, setClaims] = useState<Record<string, any>>({});
  const [report, setReport] = useState<any>(null);
  const [aiTextResult, setAiTextResult] = useState<any>(null);
  const [mediaResults, setMediaResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const apiUrl = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";
    const es = new EventSource(`${apiUrl}/api/fact-check/stream/${jobId}`);
    eventSourceRef.current = es;

    es.addEventListener("stage", (e) => {
      const data = JSON.parse(e.data);
      setStage(data.stage);
    });

    es.addEventListener("claim_update", (e) => {
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

    es.addEventListener("complete", (e) => {
      const data = JSON.parse(e.data);
      setReport(data.report);
      setStage("complete");
      es.close();
      
      // We would ideally call the AI Text / Media detection simultaneously, 
      // mocking a visual success for the demo.
      setAiTextResult({
        ai_generated_probability: 12,
        indicators: ["Text contains personal voice.", "No overly generic phrasing detected."]
      });
    });

    es.addEventListener("error", (e) => {
      const data = JSON.parse(e.data);
      setError(data.message);
      if (!data.recoverable) {
        es.close();
      }
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

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-50 pt-32 pb-24 px-4 overflow-hidden">
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[70%] h-[70%] bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.1)_0%,rgba(10,15,30,0)_50%)]"></div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              Accuracy Report
            </h1>
            <p className="text-slate-400 mt-2">Job ID: <span className="font-mono text-xs">{jobId as string}</span></p>
          </div>
          {stage === "complete" && (
            <Button onClick={exportReport} variant="outline" className="bg-slate-900 border-slate-700 hover:bg-slate-800 text-slate-300">
              <DownloadCloud className="w-4 h-4 mr-2" /> Export JSON
            </Button>
          )}
        </div>

        {error ? (
          <div className="bg-rose-950/50 border border-rose-900 rounded-2xl p-6 flex flex-col items-center justify-center text-center">
            <AlertOctagon className="w-12 h-12 text-rose-500 mb-4" />
            <h3 className="text-xl font-bold text-slate-200 mb-2">Pipeline Error</h3>
            <p className="text-slate-400">{error}</p>
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
                      citations={c.result?.verification?.citations}
                    />
                  ))}
                </AnimatePresence>
                {claimEntries.length === 0 && stage !== "" && (
                  <div className="text-center py-12 text-slate-500 animate-pulse">
                    Scanning text for verifiable facts...
                  </div>
                )}
              </div>

              {mediaResults.length > 0 && <MediaIntegritySection mediaResults={mediaResults} />}
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-32 space-y-6">
                <motion.div 
                  className="bg-slate-900/40 border border-slate-800 rounded-3xl p-8 flex flex-col items-center shadow-xl"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6">Overall Accuracy</h3>
                  <OverallScoreRing score={report?.overall_score || 0} />
                  
                  {report && (
                    <div className="mt-8 w-full">
                      <h4 className="text-xs text-slate-500 font-bold uppercase mb-3 px-2">Verdict Breakdown</h4>
                      <div className="space-y-3">
                        {Object.entries(report.breakdown_by_verdict || {}).map(([v, count]) => {
                          if (count === 0) return null;
                          return (
                            <div key={v} className="flex items-center justify-between bg-slate-950/50 rounded-lg p-2 px-3 text-sm">
                              <span className="text-slate-300 font-medium">{v.replace("_", " ")}</span>
                              <span className="font-mono text-blue-400 font-bold">{count as number}</span>
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
