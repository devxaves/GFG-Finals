"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Search, 
  Calendar, 
  ExternalLink, 
  FileCheck2, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Filter,
  Sparkles,
  ArrowRight,
  Loader2,
  LinkIcon, 
  FileText
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { BackgroundElements } from "@/components/background-elements";
import { useAuth } from "@clerk/nextjs";

export default function FactCheckInputPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const [inputType, setInputType] = useState<"text" | "url">("text");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    
    setIsSubmitting(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/fact-check/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_type: inputType, content, user_id: userId })
      });
      const data = await res.json();
      if (data.job_id) {
        router.push(`/fact-check/report/${data.job_id}`);
      } else {
        alert("Failed to start job.");
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error(err);
      alert("API Error");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden relative selection:bg-purple-500/30">
      <BackgroundElements />
      <Navbar />

      <div className="relative z-10 w-full max-w-4xl mx-auto px-4 pt-32 pb-24">
        <div className="text-center mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600 animate-gradient">
              Verify the Unverifiable.
            </h1>
            <p className="text-xl text-foreground/70 max-w-2xl mx-auto">
              Drop in a news article URL or paste a suspicious claim. Our AI will
              extract facts, retrieve evidence, and reason its way to the truth.
            </p>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-card/40 backdrop-blur-xl border border-border rounded-3xl p-6 md:p-8 shadow-2xl"
        >
          <Tabs defaultValue="text" onValueChange={(v) => setInputType(v as "text" | "url")} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-8 bg-background/80 p-1 rounded-xl">
              <TabsTrigger value="text" className="rounded-lg data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all font-medium py-3">
                <FileText className="w-4 h-4 mr-2" /> Paste Text
              </TabsTrigger>
              <TabsTrigger value="url" className="rounded-lg data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all font-medium py-3">
                <LinkIcon className="w-4 h-4 mr-2" /> Enter URL
              </TabsTrigger>
            </TabsList>
            
            <form onSubmit={handleSubmit}>
              <TabsContent value="text">
                <Textarea
                  placeholder="Paste the news article or claim here..."
                  className="min-h-[200px] bg-background/70 border-border focus-visible:ring-primary text-lg resize-none p-6 rounded-xl text-foreground placeholder:text-muted-foreground"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </TabsContent>
              <TabsContent value="url">
                <div className="relative">
                  <Input
                    type="url"
                    placeholder="https://example.com/news-article..."
                    className="h-16 bg-background/70 border-border focus-visible:ring-primary text-lg pl-6 pr-4 rounded-xl text-foreground placeholder:text-muted-foreground"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </div>
              </TabsContent>

              <div className="mt-8 flex justify-end">
                <Button 
                  type="submit" 
                  size="lg" 
                  disabled={!content.trim() || isSubmitting}
                  className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-primary-foreground rounded-full px-8 py-6 text-lg tracking-wide shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all hover:shadow-[0_0_30px_rgba(147,51,234,0.6)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <span className="flex items-center"><Sparkles className="w-5 h-5 mr-2 animate-pulse" /> Analyzing...</span>
                  ) : (
                    <span className="flex items-center">Verify Now <ArrowRight className="w-5 h-5 ml-2" /></span>
                  )}
                </Button>
              </div>
            </form>
          </Tabs>
        </motion.div>

        {/* Demo examples below fold */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          <div className="bg-card/30 border border-border/50 rounded-2xl p-5 hover:bg-card/80 transition-all cursor-pointer group hover:-translate-y-1 hover:border-primary/30 animate-float"
               style={{ animationDelay: "0s" }}
               onClick={() => { setInputType('text'); setContent("The Eiffel Tower in Paris was originally intended to be a temporary installation meant to stand for only 20 years after the 1889 World's Fair."); }}>
            <div className="text-primary/80 text-xs font-bold uppercase tracking-wider mb-2 flex items-center"><Sparkles className="w-3 h-3 mr-1"/> Try this claim</div>
            <p className="text-foreground/70 text-sm line-clamp-3 leading-relaxed">The Eiffel Tower in Paris was originally intended to be a temporary installation meant to stand for only 20 years after the 1889 World's Fair.</p>
          </div>
          <div className="bg-card/30 border border-border/50 rounded-2xl p-5 hover:bg-card/80 transition-all cursor-pointer group hover:-translate-y-1 hover:border-primary/30 animate-float"
               style={{ animationDelay: "0.5s" }}
               onClick={() => { setInputType('text'); setContent("Humans only use 10% of their brains. The rest is completely inactive according to leading neuroscientists at Harvard University."); }}>
            <div className="text-primary/80 text-xs font-bold uppercase tracking-wider mb-2 flex items-center"><Sparkles className="w-3 h-3 mr-1"/> Try this claim</div>
            <p className="text-foreground/70 text-sm line-clamp-3 leading-relaxed">Humans only use 10% of their brains. The rest is completely inactive according to leading neuroscientists at Harvard University.</p>
          </div>
          <div className="bg-card/30 border border-border/50 rounded-2xl p-5 hover:bg-card/80 transition-all cursor-pointer group hover:-translate-y-1 hover:border-primary/30 animate-float"
               style={{ animationDelay: "1s" }}
               onClick={() => { setInputType('url'); setContent("https://www.bbc.com/news/world-us-canada-68500201"); }}>
            <div className="text-primary/80 text-xs font-bold uppercase tracking-wider mb-2 flex items-center"><Sparkles className="w-3 h-3 mr-1"/> Try this URL</div>
            <p className="text-foreground/70 text-sm font-mono truncate">bbc.com/news/world-us-canada...</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
