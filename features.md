You are a senior full-stack engineer building two complete 
production-grade features for TruthScope — an AI-powered 
fact-checking and media forensics platform.

EXISTING TECH STACK:
- Frontend: Next.js 14 (App Router), Tailwind CSS, Lucide React
- Chrome Extension: Manifest V3, background.js, popup/ UI folder
- Backend: Python FastAPI at landing/fact-check-api/main.py
- Database: NeonDB PostgreSQL via SQLAlchemy
- Auth: Clerk (userId via useAuth())
- LLM: Google Gemini 2.5 Flash (gemini_client.py wrapper exists)
- Evidence: Tavily API (search_agent.py exists)
- Existing image deepfake: HuggingFace umm-maybe/AI-image-detector
- Existing DB Table: FactCheckReport with columns:
  id, job_id, url_hash, user_id, source, report_json, claims_json

EXISTING report_json structure:
{
  "overall_score": 42,
  "verdict": "MISLEADING",
  "article_title": "string",
  "article_url": "string",
  "claims": [
    {
      "claim_id": "uuid",
      "claim_text": "string",
      "verdict": "TRUE|FALSE|MISLEADING|UNVERIFIABLE",
      "confidence": 0.87,
      "evidence": [
        {
          "source_url": "string",
          "source_domain": "string",
          "snippet": "string",
          "supports_claim": true
        }
      ]
    }
  ]
}

ENVIRONMENT VARIABLES ALREADY IN .env:
GEMINI_API_KEY=...
TAVILY_API_KEY=...
NEON_DATABASE_URL=...

NEW KEYS TO ADD:
# landing/fact-check-api/.env
HIVE_API_KEY=your_hive_key_here

# extension/.env  
GOOGLE_VISION_API_KEY=your_google_vision_key_here

════════════════════════════════════════════════════════
FEATURE 1: VIDEO DEEPFAKE DETECTION
(Hive Moderation API + FastAPI Backend + Next.js UI)
════════════════════════════════════════════════════════

OVERVIEW:
User uploads a video file on the TruthScope web app. The 
backend sends it to Hive Moderation API which returns 
AI-generation probability scores per frame. The frontend 
shows a detailed forensics report with timeline visualization.

━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1: BACKEND — FastAPI
━━━━━━━━━━━━━━━━━━━━━━━━━━

File: landing/fact-check-api/pipeline/video_analyzer.py

