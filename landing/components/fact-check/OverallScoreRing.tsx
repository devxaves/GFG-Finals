import { motion } from "framer-motion";

export function OverallScoreRing({ score }: { score: number }) {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  let color = "#3b82f6"; // Blue
  if (score > 75) color = "#10b981"; // Green
  else if (score < 40) color = "#f43f5e"; // Rose
  else if (score < 75) color = "#fbbf24"; // Amber

  return (
    <div className="relative flex items-center justify-center w-40 h-40">
      {/* Background Ring */}
      <svg className="absolute w-full h-full transform -rotate-90">
        <circle
          cx="80"
          cy="80"
          r={radius}
          stroke="currentColor"
          strokeWidth="12"
          fill="transparent"
          className="text-slate-800"
        />
        {/* Animated Progress Ring */}
        <motion.circle
          cx="80"
          cy="80"
          r={radius}
          stroke={color}
          strokeWidth="12"
          fill="transparent"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          strokeLinecap="round"
        />
      </svg>
      {/* Score Text */}
      <div className="absolute text-center flex flex-col items-center">
        <motion.span
          className="text-4xl font-extrabold text-white"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
        >
          {score}%
        </motion.span>
        <div className="text-xs text-slate-400 uppercase tracking-widest mt-1">Accuracy</div>
      </div>
    </div>
  );
}
