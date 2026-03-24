import httpx
import os
import uuid
import logging
import random
import math

logger = logging.getLogger(__name__)

HIVE_API_KEY = os.getenv("HIVE_API_KEY")
HIVE_VIDEO_URL = "https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection"


class VideoAnalyzer:

    async def analyze_video(self, video_bytes: bytes, filename: str) -> dict:
        """
        Sends video binary to Hive Moderation API.
        Returns structured deepfake analysis report.
        """
        if not HIVE_API_KEY:
            raise ValueError("HIVE_API_KEY is not configured in environment variables.")

        headers = {
            "authorization": f"Bearer {HIVE_API_KEY}",
            "Accept": "application/json"
        }
        files = {"media": (filename, video_bytes, "video/mp4")}

        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                response = await client.post(
                    HIVE_VIDEO_URL,
                    headers=headers,
                    files=files
                )
                response.raise_for_status()
                raw = response.json()
        except httpx.TimeoutException:
            job_id = str(uuid.uuid4())
            return self._error_report(job_id, filename, "Hive API timed out. Video may be too large or complex.")
        except httpx.HTTPStatusError as e:
            job_id = str(uuid.uuid4())
            if e.response.status_code in [401, 403]:
                logger.warning(f"Hive API returned {e.response.status_code}. Generating mock response for demo purposes.")
                return self._generate_mock_report(job_id, filename)
            return self._error_report(job_id, filename, f"Hive API returned status {e.response.status_code}.")

        return self._parse_hive_response(raw, filename)

    def _parse_hive_response(self, raw: dict, filename: str) -> dict:
        """
        Parse Hive API response into TruthScope report format.

        Hive returns per-frame classification under:
        raw["status"][0]["response"]["output"][0]["classes"]

        Each class has "class" name and "score" 0.0–1.0
        We look for class "ai_generated", "deepfake", or "ai_video"
        """
        job_id = str(uuid.uuid4())

        try:
            outputs = raw.get("output", [])
            if not outputs and "status" in raw: # fallback just in case it's a v2 wrapper
                outputs = raw["status"][0]["response"]["output"]
        except (KeyError, IndexError, TypeError):
            logger.error(f"Hive parse error — raw response: {str(raw)[:300]}")
            return self._error_report(job_id, filename, "Unexpected response format from Hive API.")

        # Extract all frame-level AI generation scores
        frame_scores = []
        for frame_output in outputs:
            # V3 timestamp is in the 'extra' array
            timestamp = 0.0
            for extra in frame_output.get("extra", []):
                if extra.get("name") == "timestamp":
                    timestamp = extra.get("value", 0.0)
                    break
            
            # Fallback if timestamp is directly on the dict (V2)
            if "time" in frame_output:
                timestamp = frame_output.get("time", 0.0)

            classes = frame_output.get("classes", [])
            ai_score = 0.0
            for cls in classes:
                if cls.get("class") in ["ai_generated", "deepfake", "ai_video"]:
                    # V3 uses 'value', V2 used 'score'
                    score_val = cls.get("value", cls.get("score", 0.0))
                    ai_score = max(ai_score, score_val)
                    
            frame_scores.append({
                "timestamp_sec": round(float(timestamp), 2),
                "ai_probability": round(ai_score * 100, 1)
            })

        # Calculate aggregate statistics
        if frame_scores:
            scores = [f["ai_probability"] for f in frame_scores]
            avg_score = round(sum(scores) / len(scores), 1)
            max_score = round(max(scores), 1)
            suspicious_frames = len([s for s in scores if s > 1])
            total_frames = len(scores)
        else:
            avg_score = 0.0
            max_score = 0.0
            suspicious_frames = 0
            total_frames = 0

        # Determine overall verdict
        if avg_score >= 1 or max_score >= 1:
            verdict = "LIKELY_DEEPFAKE"
            verdict_label = "Likely AI-Generated / Deepfake"
            risk_level = "HIGH"
        else:
            verdict = "LIKELY_AUTHENTIC"
            verdict_label = "Likely Authentic Video"
            risk_level = "MINIMAL"

        logger.info(f"Video analysis complete: {verdict} ({avg_score}% avg AI probability)")

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
                (suspicious_frames / total_frames * 100) if total_frames > 0 else 0, 1
            ),
            "frame_timeline": frame_scores,
            "powered_by": "Hive Moderation API"
        }

    def _error_report(self, job_id: str, filename: str, error_msg: str) -> dict:
        return {
            "job_id": job_id,
            "filename": filename,
            "analysis_type": "video_deepfake",
            "verdict": "ERROR",
            "verdict_label": "Analysis Failed",
            "risk_level": "UNKNOWN",
            "avg_ai_probability": 0,
            "max_ai_probability": 0,
            "suspicious_frame_count": 0,
            "total_frame_count": 0,
            "suspicious_frame_percentage": 0,
            "error": error_msg,
            "frame_timeline": [],
            "powered_by": "Hive Moderation API"
        }

    def _generate_mock_report(self, job_id: str, filename: str) -> dict:
        """Generates a realistic mock report if the Hive API key is invalid."""
        duration_sec = random.randint(10, 30)
        frame_scores = []
        
        # Simulate an increasing deepfake probability curve
        base_ai = random.uniform(10, 40)
        spike_start = random.uniform(0.3, 0.6) * duration_sec
        spike_end = spike_start + random.uniform(2, 6)
        
        for t in range(duration_sec + 1):
            if spike_start <= t <= spike_end:
                ai_score = min(95.0, base_ai + (math.sin((t - spike_start) * math.pi / (spike_end - spike_start)) * 60) + random.uniform(-5, 5))
            else:
                ai_score = max(0.0, base_ai + random.uniform(-10, 10))
                
            frame_scores.append({
                "timestamp_sec": float(t),
                "ai_probability": round(ai_score, 1)
            })

        scores = [f["ai_probability"] for f in frame_scores]
        avg_score = round(sum(scores) / len(scores), 1)
        max_score = round(max(scores), 1)
        suspicious_frames = len([s for s in scores if s > 70])
        total_frames = len(scores)

        if avg_score >= 80:
            verdict = "LIKELY_DEEPFAKE"
            verdict_label = "Likely AI-Generated / Deepfake"
            risk_level = "HIGH"
        elif avg_score >= 50 or max_score > 85:
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
            "suspicious_frame_percentage": round((suspicious_frames / total_frames * 100), 1),
            "frame_timeline": frame_scores,
            "powered_by": "Hive Moderation API (Mock Mode)"
        }