Create a VideoAnalyzer class with:
```python
import httpx
import os
import uuid
import json
from pathlib import Path

HIVE_API_KEY = os.getenv("HIVE_API_KEY")
HIVE_VIDEO_URL = "https://api.thehive.ai/api/v2/task/sync"

class VideoAnalyzer:
    
    async def analyze_video(self, video_bytes: bytes, 
                            filename: str) -> dict:
        """
        Sends video binary to Hive Moderation API.
        Returns structured deepfake analysis report.
        """
        headers = {
            "Authorization": f"Token {HIVE_API_KEY}"
        }
        
        # Send multipart form with video binary
        files = {"media": (filename, video_bytes, "video/mp4")}
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                HIVE_VIDEO_URL,
                headers=headers,
                files=files
            )
            response.raise_for_status()
            raw = response.json()
        
        return self._parse_hive_response(raw, filename)
    
    def _parse_hive_response(self, raw: dict, 
                              filename: str) -> dict:
        """
        Parse Hive API response into TruthScope report format.
        
        Hive returns per-frame classification results under:
        raw["status"][0]["response"]["output"][0]["classes"]
        
        Each class has "class" name and "score" 0.0-1.0
        We look for class "ai_generated" or "deepfake"
        """
        job_id = str(uuid.uuid4())
        
        try:
            outputs = raw["status"][0]["response"]["output"]
        except (KeyError, IndexError):
            return self._error_report(job_id, filename, 
                                       "Hive API parse error")
        
        # Extract all frame-level AI generation scores
        frame_scores = []
        for frame_output in outputs:
            timestamp = frame_output.get("time", 0)
            classes = frame_output.get("classes", [])
            ai_score = 0.0
            for cls in classes:
                if cls.get("class") in ["ai_generated", 
                                         "deepfake", 
                                         "ai_video"]:
                    ai_score = max(ai_score, cls.get("score", 0))
            frame_scores.append({
                "timestamp_sec": round(timestamp, 2),
                "ai_probability": round(ai_score * 100, 1)
            })
        
        # Calculate aggregate statistics
        if frame_scores:
            scores = [f["ai_probability"] for f in frame_scores]
            avg_score = round(sum(scores) / len(scores), 1)
            max_score = round(max(scores), 1)
            suspicious_frames = len([s for s in scores 
                                      if s > 70])
            total_frames = len(scores)
        else:
            avg_score = 0.0
            max_score = 0.0
            suspicious_frames = 0
            total_frames = 0
        
        # Determine overall verdict
        if avg_score >= 80:
            verdict = "LIKELY_DEEPFAKE"
            verdict_label = "Likely AI-Generated / Deepfake"
            risk_level = "HIGH"
        elif avg_score >= 50:
            verdict = "SUSPICIOUS"
            verdict_label = "Suspicious Content Detected"
            risk_level = "MEDIUM"
        elif avg_score >= 25:
            verdict = "INCONCLUSIVE"
            verdict_label = "Inconclusive — Needs Review"
            risk_level = "LOW"
        else:
            verdict = "LIKELY_AUTHENTIC"
            verdict_label = "Likely Authentic Video"
            risk_level = "MINIMAL"
        
        return {
            "job_id": job_id,
            "filename": filename,
            "analysis_type": "video_deepfake",
            "verdict": verdict,
            "verdict_label": verdict_label,
            "risk_level": risk_level,
            "avg_ai_probability": avg_score,
            "max_ai_probability": max_score,
            "suspicious_frame_count": suspicious_frames,
            "total_frame_count": total_frames,
            "suspicious_frame_percentage": round(
                (suspicious_frames / total_frames * 100) 
                if total_frames > 0 else 0, 1
            ),
            "frame_timeline": frame_scores,
            "powered_by": "Hive Moderation API"
        }
    
    def _error_report(self, job_id, filename, error_msg):
        return {
            "job_id": job_id,
            "filename": filename,
            "analysis_type": "video_deepfake",
            "verdict": "ERROR",
            "verdict_label": "Analysis Failed",
            "risk_level": "UNKNOWN",
            "avg_ai_probability": 0,
            "max_ai_probability": 0,
            "error": error_msg,
            "frame_timeline": []
        }
```

━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2: ADD FASTAPI ENDPOINT
━━━━━━━━━━━━━━━━━━━━━━━━━━

