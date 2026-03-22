import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { FileSearch, ExternalLink, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export function EvidenceDrawer({ 
  citations, 
  reasoning 
}: { 
  citations: any[]; 
  reasoning: string; 
}) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm" className="mt-4 bg-slate-900/50 hover:bg-slate-800 border-slate-700 text-slate-300">
          <FileSearch className="w-4 h-4 mr-2" /> View Evidence
        </Button>
      </DrawerTrigger>
      <DrawerContent className="bg-slate-950 border-t border-slate-800 text-slate-100 max-h-[85vh]">
        <div className="mx-auto w-full max-w-3xl">
          <DrawerHeader>
            <DrawerTitle className="text-2xl text-slate-100">Verification Evidence</DrawerTitle>
            <DrawerDescription className="text-slate-400">
              Sources and AI reasoning used to determine the verdict.
            </DrawerDescription>
          </DrawerHeader>
          <div className="p-4 pb-0">
            <ScrollArea className="h-[50vh] pr-4">
              <div className="mb-8">
                <h3 className="text-lg font-semibold mb-3 flex items-center text-blue-400">
                  <ChevronDown className="w-5 h-5 mr-1" /> AI Reasoning
                </h3>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-slate-300 leading-relaxed tabular-nums">
                  {reasoning}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center text-blue-400">
                  <ChevronDown className="w-5 h-5 mr-1" /> Cited Sources
                </h3>
                {citations && citations.length > 0 ? (
                  <div className="grid gap-4">
                    {citations.map((cite, idx) => (
                      <div key={idx} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center">
                            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold mr-3 border border-slate-700">
                              {idx + 1}
                            </div>
                            <span className="font-medium text-slate-200">{cite.domain}</span>
                          </div>
                          <a href={cite.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                        <p className="mt-3 text-sm text-slate-400 italic border-l-2 border-slate-700 pl-3">
                          "{cite.supporting_snippet}"
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No citations available.</p>
                )}
              </div>
            </ScrollArea>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="border-slate-700 hover:bg-slate-800 text-slate-300">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
