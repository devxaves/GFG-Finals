import { motion } from "framer-motion";
import { Check, Loader2, Database, Search, FileSignature } from "lucide-react";
import { cn } from "@/lib/utils";

interface PipelineProgressProps {
  currentStage: "extracting" | "gathering_evidence" | "verifying" | "complete" | "";
}

export function PipelineProgress({ currentStage }: PipelineProgressProps) {
  const stages = [
    { id: "extracting", title: "Extracting Claims", icon: Database },
    { id: "gathering_evidence", title: "Gathering Evidence", icon: Search },
    { id: "verifying", title: "Verifying Facts", icon: FileSignature },
  ];

  const getStageStatus = (index: number) => {
    if (!currentStage) return "pending";
    const currentIndex = stages.findIndex((s) => s.id === currentStage);
    if (currentStage === "complete" || index < currentIndex) return "complete";
    if (index === currentIndex) return "active";
    return "pending";
  };

  return (
    <div className="w-full bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-6 mb-8">
      <div className="flex justify-between items-center relative">
        {/* Connecting line */}
        <div className="absolute top-1/2 left-[10%] right-[10%] h-1 bg-muted -translate-y-1/2 z-0">
          <motion.div 
            className="h-full bg-gradient-to-r from-primary to-purple-600"
            initial={{ width: "0%" }}
            animate={{ 
              width: currentStage === "extracting" ? "10%" : 
                     currentStage === "gathering_evidence" ? "50%" : 
                     currentStage === "verifying" ? "90%" : 
                     currentStage === "complete" ? "100%" : "0%"
            }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {stages.map((stage, index) => {
          const status = getStageStatus(index);
          const Icon = stage.icon;

          return (
            <div key={stage.id} className="relative z-10 flex flex-col items-center gap-3">
              <motion.div
                initial={false}
                animate={{
                  backgroundColor: status === "active" ? "hsl(280, 23%, 23%)" : status === "complete" ? "#10b981" : "hsl(var(--background))",
                  borderColor: status === "active" ? "hsl(280, 60%, 50%)" : status === "complete" ? "#059669" : "hsl(var(--border))",
                  scale: status === "active" ? 1.1 : 1
                }}
                className={cn(
                  "w-12 h-12 rounded-full border-2 flex items-center justify-center transition-colors duration-300",
                  status === "active" ? "shadow-[0_0_20px_rgba(147,51,234,0.5)]" : ""
                )}
              >
                {status === "complete" ? (
                  <Check className="w-6 h-6 text-white" />
                ) : status === "active" ? (
                  <Loader2 className="w-6 h-6 text-purple-300 animate-spin" />
                ) : (
                  <Icon className="w-5 h-5 text-muted-foreground" />
                )}
              </motion.div>
              <span className={cn(
                "text-sm font-medium transition-colors duration-300",
                status === "active" ? "text-primary font-bold" : status === "complete" ? "text-emerald-400" : "text-muted-foreground"
              )}>
                {stage.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