Add to landing/fact-check-api/main.py:
```python
from fastapi import UploadFile, File, Form
from pipeline.video_analyzer import VideoAnalyzer

video_analyzer = VideoAnalyzer()

@app.post("/analyze/video")
async def analyze_video_endpoint(
    video: UploadFile = File(...),
    user_id: str = Form(default="anonymous")
):
    """
    Accepts video file upload, runs Hive deepfake analysis.
    Stores result in FactCheckReport table.
    Returns structured forensics report.
    """
    # Validate file type
    allowed_types = ["video/mp4", "video/webm", 
                     "video/quicktime", "video/avi"]
    if video.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format. "
                   f"Allowed: mp4, webm, mov, avi"
        )
    
    # Validate file size (max 50MB)
    video_bytes = await video.read()
    if len(video_bytes) > 50 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Video too large. Maximum size is 50MB."
        )
    
    # Run Hive analysis
    report = await video_analyzer.analyze_video(
        video_bytes, video.filename
    )
    
    # Save to database
    db_record = FactCheckReport(
        job_id=report["job_id"],
        url_hash=hashlib.md5(
            video.filename.encode()
        ).hexdigest(),
        user_id=user_id,
        source="website_video",
        report_json=json.dumps(report),
        claims_json=json.dumps([])
    )
    db.add(db_record)
    db.commit()
    
    return report


@app.get("/analyze/video/{job_id}")
async def get_video_report(job_id: str):
    """Fetch a previously analyzed video report by job_id"""
    record = db.query(FactCheckReport).filter(
        FactCheckReport.job_id == job_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, 
                            detail="Report not found")
    return json.loads(record.report_json)
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3: FRONTEND — Video Upload & Report Page
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE: landing/app/media-check/page.jsx

This is the main video deepfake analysis page. Build it with:

LAYOUT:
- Full dark page matching TruthScope aesthetic
- Page title: "MEDIA FORENSICS" in Syne 800 font
- Subtitle: "AI-powered deepfake and synthetic media detection"
- Two tabs at top: "Video Analysis" | "Image Analysis"
  (Image tab shows existing image deepfake UI, 
   Video tab shows new video upload UI)

VIDEO UPLOAD SECTION:
- Large drag-and-drop zone (dashed border, 
  animated gradient border on hover)
- Center icon: Lucide Video icon with pulse animation
- Text: "Drop your video here or click to browse"
- Subtext: "Supports MP4, WebM, MOV, AVI — Max 50MB"
- On file select: show video preview thumbnail using 
  URL.createObjectURL()
- Show file metadata: name, size, duration if available
- "Analyze Video" button — primary CTA

UPLOAD PROGRESS STATE:
- Replace upload zone with animated analysis card
- Show steps with animated checkmarks:
  ✓ Video uploaded successfully
  ⟳ Extracting frames for analysis...
  ⟳ Running AI detection models...
  ⟳ Building forensics report...
- Pulsing brain/scan icon during processing
- Estimated time remaining counter

REPORT DISPLAY (after analysis completes):
Show VideoForensicsReport component with:

1. VERDICT HERO SECTION:
   - Giant verdict badge centered:
     LIKELY_DEEPFAKE → full red background, 
                        glowing red border, skull icon
     SUSPICIOUS → amber background, warning icon
     INCONCLUSIVE → blue background, question icon
     LIKELY_AUTHENTIC → green background, shield icon
   - Large percentage: "87.3% AI Probability"
   - Risk level pill: HIGH / MEDIUM / LOW / MINIMAL
   - Animated confidence meter (circular arc gauge)

2. STATISTICS GRID (2x2 card grid):
   - Avg AI Probability across all frames
   - Max AI Probability (peak suspicion moment)
   - Suspicious Frames: "14 / 47 frames flagged"
   - Suspicious Frame %: "29.8% of video is suspicious"

3. FRAME TIMELINE CHART (using Recharts):
   - AreaChart showing AI probability over time
   - X-axis: timestamp in seconds
   - Y-axis: AI probability 0-100%
   - Area fill: gradient from transparent to red/green
     based on overall verdict
   - Red dashed horizontal line at 70% threshold
   - Tooltip on hover showing exact timestamp + probability
   - Suspicious peaks highlighted with red dot markers
   - Chart title: "AI Detection Probability — Frame by Frame"

4. INTERPRETATION PANEL:
   - Frosted glass card explaining the verdict in plain English
   - Icon: Lucide Info
   - "What does this mean?" header
   - 2-3 sentence plain English explanation based on verdict
   - Disclaimer: "This analysis is powered by Hive Moderation 
     API. Results should be combined with human judgment."

5. ACTION BUTTONS ROW:
   - "Analyze Another Video" — resets the form
   - "Download Report PDF" — browser print API
   - "Share Report" — copies public URL

CREATE: landing/components/VideoForensicsReport.jsx
Extract the report display into this reusable component.

PROPS:
interface VideoForensicsReportProps {
  report: {
    job_id: string;
    filename: string;
    verdict: string;
    verdict_label: string;
    risk_level: string;
    avg_ai_probability: number;
    max_ai_probability: number;
    suspicious_frame_count: number;
    total_frame_count: number;
    suspicious_frame_percentage: number;
    frame_timeline: Array<{
      timestamp_sec: number;
      ai_probability: number;
    }>;
  }
}

════════════════════════════════════════════════════════
FEATURE 2: CHROME EXTENSION OCR + FAKE NEWS CHECK
(Google Cloud Vision API + Existing Fact-Check Pipeline)
════════════════════════════════════════════════════════

OVERVIEW:
User right-clicks any image on any webpage inside Chrome,
selects "TruthScope: Read & Fact-Check Image Text".
The extension sends the image to Google Cloud Vision OCR,
extracts the text, then pipes it through TruthScope's existing
FastAPI fact-check pipeline. Results appear in the extension
popup with full claim verdicts.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1: MANIFEST.JSON — Add Permissions
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Update extension/manifest.json:
```json
{
  "manifest_version": 3,
  "name": "TruthScope",
  "version": "1.0.0",
  "description": "AI-powered fact-checking and deepfake detection",
  "permissions": [
    "activeTab",
    "contextMenus",
    "storage",
    "scripting"
  ],
  "host_permissions": [
    "https://*/*",
    "http://*/*",
    "https://vision.googleapis.com/*",
    "https://your-truthscope-api-url.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"]
    }
  ]
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2: BACKGROUND.JS — Context Menu + OCR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File: extension/background.js
```javascript
const GOOGLE_VISION_API_KEY = 
  process.env.GOOGLE_VISION_API_KEY || 
  "YOUR_NEW_ROTATED_KEY_HERE";

const TRUTHSCOPE_API = 
  process.env.TRUTHSCOPE_API_URL || 
  "http://localhost:8000";

const VISION_API_URL = 
  `https://vision.googleapis.com/v1/images:annotate` +
  `?key=${GOOGLE_VISION_API_KEY}`;

