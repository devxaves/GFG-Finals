"use client";

import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { X, ExternalLink, Activity } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ClaimEvidenceGraphProps {
  jobId: string;
  articleTitle: string;
  articleUrl: string;
  claims: any[]; 
}

export function ClaimEvidenceGraph({ jobId, articleTitle, articleUrl, claims }: ClaimEvidenceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);

  useEffect(() => {
    if (!containerRef.current || !claims || claims.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = 600; // Increased height for the wider left column layout

    d3.select(containerRef.current).select("svg").remove();

    const svg = d3.select(containerRef.current)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto; display: block;")
      .style("background", "transparent");

    // Defs for gradients and glow filters
    const defs = svg.append("defs");

    // Glow filter
    const filter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    
    filter.append("feGaussianBlur")
      .attr("stdDeviation", "4")
      .attr("result", "coloredBlur");
      
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Core Theme Colors
    const colorMap: Record<string, string> = {
      "TRUE": "#10b981",     // Emerald
      "FALSE": "#f43f5e",    // Rose
      "MISLEADING": "#f59e0b", // Amber
      "UNVERIFIABLE": "#94a3b8", // Slate
      "ARTICLE": "#7c3aed"   // Violet/Purple
    };

    // Prepare data
    const nodes: any[] = [];
    const links: any[] = [];
    const articleNodeId = "article_root";

    nodes.push({
      id: articleNodeId,
      type: "ARTICLE",
      label: articleTitle || "Analyzed Document",
      radius: 45,
      fx: width / 2, // gently fix center horizontally
      fy: height / 2,
    });

    claims.forEach((c) => {
      const claimId = `claim_${c.id || Math.random()}`;
      const verdict = c.verification?.verdict || "UNVERIFIABLE";
      
      let nodeLabel = "Unverified Claim";
      if (verdict === "TRUE") nodeLabel = "Verified Claim";
      if (verdict === "FALSE") nodeLabel = "False Claim";
      if (verdict === "MISLEADING") nodeLabel = "Misleading Claim";
      
      nodes.push({
        id: claimId,
        type: "CLAIM",
        verdict: verdict,
        label: nodeLabel,
        data: c,
        radius: 28
      });

      links.push({
        source: articleNodeId,
        target: claimId,
        value: 3,
        type: "ARTICLE_TO_CLAIM"
      });

      const evs = c.verification?.citations || c.evidence || [];
      evs.forEach((ev: any, idx: number) => {
        const evId = `ev_${claimId}_${idx}`;
        const supports = ev.supports_claim !== false; 
        
        nodes.push({
          id: evId,
          type: "EVIDENCE",
          supports: supports,
          label: ev.domain || "Source",
          data: ev,
          radius: 16
        });

        links.push({
          source: claimId,
          target: evId,
          value: 1.5,
          type: "CLAIM_TO_EVIDENCE",
          supports: supports
        });
      });
    });

    // Outer Container Group (Zoomable)
    const g = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 3])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Forces
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance((d: any) => d.type === "ARTICLE_TO_CLAIM" ? 160 : 100))
      .force("charge", d3.forceManyBody().strength(-800))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius((d: any) => d.radius + 20).iterations(3));

    // Links
    const link = g.append("g")
      .attr("stroke-opacity", 0.4)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d: any) => d.type === "ARTICLE_TO_CLAIM" ? "#c084fc" : (d.supports ? "#34d399" : "#fb7185"))
      .attr("stroke-width", (d: any) => d.value)
      .attr("stroke-dasharray", (d: any) => d.type === "ARTICLE_TO_CLAIM" ? "8,4" : "none");

    // Dynamic flowing data particles along links!
    const linkParticles = g.append("g")
      .selectAll("circle")
      .data(links)
      .join("circle")
      .attr("r", 3)
      .attr("fill", (d: any) => d.type === "ARTICLE_TO_CLAIM" ? "#d8b4fe" : (d.supports ? "#a7f3d0" : "#fda4af"))
      .attr("filter", "url(#glow)");

    function animateParticles() {
      linkParticles
        .transition()
        .duration(1500)
        .ease(d3.easeLinear)
        .attrTween("cx", function(d: any) {
          return function(t: number) {
            // from target to source for evid -> claim, from source to target for article -> claim
            if(d.type === "ARTICLE_TO_CLAIM") {
                return d.source.x + (d.target.x - d.source.x) * t;
            } else {
                return d.target.x + (d.source.x - d.target.x) * t;
            }
          };
        })
        .attrTween("cy", function(d: any) {
          return function(t: number) {
            if(d.type === "ARTICLE_TO_CLAIM") {
                return d.source.y + (d.target.y - d.source.y) * t;
            } else {
                return d.target.y + (d.source.y - d.target.y) * t;
            }
          };
        })
        .on("end", animateParticles);
    }
    
    // Nodes
    const nodeGroup = g.append("g")
      .selectAll(".node-group")
      .data(nodes)
      .join("g")
      .attr("class", "node-group")
      .attr("cursor", "pointer")
      .call(drag(simulation));

    // Halo (pulsing rings behind nodes)
    nodeGroup.append("circle")
      .attr("r", (d: any) => d.radius + 8)
      .attr("fill", (d: any) => {
        if (d.type === "ARTICLE") return colorMap["ARTICLE"];
        if (d.type === "CLAIM") return colorMap[d.verdict] || colorMap["UNVERIFIABLE"];
        return d.supports ? "#10b981" : "#f43f5e";
      })
      .attr("opacity", 0.2)
      .attr("class", "pulse-halo");

    // Main Circle
    const circle = nodeGroup.append("circle")
      .attr("r", (d: any) => d.radius)
      .attr("fill", "#ffffff")
      .attr("stroke", (d: any) => {
        if (d.type === "ARTICLE") return colorMap["ARTICLE"];
        if (d.type === "CLAIM") return colorMap[d.verdict] || colorMap["UNVERIFIABLE"];
        return d.supports ? "#10b981" : "#f43f5e";
      })
      .attr("stroke-width", 4)
      .attr("filter", "url(#glow)");
      
    // Inner fill pattern / icon text
    nodeGroup.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .attr("font-size", (d: any) => d.type === "ARTICLE" ? "20px" : d.type === "CLAIM" ? "14px" : "10px")
      .attr("font-family", "system-ui")
      .attr("fill", (d: any) => {
        if (d.type === "ARTICLE") return colorMap["ARTICLE"];
        if (d.type === "CLAIM") return colorMap[d.verdict] || colorMap["UNVERIFIABLE"];
        return d.supports ? "#10b981" : "#f43f5e";
      })
      .text((d: any) => {
          if (d.type === "ARTICLE") return "📄";
          if (d.type === "CLAIM") return d.verdict === 'TRUE' ? "✓" : d.verdict === 'FALSE' ? "✗" : "⚠";
          return d.supports ? "+" : "-";
      });

    // Labels below nodes
    const labels = g.append("g")
      .selectAll(".label-bg")
      .data(nodes)
      .join("g");
      
    labels.append("rect")
      .attr("rx", 6)
      .attr("ry", 6)
      .attr("fill", "rgba(255, 255, 255, 0.8)")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-width", 1);
      
    labels.append("text")
      .attr("text-anchor", "middle")
      .attr("font-size", (d: any) => d.type === "EVIDENCE" ? "10px" : "12px")
      .attr("font-weight", (d: any) => d.type === "ARTICLE" ? "bold" : "600")
      .attr("font-family", "'Inter', sans-serif")
      .attr("fill", "#334155")
      .text((d: any) => d.label.length > 28 ? d.label.substring(0, 28) + '...' : d.label)
      .each(function(d: any) {
          const bbox = (this as any).getBBox();
          d.bbox = bbox;
      });
      
    // Resize rects based on text size
    labels.selectAll("rect")
      .attr("width", (d: any) => d.bbox.width + 12)
      .attr("height", (d: any) => d.bbox.height + 6)
      .attr("x", (d: any) => -d.bbox.width / 2 - 6)
      .attr("y", (d: any) => -d.bbox.height / 2 - 2);

    // Pulse animation logic
    function pulse() {
       nodeGroup.selectAll("circle.pulse-halo")
        .transition()
        .duration(1500)
        .attr("r", (d: any) => d.radius + 15)
        .attr("opacity", 0)
        .transition()
        .duration(0)
        .attr("r", (d: any) => d.radius + 4)
        .attr("opacity", 0.4)
        .on("end", pulse);
    }

    // Node interactions
    nodeGroup.on("click", (event, d) => {
      setSelectedNode(d);
      d3.select(event.currentTarget).select("circle:not(.pulse-halo)")
        .transition().duration(200)
        .attr("transform", "scale(1.2)")
        .transition().duration(200)
        .attr("transform", "scale(1)");
    });

    nodeGroup.on("mouseover", (event) => {
      d3.select(event.currentTarget).select("circle:not(.pulse-halo)").attr("stroke-width", 6);
    }).on("mouseout", (event) => {
      d3.select(event.currentTarget).select("circle:not(.pulse-halo)").attr("stroke-width", 4);
    });

    // Start simulations/animations
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      nodeGroup.attr("transform", (d: any) => `translate(${d.x}, ${d.y})`);
      
      labels.attr("transform", (d: any) => `translate(${d.x}, ${d.y + d.radius + 16})`);
    });

    // We must wait for first tick to set positions of particles correctly
    setTimeout(() => {
        animateParticles();
        pulse();
    }, 500);

    function drag(simulation: any) {
      function dragstarted(event: any) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }
      function dragged(event: any) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }
      function dragended(event: any) {
        if (!event.active) simulation.alphaTarget(0);
        if (event.subject.id !== articleNodeId) {
            event.subject.fx = null;
            event.subject.fy = null;
        }
      }
      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    }

    return () => {
      simulation.stop();
    };
  }, [claims, articleTitle]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="relative w-full rounded-3xl border border-purple-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden font-sans my-12 bg-gradient-to-br from-white via-purple-50/30 to-white"
    >
      {/* Decorative Background Glows & Grid */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-300 rounded-full mix-blend-multiply filter blur-[100px] opacity-20"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-300 rounded-full mix-blend-multiply filter blur-[100px] opacity-20"></div>
          
          {/* Right-aligned transparent dot grid aesthetic */}
          <div 
            className="absolute top-0 right-0 w-[50%] h-full opacity-40 pointer-events-none" 
            style={{ 
              backgroundImage: 'radial-gradient(#a855f7 1px, transparent 1px)', 
              backgroundSize: '24px 24px',
              maskImage: 'linear-gradient(to left, rgba(0,0,0,1), rgba(0,0,0,0))',
              WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1), rgba(0,0,0,0))'
            }}
          />
      </div>

      {/* Header Toolbar */}
      <div className="absolute top-0 left-0 w-full p-6 flex flex-col md:flex-row justify-between items-start md:items-center z-10 pointer-events-none gap-4">
        <div className="pointer-events-auto bg-white/60 backdrop-blur-xl px-5 py-3 rounded-2xl border border-white/40 shadow-sm flex items-center gap-3">
          <Activity className="w-5 h-5 text-purple-600" />
          <h3 style={{ fontFamily: 'Syne, sans-serif' }} className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-700 to-indigo-600 tracking-tight">
            Claim Evidence Map
          </h3>
        </div>
        
        <div className="bg-white/70 backdrop-blur-xl text-xs font-semibold px-4 py-3 border border-white/50 rounded-2xl shadow-sm flex items-center gap-4 pointer-events-auto">
             <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div> True</div>
             <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"></div> False</div>
             <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div> Misleading</div>
             <div className="rounded border border-purple-200 px-2 py-0.5 text-[10px] text-purple-600 bg-white ml-2">Scroll to zoom</div>
        </div>
      </div>

      <div ref={containerRef} className="w-full h-[600px] cursor-grab active:cursor-grabbing relative z-0" />

      {/* Modern Slide-out Drawer Panel */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: "spring", damping: 30, stiffness: 250 }}
            className="fixed top-0 right-0 w-full md:w-[450px] h-screen bg-white/95 backdrop-blur-3xl border-l border-purple-100 shadow-[-10px_0_40px_rgba(0,0,0,0.05)] flex flex-col z-[100]"
          >
            <div className="p-6 border-b border-purple-100 flex items-center justify-between sticky top-0 bg-white/40 backdrop-blur-md z-10">
                <span className="text-xs font-bold uppercase tracking-widest text-purple-500">Node Details</span>
                <button 
                  onClick={() => setSelectedNode(null)}
                  className="p-2 bg-purple-50 rounded-full hover:bg-purple-100 transition-colors"
                >
                  <X className="w-4 h-4 text-purple-700" />
                </button>
            </div>

            <div className="p-8 overflow-y-auto flex-1">
                {selectedNode.type === "ARTICLE" && (
                  <div>
                    <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center mb-6">
                        <span className="text-2xl">📄</span>
                    </div>
                    <h4 className="text-2xl font-black text-foreground mb-4 leading-tight">{selectedNode.label}</h4>
                    {articleUrl && (
                      <a href={articleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-sm font-bold text-purple-600 bg-purple-50 px-4 py-2 rounded-xl hover:bg-purple-100 transition-colors">
                        View Original Source <ExternalLink className="w-4 h-4 ml-2" />
                      </a>
                    )}
                    <div className="mt-8 p-5 bg-gradient-to-br from-purple-50 to-white rounded-2xl border border-purple-100 text-sm text-purple-800 leading-relaxed shadow-sm">
                      <strong>Subject Node:</strong> This represents the root content block analyzed by TruthScope. Expand your view to see individual claims extracted from this text and the evidence found to verify them.
                    </div>
                  </div>
                )}

                {selectedNode.type === "CLAIM" && (
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <span className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider rounded-xl border ${
                        selectedNode.verdict === 'TRUE' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 
                        selectedNode.verdict === 'FALSE' ? 'bg-rose-50 text-rose-600 border-rose-200' : 
                        'bg-amber-50 text-amber-600 border-amber-200'
                      }`}>
                        {selectedNode.verdict}
                      </span>
                      <span className="text-xs font-bold text-muted-foreground bg-slate-100 px-3 py-1.5 rounded-xl">
                        {selectedNode.data.verification?.confidence_score}% Confidence
                      </span>
                    </div>
                    
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Extracted Claim</h4>
                    <p className="text-lg font-bold text-slate-800 mb-8 leading-relaxed bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-inner">
                        "{selectedNode.data?.claim?.claim_text || "Unknown Context"}"
                    </p>
                    
                    {selectedNode.data.verification?.reasoning && (
                      <div className="mb-8">
                        <h4 className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-3">AI Reasoning</h4>
                        <p className="text-sm text-slate-600 leading-relaxed">{selectedNode.data.verification.reasoning}</p>
                      </div>
                    )}
                    
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                        Linked Evidence ({selectedNode.data.verification?.citations?.length || 0})
                    </h4>
                    <div className="space-y-4">
                      {(selectedNode.data.verification?.citations || []).map((cite: any, i: number) => (
                        <div key={i} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-purple-200 transition-colors group">
                          <div className="flex items-center gap-2 mb-3">
                            {cite.domain && <img src={`https://www.google.com/s2/favicons?domain=${cite.domain}&sz=32`} className="w-5 h-5 rounded" alt="" />}
                            <a href={cite.url} target="_blank" rel="noreferrer" className="text-sm font-bold text-slate-700 group-hover:text-purple-600 flex items-center transition-colors line-clamp-1">
                              {cite.title || cite.domain || "Source Document"}
                            </a>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed border-l-2 border-purple-200 pl-3">"{cite.supporting_snippet || "Verified context"}"</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.type === "EVIDENCE" && (
                  <div>
                    <span className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider rounded-xl border ${selectedNode.supports ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-rose-50 text-rose-600 border-rose-200"} inline-block mb-6`}>
                      {selectedNode.supports ? "Supporting Evidence" : "Refuting Evidence"} Node
                    </span>
                    
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Domain Source</h4>
                    <div className="flex items-center gap-3 mb-8 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      {selectedNode.data.domain && <img src={`https://www.google.com/s2/favicons?domain=${selectedNode.data.domain}&sz=64`} className="w-10 h-10 rounded-lg shadow-sm" alt="" />}
                      <p className="text-lg font-bold text-slate-800 line-clamp-2">{selectedNode.label}</p>
                    </div>
                    
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Reference Context</h4>
                    <p className="text-sm text-slate-700 bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 leading-relaxed italic mb-8">
                      "{selectedNode.data.snippet || selectedNode.data.supporting_snippet || "No direct snippet extracted. Matched via semantic search."}"
                    </p>

                    {selectedNode.data.url && (
                      <a href={selectedNode.data.url} target="_blank" rel="noreferrer" className="flex items-center justify-center w-full py-3.5 bg-slate-900 hover:bg-purple-600 text-white font-bold rounded-2xl transition-colors shadow-md">
                        Visit Live Article <ExternalLink className="w-4 h-4 ml-2" />
                      </a>
                    )}
                  </div>
                )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
