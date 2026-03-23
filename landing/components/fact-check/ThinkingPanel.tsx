"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Globe, FileText, Brain, ListChecks, Search,
  Database, ShieldCheck, Cpu, CheckCircle, BarChart3,
  AlertTriangle, ChevronDown, ChevronUp, Zap
} from "lucide-react";

export interface ThinkingStep {
  icon: string;
  label: string;
  detail: string;
  timestamp: string;
}

interface ThinkingPanelProps {
  steps: ThinkingStep[];
  isComplete: boolean;
  isThinking: boolean;
}

const ICON_MAP: Record<string, any> = {
  "sparkles": Sparkles,
  "globe": Globe,
  "file-text": FileText,
  "brain": Brain,
  "list-checks": ListChecks,
  "search": Search,
  "database": Database,
  "shield-check": ShieldCheck,
  "cpu": Cpu,
  "check-circle": CheckCircle,
  "bar-chart": BarChart3,
  "alert-triangle": AlertTriangle,
};

export function ThinkingPanel({ steps, isComplete, isThinking }: ThinkingPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new steps
  useEffect(() => {
    if (scrollRef.current && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps.length, isExpanded]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl"
    >
      {/* Animated gradient border */}
      {isThinking && (
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-purple-600/30 via-primary/20 to-purple-600/30 animate-gradient" />
      )}
      
      <div className={`relative bg-card/60 backdrop-blur-xl rounded-2xl border transition-colors duration-500 ${
        isThinking ? 'border-purple-500/30' : isComplete ? 'border-emerald-500/30' : 'border-border'
      }`}>
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between p-4 hover:bg-card/40 transition-colors rounded-t-2xl"
        >
          <div className="flex items-center gap-3">
            {isThinking ? (
              <div className="relative">
                <Brain className="w-5 h-5 text-purple-400" />
                <div className="absolute inset-0 animate-ping">
                  <Brain className="w-5 h-5 text-purple-400 opacity-40" />
                </div>
              </div>
            ) : isComplete ? (
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            ) : (
              <Sparkles className="w-5 h-5 text-muted-foreground" />
            )}
            
            <span className="text-sm font-bold tracking-wide uppercase text-foreground/90">
              Analysis Stream
            </span>

            {isThinking && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
                </span>
                ACTIVE
              </span>
            )}

            {isComplete && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                COMPLETE
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {steps.length} steps
            </span>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Steps list */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div
                ref={scrollRef}
                className="max-h-[400px] overflow-y-auto px-4 pb-4 space-y-1 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
              >
                <AnimatePresence>
                  {steps.map((step, idx) => {
                    const IconComponent = ICON_MAP[step.icon] || Zap;
                    const isLast = idx === steps.length - 1;
                    const isCompletionStep = step.label.startsWith("Analysis Complete");

                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -20, height: 0 }}
                        animate={{ opacity: 1, x: 0, height: "auto" }}
                        transition={{ duration: 0.3, delay: 0.05 }}
                        className={`flex items-start gap-3 py-2.5 px-3 rounded-xl transition-colors ${
                          isLast && isThinking
                            ? 'bg-purple-500/10'
                            : isCompletionStep
                              ? 'bg-emerald-500/10'
                              : 'hover:bg-card/40'
                        }`}
                      >
                        {/* Icon */}
                        <div className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
                          isCompletionStep
                            ? 'bg-emerald-500/20'
                            : isLast && isThinking
                              ? 'bg-purple-500/20'
                              : 'bg-muted/50'
                        }`}>
                          <IconComponent className={`w-3.5 h-3.5 ${
                            isCompletionStep
                              ? 'text-emerald-400'
                              : isLast && isThinking
                                ? 'text-purple-400'
                                : 'text-muted-foreground'
                          }`} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold leading-tight ${
                            isCompletionStep ? 'text-emerald-400' : 'text-foreground/90'
                          }`}>
                            {step.label}
                          </p>
                          {step.detail && (
                            <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                              {step.detail}
                            </p>
                          )}
                        </div>

                        {/* Timestamp */}
                        <span className="text-[10px] text-muted-foreground/60 font-mono flex-shrink-0 mt-1">
                          {step.timestamp}
                        </span>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {/* Typing indicator when thinking */}
                {isThinking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 py-2 px-3"
                  >
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-xs text-purple-400/70 italic">Processing...</span>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
