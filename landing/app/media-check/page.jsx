"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Film, Upload, X, AlertTriangle, Loader2, ImageIcon, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { BackgroundElements } from "@/components/background-elements";
import VideoForensicsReport from "@/components/VideoForensicsReport";

const API_BASE = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";

const STEPS = [
  "Uploading video...",
  "Extracting frames for analysis...",
  "Running AI detection models...",
  "Building forensics report...",
];

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function MediaCheckPage() {
  const [activeTab, setActiveTab] = useState("video");
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [state, setState] = useState("idle"); // idle | analyzing | done | error
  const [step, setStep] = useState(0);
  const [report, setReport] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  const startTimer = () => {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };
  const stopTimer = () => clearInterval(timerRef.current);

  const handleFile = useCallback((f) => {
    if (!f) return;
    const allowed = ["video/mp4", "video/webm", "video/quicktime", "video/avi", "video/x-msvideo"];
    if (!allowed.includes(f.type)) {
      setErrorMsg("Unsupported format. Use MP4, WebM, MOV, or AVI.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setErrorMsg("File too large. Maximum size is 50 MB.");
      return;
    }
    setErrorMsg("");
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setReport(null);
    setState("idle");
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  }, [handleFile]);

  const handleAnalyze = async () => {
    if (!file) return;
    setState("analyzing");
    setStep(0);
    startTimer();

    const formData = new FormData();
    formData.append("video", file);
    formData.append("user_id", "anonymous");

    try {
      setStep(1);
      await new Promise((r) => setTimeout(r, 500));
      setStep(2);

      const res = await fetch(`${API_BASE}/analyze/video`, {
        method: "POST",
        body: formData,
      });

      setStep(3);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      stopTimer();
      setReport(data);
      setState("done");
    } catch (e) {
      stopTimer();
      setErrorMsg(e.message || "Analysis failed. Please try again.");
      setState("error");
    }
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setReport(null);
    setState("idle");
    setStep(0);
    setErrorMsg("");
    setElapsed(0);
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden relative selection:bg-purple-500/30">
      <BackgroundElements />
      <Navbar />

      <div className="relative z-10 w-full max-w-4xl mx-auto px-4 pt-32 pb-24">

        {/* Header */}
        <div className="text-center mb-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600 animate-gradient">
              Media Forensics.
            </h1>
            <p className="text-xl text-foreground/70 max-w-2xl mx-auto">
              Upload a video and our AI will detect synthetic generation frame-by-frame using the Hive Moderation API.
            </p>
          </motion.div>
        </div>

        {/* Tab switcher */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="flex gap-2 mb-6 bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-1.5 w-fit mx-auto"
        >
          <button
            onClick={() => { setActiveTab("video"); reset(); }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "video"
                ? "bg-primary/20 text-primary shadow-sm"
                : "text-foreground/60 hover:text-foreground"
            }`}
          >
            <Film className="w-4 h-4" /> Video Analysis
          </button>
          <button
            onClick={() => setActiveTab("image")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "image"
                ? "bg-primary/20 text-primary shadow-sm"
                : "text-foreground/60 hover:text-foreground"
            }`}
          >
            <ImageIcon className="w-4 h-4" /> Image Analysis
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="bg-card/40 backdrop-blur-xl border border-border rounded-3xl p-6 md:p-8 shadow-2xl"
        >

          {/* ── VIDEO TAB ── */}
          {activeTab === "video" && (
            <>
              {/* IDLE */}
              {state === "idle" && (
                <>
                  {!file ? (
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all duration-300 ${
                        dragOver
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50 hover:bg-card/60"
                      }`}
                    >
                      <div className="flex justify-center mb-4">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                          <Upload className="w-7 h-7 text-primary" />
                        </div>
                      </div>
                      <p className="text-lg font-semibold text-foreground mb-1">Drop your video here or click to browse</p>
                      <p className="text-sm text-foreground/50">Supports MP4, WebM, MOV, AVI — Max 50 MB</p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => handleFile(e.target.files?.[0])}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 p-4 bg-background/60 border border-border rounded-2xl mb-6">
                      {previewUrl && (
                        <video src={previewUrl} muted playsInline className="w-32 h-20 object-cover rounded-xl flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{file.name}</p>
                        <p className="text-sm text-foreground/50 mt-0.5">{formatBytes(file.size)}</p>
                      </div>
                      <button onClick={reset} className="text-foreground/40 hover:text-foreground transition-colors p-1">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="flex items-center gap-3 mt-4 p-4 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      {errorMsg}
                    </div>
                  )}

                  <div className="mt-6 flex justify-end">
                    <Button
                      onClick={handleAnalyze}
                      disabled={!file}
                      size="lg"
                      className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-primary-foreground rounded-full px-8 py-6 text-lg tracking-wide shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all hover:shadow-[0_0_30px_rgba(147,51,234,0.6)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Film className="w-5 h-5 mr-2" /> Analyze Video
                    </Button>
                  </div>
                </>
              )}

              {/* ANALYZING */}
              {state === "analyzing" && (
                <div className="text-center py-8">
                  <div className="flex justify-center mb-6">
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                      <Loader2 className="w-9 h-9 text-primary animate-spin" />
                    </div>
                  </div>
                  <p className="text-xl font-bold text-foreground mb-1">Analyzing Video...</p>
                  <p className="text-sm text-foreground/50 mb-8">Time elapsed: {elapsed}s — This may take 15–45 seconds</p>

                  <div className="flex flex-col gap-3 text-left max-w-sm mx-auto">
                    {STEPS.map((label, i) => {
                      const status = i < step ? "done" : i === step ? "active" : "pending";
                      return (
                        <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                          status === "done" ? "border-border bg-background/40" :
                          status === "active" ? "border-primary/40 bg-primary/5" :
                          "border-border/40 opacity-40"
                        }`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                            status === "done" ? "bg-green-500/20 text-green-500" :
                            status === "active" ? "bg-primary/20 text-primary" :
                            "bg-border text-foreground/30"
                          }`}>
                            {status === "done" ? "✓" : i + 1}
                          </div>
                          <span className={`text-sm font-medium ${
                            status === "done" ? "text-green-500" :
                            status === "active" ? "text-foreground" :
                            "text-foreground/40"
                          }`}>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ERROR */}
              {state === "error" && (
                <div className="text-center py-10">
                  <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                      <AlertCircle className="w-8 h-8 text-destructive" />
                    </div>
                  </div>
                  <p className="text-lg font-bold text-foreground mb-2">Analysis Failed</p>
                  <p className="text-sm text-foreground/60 mb-6 max-w-sm mx-auto">{errorMsg}</p>
                  <Button variant="outline" onClick={reset}>Try Again</Button>
                </div>
              )}

              {/* DONE */}
              {state === "done" && report && (
                <VideoForensicsReport report={report} onReset={reset} />
              )}
            </>
          )}

          {/* ── IMAGE TAB ── */}
          {activeTab === "image" && (
            <div className="text-center py-16">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <ImageIcon className="w-7 h-7 text-primary" />
                </div>
              </div>
              <h2 className="text-xl font-bold text-foreground mb-3">Image Deepfake Detection</h2>
              <p className="text-foreground/60 max-w-sm mx-auto mb-8 text-sm leading-relaxed">
                Use the TruthScope Chrome Extension to analyze any image directly on any webpage, or paste an image URL in the Fact Checker.
              </p>
              <Button
                asChild
                className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-primary-foreground rounded-full px-7 shadow-[0_0_20px_rgba(147,51,234,0.4)]"
              >
                <a href="/fact-check">Go to Fact Checker</a>
              </Button>
            </div>
          )}

        </motion.div>
      </div>
    </div>
  );
}
