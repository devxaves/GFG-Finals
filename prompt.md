You are a senior full-stack engineer and UI/UX expert building 
production-grade features for TruthScope — an AI-powered 
fact-checking and media forensics web platform.

TruthScope's tech stack:
- Frontend: Next.js 14 (App Router), Tailwind CSS, Lucide React
- Backend: Python FastAPI (located at landing/fact-check-api/)
- Database: NeonDB PostgreSQL via SQLAlchemy
- Auth: Clerk (userId available via useAuth() hook)
- LLM: Google Gemini 2.5 Flash
- Evidence: Tavily API
- Existing DB Table: FactCheckReport with columns:
  id, job_id, url_hash, user_id, source, report_json, claims_json

The report_json structure per job looks like this:
{
  "overall_score": 42,
  "verdict": "MISLEADING",
  "article_title": "string",
  "article_url": "string",
  "claims": [
    {
      "claim_id": "uuid",
      "claim_text": "string",
      "verdict": "TRUE" | "FALSE" | "MISLEADING" | "UNVERIFIABLE",
      "confidence": 0.87,
      "evidence": [
        {
          "source_url": "string",
          "source_domain": "string",
          "snippet": "string",
          "supports_claim": true | false
        }
      ]
    }
  ]
}

---

BUILD THESE 3 COMPLETE FEATURES:

════════════════════════════════════════════
FEATURE 1: CLAIM EVIDENCE MAP (D3.js Force Graph)
════════════════════════════════════════════

Build a fully interactive D3.js force-directed knowledge graph 
rendered inside a React component: ClaimEvidenceGraph.jsx

VISUAL DESIGN REQUIREMENTS:
- Dark background: #0A0A0F with subtle radial gradient glow at center
- Use a cyber-forensics / intelligence dashboard aesthetic
- Font: "JetBrains Mono" for node labels, "Syne" for UI chrome
- Nodes:
    • Central article node: large hexagon, pulsing white glow, 
      label = truncated article title
    • Claim nodes: medium circles, color-coded:
        - TRUE → #00FF88 (neon green)
        - FALSE → #FF3B5C (neon red)
        - MISLEADING → #FFB800 (amber)
        - UNVERIFIABLE → #8B8FA8 (muted slate)
    • Evidence source nodes: small diamond shapes, color:
        - Supporting evidence → semi-transparent green
        - Refuting evidence → semi-transparent red
- Edges:
    • Article → Claim: thick white dashed animated line
    • Claim → Evidence: thinner colored line matching verdict
    • Green edges for supporting sources, red for refuting
    • Edges animate with a traveling dot (stroke-dashoffset animation)
- On hover over any node: 
    • Scale up 1.2x with smooth spring transition
    • Show floating tooltip with: claim text / source domain / snippet
- On click of a Claim node:
    • Open a right-side drawer panel (no page navigation)
    • Drawer shows: full claim text, verdict badge, confidence % bar,
      all evidence cards (source URL, domain favicon, snippet excerpt,
      supports/refutes badge)
- Zoom + pan: enabled via D3 zoom behavior
- "Reset View" button top-left corner
- Graph legend bottom-left: node types, edge meanings
- Entrance animation: nodes fly in from center with staggered delay
- Mini-map thumbnail bottom-right corner showing full graph overview

COMPONENT PROPS:
interface ClaimEvidenceGraphProps {
  jobId: string;
  articleTitle: string;
  articleUrl: string;
  claims: Claim[]; // from report_json.claims
}

Install: d3 (already likely available, if not use npm install d3)

Place file at: landing/components/ClaimEvidenceGraph.jsx
Integrate it inside: landing/app/fact-check/report/page.jsx
below the main verdict header, full-width section, height: 600px.

════════════════════════════════════════════
FEATURE 2: MISINFORMATION LEADERBOARD PAGE
════════════════════════════════════════════

BUILD BACKEND FIRST:

Add a new FastAPI endpoint in main.py:

GET /leaderboard?timeframe=week|month|all

Logic:
- Query FactCheckReport table
- Parse overall_score from report_json for each unique url_hash
- Group by url_hash, take the minimum overall_score per article 
  (worst credibility)