// ── Create Context Menus on Install ──────────────────────
chrome.runtime.onInstalled.addListener(() => {
  
  // Right-click on image → OCR Fact Check
  chrome.contextMenus.create({
    id: "truthscope-ocr-image",
    title: "🔍 TruthScope: Read & Fact-Check Image Text",
    contexts: ["image"]
  });

  // Right-click on selected text → Direct Fact Check
  chrome.contextMenus.create({
    id: "truthscope-check-selection",
    title: "🛡️ TruthScope: Fact-Check Selected Text",
    contexts: ["selection"]
  });
  
  // Right-click on page → Analyze full page
  chrome.contextMenus.create({
    id: "truthscope-check-page",
    title: "📄 TruthScope: Analyze This Page",
    contexts: ["page"]
  });
});

// ── Handle Context Menu Clicks ────────────────────────────
chrome.contextMenus.onClicked.addListener(
  async (info, tab) => {

  if (info.menuItemId === "truthscope-ocr-image") {
    const imageUrl = info.srcUrl;
    if (!imageUrl) return;
    
    // Notify popup that OCR is starting
    await chrome.storage.local.set({
      currentTask: {
        type: "ocr_factcheck",
        status: "extracting_text",
        imageUrl: imageUrl,
        timestamp: Date.now()
      }
    });
    
    // Open popup to show progress
    chrome.action.openPopup().catch(() => {});
    
    // Run OCR → Fact Check pipeline
    await runOCRFactCheck(imageUrl, tab.id);
  }

  if (info.menuItemId === "truthscope-check-selection") {
    const text = info.selectionText;
    if (!text || text.trim().length < 10) return;
    
    await chrome.storage.local.set({
      currentTask: {
        type: "text_factcheck",
        status: "analyzing",
        inputText: text,
        timestamp: Date.now()
      }
    });
    
    chrome.action.openPopup().catch(() => {});
    await runTextFactCheck(text);
  }

  if (info.menuItemId === "truthscope-check-page") {
    const url = tab.url;
    await chrome.storage.local.set({
      currentTask: {
        type: "page_factcheck",
        status: "analyzing",
        pageUrl: url,
        timestamp: Date.now()
      }
    });
    chrome.action.openPopup().catch(() => {});
    await runPageFactCheck(url);
  }
});

