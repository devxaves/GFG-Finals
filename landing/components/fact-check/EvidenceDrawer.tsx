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
        <Button variant="outline" size="sm" className="mt-4 bg-card/50 hover:bg-card border-border text-foreground/80">
          <FileSearch className="w-4 h-4 mr-2" /> View Evidence
        </Button>
      </DrawerTrigger>
      <DrawerContent className="bg-background border-t border-border text-foreground max-h-[85vh]">
        <div className="mx-auto w-full max-w-3xl">
          <DrawerHeader>
            <DrawerTitle className="text-2xl text-foreground">Verification Evidence</DrawerTitle>
            <DrawerDescription className="text-muted-foreground">
              Sources and AI reasoning used to determine the verdict.
            </DrawerDescription>
          </DrawerHeader>
          <div className="p-4 pb-0">
            <ScrollArea className="h-[50vh] pr-4">
              <div className="mb-8">
                <h3 className="text-lg font-semibold mb-3 flex items-center text-primary">
                  <ChevronDown className="w-5 h-5 mr-1" /> AI Reasoning
                </h3>
                <div className="bg-card border border-border rounded-xl p-5 text-foreground/80 leading-relaxed tabular-nums">
                  {reasoning}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center text-primary">
                  <ChevronDown className="w-5 h-5 mr-1" /> Cited Sources
                </h3>
                {citations && citations.length > 0 ? (
                  <div className="grid gap-4">
                    {citations.map((cite, idx) => (
                      <div key={idx} className="bg-card/50 border border-border rounded-xl p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center">
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold mr-3 border border-primary/30 text-primary">
                              {idx + 1}
                            </div>
                            <span className="font-medium text-foreground">{cite.domain}</span>
                          </div>
                          <a href={cite.url || cite.source_url} target="_blank" rel="noreferrer" className="text-primary hover:text-purple-400 transition-colors">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                        {cite.title && (
                          <div className="mt-2 text-xs font-bold text-foreground/80">{cite.title}</div>
                        )}
                        <p className="mt-2 text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                          &ldquo;{cite.supporting_snippet || cite.snippet}&rdquo;
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground italic">No citations available.</p>
                )}
              </div>
            </ScrollArea>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="border-border hover:bg-card text-foreground/80">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
