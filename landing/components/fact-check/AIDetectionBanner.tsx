import { motion } from "framer-motion";
import { Bot, ChevronDown, Cpu } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";

export function AIDetectionBanner({ score, indicators }: { score: number, indicators: string[] }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const isHighRisk = score > 60;
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-2xl border p-5 mt-8 transition-colors ${
        isHighRisk 
          ? "bg-rose-950/30 border-rose-900/50" 
          : "bg-emerald-950/30 border-emerald-900/50"
      }`}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isHighRisk ? "bg-rose-900/50 text-rose-400" : "bg-emerald-900/50 text-emerald-400"}`}>
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 flex items-center">
                AI Generation Probability
                <span className={`ml-3 px-2.5 py-0.5 rounded-full text-sm font-black ${isHighRisk ? "bg-rose-500 text-white" : "bg-emerald-500 text-white"}`}>
                  {score}%
                </span>
              </h3>
              <p className="text-sm text-slate-400">
                {isHighRisk ? "This text exhibits strong patterns typical of AI generation." : "This text appears to be human-written."}
              </p>
            </div>
          </div>
          <CollapsibleTrigger asChild>
            <button className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400">
              <ChevronDown className={`w-5 h-5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
        </div>
        
        <CollapsibleContent>
          <div className="mt-6 pt-6 border-t border-slate-800/50">
            <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center">
              <Cpu className="w-4 h-4 mr-2 text-slate-400" /> Detection Indicators
            </h4>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-400">
              {indicators.map((ind, i) => (
                <li key={i} className="flex items-start">
                  <span className="mr-2 text-blue-500">•</span>
                  <span>{ind}</span>
                </li>
              ))}
              {indicators.length === 0 && <li>No specific indicators found.</li>}
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}