// ── OCR → Fact Check Pipeline ─────────────────────────────
async function runOCRFactCheck(imageUrl, tabId) {
  try {
    
    // STEP 1: Fetch image as base64
    await updateTaskStatus("extracting_text", 
      "Reading text from image...");
    
    let base64Image;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      base64Image = await blobToBase64(blob);
      // Strip data URL prefix, keep only base64 data
      base64Image = base64Image.split(",")[1];
    } catch (fetchErr) {
      // If CORS blocks fetch, inject content script to fetch
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: fetchImageAsBase64,
        args: [imageUrl]
      });
      base64Image = results[0]?.result;
    }
    
    if (!base64Image) {
      throw new Error("Could not fetch image — CORS blocked");
    }
    
    // STEP 2: Send to Google Cloud Vision OCR
    await updateTaskStatus("extracting_text",
      "Extracting text with Google Vision OCR...");
    
    const visionPayload = {
      requests: [{
        image: { content: base64Image },
        features: [
          { type: "TEXT_DETECTION", maxResults: 1 },
          { type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }
        ]
      }]
    };
    
    const visionRes = await fetch(VISION_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(visionPayload)
    });
    
    const visionData = await visionRes.json();
    
    // Extract full text from Vision response
    const fullText = visionData
      ?.responses?.[0]
      ?.fullTextAnnotation
      ?.text || 
      visionData
      ?.responses?.[0]
      ?.textAnnotations?.[0]
      ?.description || "";
    
    if (!fullText || fullText.trim().length < 20) {
      await updateTaskStatus("error",
        "No readable text found in this image.");
      await chrome.storage.local.set({
        currentTask: {
          type: "ocr_factcheck",
          status: "no_text",
          imageUrl,
          extractedText: "",
          error: "No readable text detected in the image.",
          timestamp: Date.now()
        }
      });
      return;
    }
    
    // Store extracted text
    await chrome.storage.local.set({
      currentTask: {
        type: "ocr_factcheck",
        status: "text_extracted",
        imageUrl,
        extractedText: fullText.trim(),
        timestamp: Date.now()
      }
    });
    
    // STEP 3: Pipe extracted text into TruthScope fact-check
    await runTextFactCheck(fullText.trim(), imageUrl);
    
  } catch (error) {
    console.error("OCR Fact Check error:", error);
    await chrome.storage.local.set({
      currentTask: {
        type: "ocr_factcheck",
        status: "error",
        error: error.message,
        timestamp: Date.now()
      }
    });
  }
}

// ── Text Fact Check (shared by OCR + Selection) ────────────
async function runTextFactCheck(text, sourceUrl = null) {
  try {
    await updateTaskStatus("analyzing",
      "Extracting claims with Gemini AI...");
    
    // Get stored user auth from extension storage
    const { userId } = await chrome.storage.local.get("userId");
    
    const response = await fetch(
      `${TRUTHSCOPE_API}/analyze/text`, 
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          source_url: sourceUrl || "extension_ocr",
          user_id: userId || "anonymous",
          source: "extension"
        })
      }
    );
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const report = await response.json();
    
    // Store completed report for popup to display
    await chrome.storage.local.set({
      currentTask: {
        type: "ocr_factcheck",
        status: "complete",
        report: report,
        timestamp: Date.now()
      },
      lastReport: report
    });
    
  } catch (error) {
    await chrome.storage.local.set({
      currentTask: {
        type: "ocr_factcheck",
        status: "error",
        error: error.message,
        timestamp: Date.now()
      }
    });
  }
}

