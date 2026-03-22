import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle, HelpCircle, GitPullRequestDraft } from "lucide-react";

export function VerdictBadge({ verdict }: { verdict: string }) {
  const config = {
    TRUE: {
      color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      icon: <CheckCircle2 className="w-4 h-4 mr-1.5" />,
      label: "Supportive"
    },
    FALSE: {
      color: "bg-rose-500/20 text-rose-400 border-rose-500/30",
      icon: <XCircle className="w-4 h-4 mr-1.5" />,
      label: "Contradictory"
    },
    PARTIALLY_TRUE: {
      color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      icon: <AlertCircle className="w-4 h-4 mr-1.5" />,
      label: "Partially True"
    },
    CONFLICTING: {
      color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      icon: <GitPullRequestDraft className="w-4 h-4 mr-1.5" />,
      label: "Conflicting"
    },
    UNVERIFIABLE: {
      color: "bg-slate-500/20 text-slate-400 border-slate-500/30",
      icon: <HelpCircle className="w-4 h-4 mr-1.5" />,
      label: "Unverifiable"
    }
  };

  const current = config[verdict as keyof typeof config] || config.UNVERIFIABLE;

  return (
    <Badge variant="outline" className={`font-semibold tracking-wide uppercase px-3 py-1 ${current.color}`}>
      {current.icon}
      {current.label}
    </Badge>
  );
}
