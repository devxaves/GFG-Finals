import { motion } from "framer-motion";
import { VerdictBadge } from "./VerdictBadge";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { Loader2 } from "lucide-react";

interface ClaimCardProps {
  claimText: string;
  status: "extracting" | "searching" | "verifying" | "done";
  verdict?: string;
  confidence?: number;
  reasoning?: string;
  citations?: any[];
  index: number;
}

export function ClaimCard({ claimText, status, verdict, confidence, reasoning, citations, index }: ClaimCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="bg-card/40 backdrop-blur-md border border-border rounded-2xl p-6 shadow-xl relative overflow-hidden group hover:border-primary/30 transition-colors"
    >
      {/* Confidence Bar Background overlay */}
      {status === "done" && confidence !== undefined && (
        <div 
          className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-primary to-purple-400 opacity-80" 
          style={{ width: `${confidence}%`, transition: "width 1s ease-in-out" }}
        />
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Claim #{index + 1}</span>
            {status !== "done" && (
              <span className="flex items-center text-xs text-primary font-medium">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                {status === "searching" ? "Gathering Evidence..." : "Verifying Fact..."}
              </span>
            )}
          </div>
          
          <p className="text-lg text-foreground font-medium leading-relaxed mb-4">
            &ldquo;{claimText}&rdquo;
          </p>

          {status === "done" && verdict && (
            <div className="flex items-center justify-between mt-6">
              <div className="flex items-center gap-4">
                <VerdictBadge verdict={verdict} />
                <span className="text-sm font-medium text-muted-foreground">
                  {confidence}% Confidence
                </span>
              </div>
              <EvidenceDrawer citations={citations || []} reasoning={reasoning || ""} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