- Also extract: article_title, article_url, verdict, scan_count 
  (how many users scanned same url_hash), top FALSE claim text
- Filter by timeframe using the created_at timestamp column 
  (add this column if not present: created_at = DateTime, 
  default = datetime.utcnow)
- Return top 20 results ordered by overall_score ASC (lowest first)

Response schema:
{
  "leaderboard": [
    {
      "rank": 1,
      "article_title": "string",
      "article_url": "string",
      "overall_score": 12,
      "verdict": "FALSE",
      "scan_count": 47,
      "worst_claim": "string",
      "job_id": "string",
      "domain": "string"
    }
  ],
  "total_articles_scanned": 342,
  "total_claims_verified": 1891,
  "timeframe": "week"
}

BUILD FRONTEND:

Create a new page: landing/app/leaderboard/page.jsx

VISUAL DESIGN:
- Full dark page aesthetic, matching TruthScope's existing theme
- Page header: bold massive typography — "MISINFORMATION RADAR" 
  as the page title, subtitle: "The most misleading content 
  analyzed this week, ranked by credibility score"
- Header has 3 animated stat counters (count up on mount):
    • Total Articles Scanned
    • Total Claims Verified  
    • Lowest Score This Week
- Timeframe toggle tabs: "This Week" | "This Month" | "All Time"
  Switching tabs fetches new data with fade transition

LEADERBOARD TABLE/CARDS:
- Rank #1, #2, #3 get special treatment:
    • #1: Full-width featured card at top with red glowing border,
      "MOST MISLEADING" badge, large credibility score displayed
      as a cracked/broken circle progress ring in red
    • #2, #3: Side-by-side slightly smaller cards with amber border
    • #4-#20: Compact table rows with rank number, score bar, 
      domain favicon, article title, scan count badge, 
      worst claim excerpt

