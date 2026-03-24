"use client";

import { useState, useEffect } from "react";
import { ThumbsUp, ThumbsDown, AlertTriangle } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { motion } from "framer-motion";

interface VotingWidgetProps {
  jobId: string;
}

export function VotingWidget({ jobId }: VotingWidgetProps) {
  const { userId, isSignedIn } = useAuth();
  const [upvotes, setUpvotes] = useState(0);
  const [downvotes, setDownvotes] = useState(0);
  const [userVote, setUserVote] = useState<"up" | "down" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchVotes() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";
        const url = new URL(`${apiUrl}/api/fact-check/report/${jobId}/votes`);
        if (userId) url.searchParams.append("user_id", userId);
        
        const res = await fetch(url.toString());
        const data = await res.json();
        
        setUpvotes(data.upvotes || 0);
        setDownvotes(data.downvotes || 0);
        setUserVote(data.user_vote || null);
      } catch (e) {
        console.error("Failed to fetch votes:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchVotes();
  }, [jobId, userId]);

  const handleVote = async (type: "up" | "down") => {
    if (!isSignedIn) {
      // Logic to trigger clerk sign in or show toast
      alert("Please sign in to vote on this analysis.");
      return;
    }
    if (userVote === type) return;

    // Optimistic Update
    const oldUpvotes = upvotes;
    const oldDownvotes = downvotes;
    const oldUserVote = userVote;

    if (userVote === "up" && type === "down") {
      setUpvotes((v) => Math.max(0, v - 1));
      setDownvotes((v) => v + 1);
    } else if (userVote === "down" && type === "up") {
      setDownvotes((v) => Math.max(0, v - 1));
      setUpvotes((v) => v + 1);
    } else if (!userVote) {
      if (type === "up") setUpvotes((v) => v + 1);
      if (type === "down") setDownvotes((v) => v + 1);
    }
    setUserVote(type);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_FACT_CHECK_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/fact-check/report/${jobId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote_type: type, user_id: userId }),
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setUpvotes(data.upvotes);
      setDownvotes(data.downvotes);
      setUserVote(data.user_vote);
    } catch (e) {
      console.error("Vote failed:", e);
      // Revert optimistic update
      setUpvotes(oldUpvotes);
      setDownvotes(oldDownvotes);
      setUserVote(oldUserVote);
      alert("Failed to record vote. Please try again.");
    }
  };

  const totalVotes = upvotes + downvotes;
  const upvotePercentage = totalVotes === 0 ? 50 : Math.round((upvotes / totalVotes) * 100);
  const downvotePercentage = totalVotes === 0 ? 50 : Math.round((downvotes / totalVotes) * 100);

  if (loading) return null;

  return (
    <div className="bg-white/80 backdrop-blur-md border border-purple-100 rounded-2xl p-6 shadow-sm my-8 font-sans">
      <div className="text-center mb-6">
        <h3 style={{ fontFamily: 'Syne, sans-serif' }} className="text-xl font-bold text-foreground mb-1">Was this verdict accurate?</h3>
        <p className="text-sm text-muted-foreground">Help improve TruthScope by rating this AI analysis</p>
      </div>

      <div className="flex gap-4 justify-center mb-6">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => handleVote("up")}
          className={`flex-1 flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
            userVote === "up" 
              ? "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-[0_0_15px_rgba(16,185,129,0.2)]" 
              : "bg-background border-border text-muted-foreground hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600"
          }`}
        >
          <ThumbsUp className={`w-6 h-6 mb-2 ${userVote === "up" ? "fill-emerald-100" : ""}`} />
          <span className="font-semibold text-sm">Accurate Analysis</span>
          <span className="text-xs mt-1 opacity-80">{upvotes} upvotes</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => handleVote("down")}
          className={`flex-1 flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
            userVote === "down" 
              ? "bg-rose-50 border-rose-500 text-rose-700 shadow-[0_0_15px_rgba(225,29,72,0.2)]" 
              : "bg-background border-border text-muted-foreground hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          }`}
        >
          <ThumbsDown className={`w-6 h-6 mb-2 ${userVote === "down" ? "fill-rose-100" : ""}`} />
          <span className="font-semibold text-sm">Incorrect Verdict</span>
          <span className="text-xs mt-1 opacity-80">{downvotes} downvotes</span>
        </motion.button>
      </div>

      {totalVotes > 0 && (
        <div className="w-full">
          <div className="flex justify-between text-xs font-bold mb-2">
            <span className="text-emerald-600">{upvotePercentage}% Agreed</span>
            <span className="text-rose-600">{downvotePercentage}% Disagreed</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden flex">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${upvotePercentage}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="h-full bg-emerald-500"
            />
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${downvotePercentage}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="h-full bg-rose-500"
            />
          </div>
          <p className="text-center text-xs text-muted-foreground mt-3">
            {upvotePercentage}% of users found this analysis accurate ({totalVotes} total votes)
          </p>
        </div>
      )}

      {totalVotes < 5 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p><strong>Limited Feedback:</strong> Treat verdict with caution as few users have reviewed this.</p>
        </div>
      )}

      {totalVotes >= 5 && downvotePercentage > 40 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p><strong>Community Dispute:</strong> A large portion of users disagree with this AI verdict. Exercise independent judgment.</p>
        </div>
      )}
    </div>
  );
}
