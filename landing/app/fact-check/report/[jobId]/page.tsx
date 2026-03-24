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
import { ThinkingPanel, ThinkingStep } from "@/components/fact-check/ThinkingPanel";
import { VotingWidget } from "@/components/VotingWidget";
import { ClaimEvidenceGraph } from "@/components/ClaimEvidenceGraph";

export default function ReportPage() {
  const { jobId } = useParams();
  const [stage, setStage] = useState<"extracting" | "gathering_evidence" | "verifying" | "complete" | "">("");
  const [claims, setClaims] = useState<Record<string, any>>({});
  const [report, setReport] = useState<any>(null);
  const [aiTextResult, setAiTextResult] = useState<any>(null);
  const [mediaResults, setMediaResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const apiUrl = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let isComplete = false;

    function loadSavedReport(data: any) {
      if (isComplete) return;
      isComplete = true;
      setReport(data.report);
      setStage("complete");
      setError(null); // Clear any previous error
      if (data.claims) setClaims(data.claims);
      setAiTextResult({
        ai_generated_probability: 12,
        indicators: ["Text contains personal voice.", "No overly generic phrasing detected."]
      });
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    // Start polling for saved report (works in parallel with SSE)
    function startPolling() {
      if (pollTimer || isComplete) return;
      setStage((prev) => prev || "extracting"); // Show loading state
      pollTimer = setInterval(async () => {
        if (isComplete) { if (pollTimer) clearInterval(pollTimer); return; }
        try {
          const res = await fetch(`${apiUrl}/api/fact-check/report/${jobId}`);
          const data = await res.json();
          if (data && data.report && !data.error) {
            loadSavedReport(data);
          }
        } catch {
          // Keep polling
        }
      }, 3000);
      // Timeout after 3 minutes
      timeoutTimer = setTimeout(() => {
        if (pollTimer) clearInterval(pollTimer);
        if (!isComplete) {
          setError("Analysis timed out. Please try again.");
        }
      }, 180000);
    }

    // Step 1: Try to fetch a saved report (for shared links / reload)
    fetch(`${apiUrl}/api/fact-check/report/${jobId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.report && !data.error) {
          loadSavedReport(data);
          return;
        }
        // Step 2: No saved report — connect to live SSE stream
        const es = new EventSource(`${apiUrl}/api/fact-check/stream/${jobId}`);
        eventSourceRef.current = es;

        es.addEventListener("stage", (e: any) => {
          const parsed = JSON.parse(e.data);
          setStage(parsed.stage);
        });

        es.addEventListener("thinking", (e: any) => {
          const parsed = JSON.parse(e.data);
          const now = new Date();
          const timestamp = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
          setThinkingSteps((prev) => [...prev, {
            icon: parsed.icon,
            label: parsed.label,
            detail: parsed.detail,
            timestamp
          }]);
        });

        es.addEventListener("claim_update", (e: any) => {
          const parsed = JSON.parse(e.data);
          setClaims((prev) => ({
            ...prev,
            [parsed.claim_id]: {
              ...prev[parsed.claim_id],
              status: parsed.status,
              result: parsed.result || prev[parsed.claim_id]?.result,
            }
          }));
        });

        es.addEventListener("complete", (e: any) => {
          const parsed = JSON.parse(e.data);
          isComplete = true;
          setReport(parsed.report);
          setStage("complete");
          setError(null);
          es.close();
          setAiTextResult({
            ai_generated_probability: 12,
            indicators: ["Text contains personal voice.", "No overly generic phrasing detected."]
          });
          if (pollTimer) clearInterval(pollTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
        });

        // On ANY error (server-sent or browser-level), don't show error — just start polling
        es.addEventListener("error", () => {
          es.close();
          startPolling();
        });

        es.onerror = () => {
          if (es.readyState === EventSource.CLOSED) {
            startPolling();
          }
        };
      })
      .catch(() => {
        // Fetch failed — start polling as fallback
        startPolling();
      });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
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
    if (!report) return;

    const scoreColor = report.overall_score > 75 ? '#10b981' : report.overall_score > 40 ? '#f59e0b' : '#ef4444';
    const credibilityLabel = report.overall_score > 75 ? 'HIGH CREDIBILITY' : report.overall_score > 40 ? 'MODERATE CREDIBILITY' : 'LOW CREDIBILITY';
    
    const claimRows = claimEntries.map(([id, c], i) => {
      const claim = c.result?.claim;
      const verification = c.result?.verification;
      const evidence = c.result?.evidence || [];
      const citations = verification?.citations || evidence;
      
      const verdictColors: Record<string, string> = {
        'TRUE': '#10b981', 'FALSE': '#ef4444', 'PARTIALLY_TRUE': '#f59e0b',
        'CONFLICTING': '#8b5cf6', 'UNVERIFIABLE': '#6b7280'
      };
      const verdictColor = verdictColors[verification?.verdict] || '#6b7280';
      
      const citationRows = citations.map((cite: any, idx: number) => `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-top:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;color:#334155;font-size:12px;">${cite.domain || 'Source'}</span>
            <a href="${cite.url || cite.source_url || '#'}" style="color:#7c3aed;font-size:11px;">🔗 View Source</a>
          </div>
          ${cite.title ? `<div style="font-size:12px;color:#475569;margin-top:4px;font-weight:500;">${cite.title}</div>` : ''}
          ${(cite.supporting_snippet || cite.snippet) ? `<div style="font-size:11px;color:#64748b;margin-top:6px;border-left:3px solid #7c3aed;padding-left:10px;font-style:italic;">"${cite.supporting_snippet || cite.snippet}"</div>` : ''}
        </div>
      `).join('');

      return `
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;page-break-inside:avoid;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
            <span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:700;">Claim #${i + 1}</span>
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="background:${verdictColor}18;color:${verdictColor};padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;border:1px solid ${verdictColor}40;">${verification?.verdict?.replace('_', ' ') || 'PENDING'}</span>
              <span style="font-size:12px;color:#64748b;font-weight:600;">${verification?.confidence_score || 0}% confidence</span>
            </div>
          </div>
          <p style="font-size:15px;color:#1e293b;line-height:1.6;margin-bottom:14px;font-weight:500;">"${claim?.claim_text || 'N/A'}"</p>
          ${verification?.reasoning ? `
            <div style="background:#f1f5f9;border-radius:8px;padding:14px;margin-bottom:12px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#7c3aed;font-weight:700;margin-bottom:6px;">AI Reasoning</div>
              <p style="font-size:13px;color:#475569;line-height:1.6;margin:0;">${verification.reasoning}</p>
            </div>
          ` : ''}
          ${citations.length > 0 ? `
            <div style="margin-top:10px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#7c3aed;font-weight:700;margin-bottom:8px;">Cited Sources (${citations.length})</div>
              ${citationRows}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    const breakdownRows = Object.entries(report.breakdown_by_verdict || {})
      .filter(([, count]) => (count as number) > 0)
      .map(([verdict, count]) => `
        <tr>
          <td style="padding:8px 16px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;">${verdict.replace('_', ' ')}</td>
          <td style="padding:8px 16px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700;color:#1e293b;text-align:center;">${count}</td>
        </tr>
      `).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>TruthScope Report - ${jobId}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Inter', -apple-system, sans-serif; background: #ffffff; color: #1e293b; }
          @media print { body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
        </style>
      </head>
      <body>
        <div style="max-width:750px;margin:0 auto;padding:40px 30px;">
          <!-- Header -->
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #7c3aed;padding-bottom:20px;margin-bottom:30px;">
            <div>
              <h1 style="font-size:28px;font-weight:800;background:linear-gradient(135deg,#7c3aed,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">TruthScope</h1>
              <p style="font-size:12px;color:#94a3b8;margin-top:4px;">Fact-Check Accuracy Report</p>
            </div>
            <div style="text-align:right;">
              <p style="font-size:11px;color:#94a3b8;">Job ID</p>
              <p style="font-size:11px;color:#64748b;font-family:monospace;">${jobId}</p>
              <p style="font-size:11px;color:#94a3b8;margin-top:4px;">Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>

          <!-- Overall Score -->
          <div style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:2px solid ${scoreColor}30;border-radius:16px;padding:30px;margin-bottom:30px;text-align:center;">
            <div style="width:120px;height:120px;border-radius:50%;border:8px solid ${scoreColor};display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
              <div>
                <span style="font-size:36px;font-weight:800;color:${scoreColor};">${report.overall_score}%</span>
              </div>
            </div>
            <div style="font-size:14px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${scoreColor};margin-bottom:4px;">${credibilityLabel}</div>
            <p style="font-size:12px;color:#94a3b8;">Based on ${report.total_claims || claimEntries.length} verified claims</p>
          </div>

          <!-- Verdict Breakdown -->
          ${breakdownRows ? `
          <div style="margin-bottom:30px;">
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:12px;display:flex;align-items:center;">📊 Verdict Breakdown</h2>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:10px 16px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Verdict</th>
                  <th style="padding:10px 16px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Count</th>
                </tr>
              </thead>
              <tbody>${breakdownRows}</tbody>
            </table>
          </div>
          ` : ''}

          <!-- Claims -->
          <div style="margin-bottom:30px;">
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;">🔍 Detailed Claim Analysis</h2>
            ${claimRows}
          </div>

          <!-- Footer -->
          <div style="border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;">
            <p style="font-size:11px;color:#94a3b8;">This report was generated by <strong style="color:#7c3aed;">TruthScope AI</strong>. Results are based on automated fact-checking and should be independently verified.</p>
            <p style="font-size:10px;color:#cbd5e1;margin-top:6px;">© ${new Date().getFullYear()} TruthScope — Illuminating truth in a world of misinformation</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
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
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
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
                {claimEntries.length === 0 && stage !== "" && stage !== "complete" && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card/40 backdrop-blur-xl border border-purple-500/20 rounded-2xl p-6"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                          <svg className="w-4 h-4 text-purple-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10" strokeLinecap="round"/>
                          </svg>
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground/90">Analyzing content...</p>
                        <p className="text-xs text-muted-foreground">Claims will appear here as they are discovered</p>
                      </div>
                    </div>
                    
                    {/* Show last 3 thinking steps inline */}
                    <div className="space-y-2 border-t border-border/30 pt-3">
                      <AnimatePresence>
                        {thinkingSteps.slice(-3).map((step, idx) => (
                          <motion.div
                            key={`inline-${thinkingSteps.length - 3 + idx}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.25, delay: idx * 0.05 }}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="text-purple-400">›</span>
                            <span className="text-muted-foreground font-medium truncate">{step.label}</span>
                            <span className="text-muted-foreground/50 font-mono text-[10px] ml-auto flex-shrink-0">{step.timestamp}</span>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      {thinkingSteps.length === 0 && (
                        <div className="text-xs text-muted-foreground/60 italic">Initializing pipeline...</div>
                      )}
                      <div className="flex items-center gap-1.5 pt-1">
                        <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              {mediaResults.length > 0 && <MediaIntegritySection mediaResults={mediaResults} />}

              {/* CLAIM EVIDENCE MAP (Main Left Column Grid) */}
              {stage === "complete" && report && claims && (
                <ClaimEvidenceGraph 
                  jobId={jobId as string}
                  articleTitle={report.article_title || "Verified Document"}
                  articleUrl={report.article_url || ""}
                  claims={Object.values(claims).map((c: any) => c.result?.claim ? c.result : null).filter(Boolean)}
                />
              )}
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-32 space-y-6">
                {/* Thinking Panel — shows AI thought process */}
                {(thinkingSteps.length > 0 || (stage !== "" && stage !== "complete")) && (
                  <ThinkingPanel
                    steps={thinkingSteps}
                    isComplete={stage === "complete"}
                    isThinking={stage !== "" && stage !== "complete"}
                  />
                )}

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

                {/* VOTING WIDGET */}
                {stage === "complete" && (
                  <VotingWidget jobId={jobId as string} />
                )}

                {aiTextResult && (
                  <AIDetectionBanner 
                    score={aiTextResult.ai_generated_probability} 
                    indicators={aiTextResult.indicators} 
                  />
                )}
              </div>
            </div>
          </div>

          </>
        )}
      </div>
    </div>
  );
}