// ── Page Fact Check ────────────────────────────────────────
async function runPageFactCheck(url) {
  try {
    const { userId } = await chrome.storage.local.get("userId");
    
    const response = await fetch(
      `${TRUTHSCOPE_API}/analyze/url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url,
          user_id: userId || "anonymous",
          source: "extension"
        })
      }
    );
    
    const report = await response.json();
    
    await chrome.storage.local.set({
      currentTask: {
        type: "page_factcheck",
        status: "complete",
        report: report,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    await chrome.storage.local.set({
      currentTask: {
        type: "page_factcheck",
        status: "error",
        error: error.message,
        timestamp: Date.now()
      }
    });
  }
}

// ── Helper: Add text analysis endpoint to FastAPI ──────────
// NOTE: See backend section below for /analyze/text endpoint

// ── Helpers ───────────────────────────────────────────────
async function updateTaskStatus(status, message) {
  const current = await chrome.storage.local.get("currentTask");
  await chrome.storage.local.set({
    currentTask: {
      ...current.currentTask,
      status,
      statusMessage: message,
      lastUpdated: Date.now()
    }
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Injected into page context to bypass CORS
function fetchImageAsBase64(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3: EXTENSION POPUP UI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File: extension/popup/index.html + popup/popup.js + popup/popup.css

BUILD A COMPLETE POPUP UI with these states:

POPUP DIMENSIONS: 420px wide × 580px tall max

VISUAL DESIGN FOR POPUP:
- Background: #0A0A0F (matches web app)
- Fonts loaded inline: JetBrains Mono + Syne + DM Sans
  via Google Fonts @import in CSS
- Header bar: TruthScope logo left, 
  user avatar/login right (from chrome.storage)
- Bottom tab bar: 
  [🔍 Analyze] [📋 History] [⚙️ Settings]

STATE 1 — IDLE (default):
- Center: TruthScope shield icon with subtle glow
- Title: "TruthScope Active"
- Subtitle: "Right-click any image or text to fact-check"
- Quick action buttons:
  • "Analyze This Page" button
  • "Upload Image for Deepfake Check" button
- Recent check preview: last report mini-card

STATE 2 — LOADING/PROGRESS:
- Animated progress steps (vertical stepper):
  Each step has icon + label + status indicator
  
  For OCR flow:
  ① 📸 Capturing image           [DONE ✓]
  ② 🔤 Extracting text via OCR   [ACTIVE ⟳]
  ③ 🧠 Decomposing claims        [PENDING ○]
  ④ 🔍 Searching evidence        [PENDING ○]
  ⑤ ⚖️  Verifying each claim     [PENDING ○]
  ⑥ 📊 Building report           [PENDING ○]

  Steps animate: gray → spinning → green checkmark
  Current active step pulses
  
- Extracted text preview (if OCR step complete):
  Show first 200 chars of OCR text in monospace 
  gray box labeled "Extracted Text"
  
- Cancel button bottom

STATE 3 — COMPLETE (report ready):

SECTION A — OCR RESULT (if applicable):
  Collapsible card "Extracted Text"
  Shows full OCR text in scrollable monospace box
  "Copied from image" label with image thumbnail

SECTION B — VERDICT SUMMARY:
  Large credibility score circle (animated fill)
  Color: red(<40) amber(40-70) green(>70)
  Overall verdict badge: TRUE/FALSE/MISLEADING/UNVERIFIABLE
  Article/text title (truncated)

SECTION C — CLAIMS LIST (scrollable):
  Each claim card shows:
  - Claim text (2 lines truncated, expandable)
  - Verdict pill (color coded)
  - Confidence bar
  - Evidence count: "3 sources"
  - Expand button → shows evidence source list

SECTION D — ACTIONS:
  "View Full Report" → opens web app report page
  "Share" → copies link
  "Check Another" → resets state

STATE 4 — NO TEXT FOUND:
  Illustration of empty document
  "No readable text found in this image"
  Suggestion: "Try right-clicking a text-heavy screenshot"
  "Try Image Deepfake Check Instead" button

STATE 5 — ERROR:
  Red alert card with error message
  "Try Again" button
  "Report Issue" link

POLLING LOGIC in popup.js:
The popup polls chrome.storage.local every 500ms for 
currentTask updates, then re-renders the appropriate state.
Use a clean state machine pattern:
```javascript
const STATES = {
  IDLE: "idle",
  EXTRACTING: "extracting_text", 
  TEXT_EXTRACTED: "text_extracted",
  ANALYZING: "analyzing",
  COMPLETE: "complete",
  NO_TEXT: "no_text",
  ERROR: "error"
};

let pollingInterval = null;

function startPolling() {
  pollingInterval = setInterval(async () => {
    const { currentTask } = await 
      chrome.storage.local.get("currentTask");
    if (currentTask) {
      renderState(currentTask);
      if (currentTask.status === "complete" || 
          currentTask.status === "error" ||
          currentTask.status === "no_text") {
        stopPolling();
      }
    }
  }, 500);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function renderState(task) {
  // Switch between state views based on task.status
  // Update DOM elements to reflect current state
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4: FASTAPI — Add /analyze/text Endpoint
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add to landing/fact-check-api/main.py:
```python
class TextAnalysisRequest(BaseModel):
    text: str
    source_url: Optional[str] = "direct_text"
    user_id: str = "anonymous"
    source: str = "extension"

@app.post("/analyze/text")
async def analyze_text_endpoint(
    request: TextAnalysisRequest, 
    db: Session = Depends(get_db)
):
    """
    Accepts raw text (from OCR or selection),
    runs through the full claim extraction → 
    evidence search → verification pipeline.
    Returns structured fact-check report.
    """
    # Generate content hash for deduplication
    text_hash = hashlib.md5(
        request.text.strip().lower().encode()
    ).hexdigest()
    
    # Check cache
    existing = db.query(FactCheckReport).filter(
        FactCheckReport.url_hash == text_hash
    ).first()
    
    if existing:
        # Clone report for this user
        cached_report = json.loads(existing.report_json)
        new_record = FactCheckReport(
            job_id=str(uuid.uuid4()),
            url_hash=text_hash,
            user_id=request.user_id,
            source=request.source,
            report_json=existing.report_json,
            claims_json=existing.claims_json
        )
        db.add(new_record)
        db.commit()
        cached_report["cached"] = True
        return cached_report
    
    # Run full pipeline on new text
    # Use existing pipeline components:
    claims = await claim_extractor.extract_from_text(
        request.text
    )
    
    verified_claims = []
    for claim in claims:
        evidence = await search_agent.search(claim["text"])
        verdict = await verifier.verify(
            claim["text"], evidence
        )
        verified_claims.append({
            "claim_id": str(uuid.uuid4()),
            "claim_text": claim["text"],
            "verdict": verdict["verdict"],
            "confidence": verdict["confidence"],
            "evidence": evidence
        })
    
    report = report_builder.build(
        article_title=request.text[:100] + "...",
        article_url=request.source_url,
        claims=verified_claims
    )
    
    # Save to DB
    record = FactCheckReport(
        job_id=report["job_id"],
        url_hash=text_hash,
        user_id=request.user_id,
        source=request.source,
        report_json=json.dumps(report),
        claims_json=json.dumps(verified_claims)
    )
    db.add(record)
    db.commit()
    
    return report
```

Also update claim_extractor.py to support text input 
(not just URL scraping):
```python
async def extract_from_text(self, text: str) -> list:
    """
    Extract verifiable claims directly from raw text.
    Reuses same Gemini prompt as URL-based extraction,
    just skips the scraping step.
    """
    prompt = f"""
    You are an expert fact-checker. 
    Analyze the following text and extract all 
    individual, verifiable factual claims.
    
    Rules:
    - Each claim must be a single, standalone 
      verifiable statement
    - Ignore opinions, predictions, or vague statements
    - Return max 10 most important claims
    - Format as JSON array: 
      [{{"text": "claim here"}}, ...]
    
    Text to analyze:
    {text}
    
    Return ONLY the JSON array, no other text.
    """
    response = await self.gemini_client.generate(prompt)
    # Parse JSON from Gemini response
    # (reuse your existing JSON parsing logic)
    return self._parse_claims_json(response)
```

════════════════════════════════════════════════════════
GLOBAL AESTHETIC SYSTEM
(Apply consistently to all new UI components)
════════════════════════════════════════════════════════

CSS VARIABLES (add to global stylesheet):
:root {
  --bg-primary: #0A0A0F;
  --bg-secondary: #111118;
  --bg-card: rgba(255, 255, 255, 0.04);
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-active: rgba(255, 255, 255, 0.2);
  --text-primary: #F0F0F5;
  --text-muted: #8B8FA8;
  --text-dim: #4A4A5A;
  --accent-green: #00FF88;
  --accent-red: #FF3B5C;
  --accent-amber: #FFB800;
  --accent-blue: #4F8EF7;
  --accent-purple: #9B6DFF;
  --glow-green: 0 0 24px rgba(0, 255, 136, 0.35);
  --glow-red: 0 0 24px rgba(255, 59, 92, 0.35);
  --glow-amber: 0 0 24px rgba(255, 184, 0, 0.35);
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --smooth: cubic-bezier(0.4, 0, 0.2, 1);
}

GOOGLE FONTS TO IMPORT:
@import url('https://fonts.googleapis.com/css2?
  family=Syne:wght@400;600;700;800&
  family=JetBrains+Mono:wght@400;500;600&
  family=DM+Sans:wght@400;500;600&
  display=swap');

CARD STYLE (reuse everywhere):
.ts-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: all 0.2s var(--spring);
}
.ts-card:hover {
  border-color: var(--border-active);
}

VERDICT COLOR MAPPING:
TRUE          → var(--accent-green)  + var(--glow-green)
FALSE         → var(--accent-red)    + var(--glow-red)
MISLEADING    → var(--accent-amber)  + var(--glow-amber)
UNVERIFIABLE  → var(--text-muted)    (no glow)
LIKELY_DEEPFAKE  → var(--accent-red)
SUSPICIOUS       → var(--accent-amber)
INCONCLUSIVE     → var(--accent-blue)
LIKELY_AUTHENTIC → var(--accent-green)

LOADING SKELETON STYLE:
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-secondary) 25%,
    rgba(255,255,255,0.05) 50%,
    var(--bg-secondary) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

════════════════════════════════════════════════════════
COMPLETE DELIVERABLES CHECKLIST
════════════════════════════════════════════════════════

BACKEND FILES:
[ ] landing/fact-check-api/pipeline/video_analyzer.py
    (VideoAnalyzer class with Hive API integration)
[ ] landing/fact-check-api/main.py  
    (Add: POST /analyze/video, GET /analyze/video/{job_id},
     POST /analyze/text endpoints)
[ ] landing/fact-check-api/pipeline/claim_extractor.py
    (Add: extract_from_text() method)

FRONTEND — WEB APP FILES:
[ ] landing/app/media-check/page.jsx
    (Video upload page with drag-drop + report display)
[ ] landing/components/VideoForensicsReport.jsx
    (Reusable report component with Recharts timeline)

CHROME EXTENSION FILES:
[ ] extension/manifest.json
    (Updated permissions + content_scripts)
[ ] extension/background.js
    (Context menus + OCR pipeline + storage updates)
[ ] extension/content.js
    (Image fetch helper for CORS bypass)
[ ] extension/popup/index.html
    (Complete popup markup for all 5 states)
[ ] extension/popup/popup.js
    (State machine + polling + DOM rendering)
[ ] extension/popup/popup.css
    (Full dark theme styles matching TruthScope)

RULES FOR CODE OUTPUT:
- Build every file completely — zero placeholders or TODOs
- All async functions have try/catch error handling
- All loading states render skeleton UI, never blank
- All error states show descriptive user-friendly messages
- Mobile viewport handled in web app pages
- Extension popup is pixel-perfect at 420px width
- No console.log statements in production paths
- All API keys read from environment variables only —
  never hardcoded in source files
- Use your existing gemini_client.py wrapper for all 
  Gemini calls — do not create a new one
- Use your existing search_agent.py and verifier.py 
  for the /analyze/text pipeline — do not duplicate logic

Build each file sequentially in this order:
1. video_analyzer.py
2. main.py (updated endpoints)
3. claim_extractor.py (updated)
4. media-check/page.jsx
5. VideoForensicsReport.jsx
6. manifest.json
7. background.js
8. content.js
9. popup/index.html + popup.css + popup.js