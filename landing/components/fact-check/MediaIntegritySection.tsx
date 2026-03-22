import { motion } from "framer-motion";
import { Image as ImageIcon, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";

export function MediaIntegritySection({ mediaResults }: { mediaResults: any[] }) {
  const [isOpen, setIsOpen] = useState(true);

  if (!mediaResults || mediaResults.length === 0) return null;

  const anyManipulated = mediaResults.some(m => m.ai_generated > 0.5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="mt-8 bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden"
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="p-5 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <ImageIcon className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-bold text-slate-200">Media Integrity Analysis</h3>
          </div>
          <CollapsibleTrigger asChild>
            <button className="text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors">
              {isOpen ? "Hide Details" : "Show Details"}
            </button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="p-5 pt-0 grid gap-4 mt-4">
            {anyManipulated && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-3 rounded-lg flex items-start text-sm mb-2">
                <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                Warning: Some media in this article shows strong signs of AI generation or manipulation.
              </div>
            )}
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mediaResults.map((media, idx) => {
                const isManipulated = media.ai_generated > 0.5;
                return (
                  <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden group">
                    <div className="h-32 bg-slate-900 overflow-hidden relative">
                      {media.url && <img src={media.url} alt="Analyzed media" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent opacity-60"></div>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Image {idx + 1}</span>
                        {isManipulated ? (
                          <span className="flex items-center text-xs font-bold text-rose-400"><AlertTriangle className="w-3 h-3 mr-1"/> AI Generated</span>
                        ) : (
                          <span className="flex items-center text-xs font-bold text-emerald-400"><CheckCircle2 className="w-3 h-3 mr-1"/> Authentic</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-2" title={media.description}>{media.description || "No description available."}</p>
                      
                      {media.manipulation_indicators && media.manipulation_indicators.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-800">
                          <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Indicators</p>
                          <p className="text-xs text-slate-400 truncate">{media.manipulation_indicators[0]}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}