Per card/row shows:
- Rank number (stylized — #1 is large and dramatic)
- Domain favicon (fetch via google favicon API)
- Article title (truncated to 2 lines, link to full report page)
- Credibility Score: animated circular gauge, color matches verdict
- Verdict badge: styled pill (FALSE=red, MISLEADING=amber, etc.)
- Scan Count: "👁 47 scans" — shows how viral it went
- Worst Claim: italic excerpt of the most damning false claim
- "View Full Report →" button linking to /fact-check/report/[job_id]

ANIMATIONS:
- On page load, rows stagger in from bottom with delay
- Score bars animate from 0 to value on mount
- Rank #1 card has subtle red scanline animation overlay

Add leaderboard link to the main navigation bar.

════════════════════════════════════════════
FEATURE 3: COMMUNITY FEEDBACK VOTING SYSTEM
════════════════════════════════════════════

BUILD BACKEND:

1. Add new columns to FactCheckReport table via SQLAlchemy:
   - upvotes: Integer, default=0
   - downvotes: Integer, default=0

2. Add new FastAPI endpoints in main.py:

POST /report/{job_id}/vote
Body: { "vote_type": "up" | "down", "user_id": "string" }

Logic:
- Create a separate VotingRecord table to prevent double-voting:
  VotingRecord(id, job_id, user_id, vote_type, created_at)
- Check if user_id already voted on this job_id
- If already voted same type: return error "Already voted"
- If voted opposite: switch the vote (remove old, add new)
- If not voted: add new vote record, increment counter on 
  FactCheckReport
- Return updated { upvotes, downvotes, user_vote: "up"|"down"|null }

GET /report/{job_id}/votes?user_id=string
- Returns current upvotes, downvotes, and this user's current vote

BUILD FRONTEND:

Create component: landing/components/VotingWidget.jsx

PLACEMENT: Directly below the main credibility score circle 
on the report page (landing/app/fact-check/report/page.jsx)

VISUAL DESIGN:
- Dark frosted glass card (backdrop-blur, semi-transparent bg)
- Header text: "Was this verdict accurate?" in Syne font
- Subtext: "Help improve TruthScope by rating this analysis"
- Two large voting buttons side by side:

  UPVOTE BUTTON:
  - Icon: thumbs up (Lucide ThumbsUp)
  - Label: "Accurate Analysis"  
  - Color when active: neon green (#00FF88) with green glow
  - Shows upvote count below

  DOWNVOTE BUTTON:
  - Icon: thumbs down (Lucide ThumbsDown)
  - Label: "Incorrect Verdict"
  - Color when active: neon red (#FF3B5C) with red glow
  - Shows downvote count below

INTERACTION BEHAVIOR:
- If user not logged in: show "Login to vote" tooltip on hover,
  clicking redirects to Clerk sign-in
- If user logged in and hasn't voted:
    • Both buttons glow softly on hover with spring animation
    • Click animates button: scale bounce 1 → 1.2 → 1
    • Optimistic UI update (show new count immediately)
    • Send POST request in background
- If user has already voted:
    • Their vote shows highlighted
    • Can click opposite to switch vote (with animation)
    • Clicking same vote again = does nothing (already voted)

VOTE SENTIMENT BAR:
Below both buttons, show a horizontal bar:
- Left side (green): % of upvotes
- Right side (red): % of downvotes
- Animated fill on mount
- Label: "87% of users found this analysis accurate (142 votes)"

LOW VOTE WARNING:
If total votes < 5, show a subtle disclaimer:
"⚠️ Limited community feedback. Treat verdict with caution."

HIGH DISAGREEMENT WARNING:
If downvotes > 40% of total votes, show a yellow banner:
"⚠️ Community disputes this verdict. Exercise independent judgment."

COMPONENT PROPS:
interface VotingWidgetProps {
  jobId: string;
  userId: string | null;
}

Use useAuth() to get userId inside the component.

════════════════════════════════════════════
GLOBAL REQUIREMENTS FOR ALL 3 FEATURES
════════════════════════════════════════════

AESTHETIC SYSTEM (apply consistently across all 3 features):
- Color palette:
    --bg-primary: #0A0A0F
    --bg-secondary: #111118
    --bg-card: rgba(255,255,255,0.04)
    --border-subtle: rgba(255,255,255,0.08)
    --text-primary: #F0F0F5
    --text-muted: #8B8FA8
    --accent-green: #00FF88
    --accent-red: #FF3B5C
    --accent-amber: #FFB800
    --accent-blue: #4F8EF7
    --glow-green: 0 0 20px rgba(0,255,136,0.3)
    --glow-red: 0 0 20px rgba(255,59,92,0.3)

- Fonts: 
    Display/Headers → "Syne" (700, 800)
    Mono/Data → "JetBrains Mono" (400, 500)
    Body → "DM Sans" (400, 500)
    Import all from Google Fonts

- All cards use: 
    background: var(--bg-card)
    border: 1px solid var(--border-subtle)
    border-radius: 16px
    backdrop-filter: blur(12px)

- All interactive elements:
    transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)
    (spring easing for organic feel)

- Loading states: use animated skeleton shimmer with 
  gradient sweep, not spinners

- Error states: red frosted glass card with 
  Lucide AlertTriangle icon

- Empty states: centered illustration description + 
  CTA button (never just blank)

CODE QUALITY REQUIREMENTS:
- All components must be fully TypeScript-compatible (JSX is fine)
- All API calls wrapped in try/catch with proper error handling
- All loading states handled with skeletons
- No hardcoded values — all colors via CSS variables
- Mobile responsive (graph collapses to vertical scroll list 
  on screens < 768px, leaderboard stacks to single column)
- Use React.memo on heavy components (ClaimEvidenceGraph)
- Implement proper cleanup in useEffect (D3 cleanup on unmount)
- Console.log only in development, strip for production

DELIVERABLES CHECKLIST:
[ ] landing/components/ClaimEvidenceGraph.jsx (D3 force graph)
[ ] landing/app/leaderboard/page.jsx (leaderboard page)
[ ] landing/components/VotingWidget.jsx (voting system)
[ ] landing/fact-check-api/main.py (updated with new endpoints)
[ ] landing/fact-check-api/models/database.py (updated schema)
[ ] Updated landing/app/fact-check/report/page.jsx 
    (integrating graph + voting widget)
[ ] Updated navigation to include Leaderboard link

Build each file completely, no placeholders, no TODOs.
Every component must work end-to-end.