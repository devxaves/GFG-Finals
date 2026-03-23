import os
import uuid
import json
import asyncio
import logging
import httpx
import hashlib
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

from pipeline.scraper import scrape_url
from pipeline.claim_extractor import extract_claims
from pipeline.search_agent import retrieve_evidence
from pipeline.verifier import verify_claims_batch
from pipeline.report_builder import build_report

from models.schemas import FactCheckRequest, TextDetectionRequest, MediaAnalysisRequest, ClaimReport, AIDetectionResult, ExtensionTextRequest, ExtensionSentimentRequest, ExtensionSentimentBiasResult
from utils.gemini_client import configure_gemini, get_gemini_model, generate_structured_content
from models.database import SessionLocal, FactCheckReport

load_dotenv()
configure_gemini()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TruthScope Fact & Claim Verification API",
    description="Backend API for the Fact Check and Claim Verification system.",
    version="1.0.0"
)

# Configure CORS for global access (required for Chrome Extension on any domain)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_jobs = {}
completed_reports = {}  # { job_id: { report: {...}, claims: [...], completed_at: "..." } }

@app.get("/api/fact-check/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "message": "Fact Check API is running."}

@app.post("/api/fact-check/start")
async def start_fact_check(request: FactCheckRequest):
    url_hash = None
    if request.input_type == "url":
        url_hash = hashlib.md5(request.content.encode('utf-8')).hexdigest()
        
        # Check DB for cached report to prevent re-running full pipeline
        if SessionLocal:
            db = SessionLocal()
            try:
                cached_report = db.query(FactCheckReport).filter(FactCheckReport.url_hash == url_hash).first()
                if cached_report:
                    logger.info(f"⚡ Returning cached report for URL: {request.content}")
                    
                    # If this user hasn't explicitly saved this to their history, copy it over!
                    has_user_cache = False
                    if getattr(request, 'user_id', None):
                        has_user_cache = db.query(FactCheckReport).filter(
                            FactCheckReport.url_hash == url_hash,
                            FactCheckReport.user_id == request.user_id
                        ).first() is not None
                        
                    if getattr(request, 'user_id', None) and not has_user_cache:
                        new_job_id = f"job_{uuid.uuid4().hex}"
                        duplicate_report = FactCheckReport(
                            job_id=new_job_id,
                            user_id=request.user_id,
                            source="website",
                            input_type=cached_report.input_type,
                            input_content=cached_report.input_content,
                            url_hash=cached_report.url_hash,
                            report_json=cached_report.report_json,
                            claims_json=cached_report.claims_json,
                            overall_score=cached_report.overall_score,
                            total_claims=cached_report.total_claims
                        )
                        db.add(duplicate_report)
                        db.commit()
                        return {"job_id": new_job_id, "cached": True}
                        
                    return {"job_id": cached_report.job_id, "cached": True}
            except Exception as e:
                logger.error(f"DB Error checking cache in start_fact_check: {e}")
            finally:
                db.close()

    job_id = f"job_{uuid.uuid4().hex}"
    active_jobs[job_id] = {
        "input_type": request.input_type,
        "content": request.content,
        "user_id": getattr(request, 'user_id', None),
        "url_hash": url_hash
    }
    return {"job_id": job_id, "cached": False}

async def fact_check_generator(job_id: str):
    if job_id not in active_jobs:
        yield f"event: error\ndata: {json.dumps({'message': 'Invalid job ID', 'recoverable': False})}\n\n"
        return
        
    job_data = active_jobs.pop(job_id)
    input_type = job_data["input_type"]
    content = job_data["content"]
    
    from typing import Optional
    queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
    
    async def pipeline_worker():
        try:
            # Thinking events stream the AI's thought process to the frontend
            async def think(icon: str, label: str, detail: str = ""):
                await queue.put(f"event: thinking\ndata: {json.dumps({'icon': icon, 'label': label, 'detail': detail})}\n\n")

            await think("sparkles", "Initializing TruthScope Analysis Engine", "Loading NLP models and search indices...")
            await queue.put(f"event: stage\ndata: {json.dumps({'stage': 'extracting', 'message': 'Parsing input and extracting claims...'})}\n\n")
            text_to_analyze = content
            source_domain = None
            if input_type == "url":
                from urllib.parse import urlparse
                try:
                    parsed = urlparse(content)
                    if parsed.netloc:
                        source_domain = parsed.netloc.replace("www.", "")
                except Exception:
                    pass
                await think("globe", f"Scraping article from URL", f"GET {content[:80]}...")
                try:
                    text_to_analyze = await asyncio.to_thread(scrape_url, content)
                except Exception as e:
                    await queue.put(f"event: error\ndata: {json.dumps({'message': f'Failed to scrape URL: {e}. Please paste text directly.', 'recoverable': False})}\n\n")
                    return
                await think("file-text", f"Article scraped successfully", f"{len(text_to_analyze)} characters extracted")
            else:
                await think("file-text", "Processing raw text input", f"{len(text_to_analyze)} characters received")

            await think("brain", "Running NLP claim extraction", "Identifying verifiable factual claims...")
            extraction_result = await asyncio.to_thread(extract_claims, text_to_analyze)
            claims = extraction_result.claims
            await think("list-checks", f"Extracted {len(claims)} claims from text", f"Claims identified and ready for verification")
            
            await queue.put(f"event: stage\ndata: {json.dumps({'stage': 'gathering_evidence', 'message': f'Found {len(claims)} claims. Gathering evidence...'})}\n\n")
            
            claim_reports = [ClaimReport(claim=c) for c in claims]
            
            async def get_ev(cr: ClaimReport, idx: int):
                try:
                    await think("search", f"Searching evidence for Claim #{idx+1}", f'"{cr.claim.claim_text[:60]}..."')
                    await queue.put(f"event: claim_update\ndata: {json.dumps({'claim_id': cr.claim.id, 'status': 'searching'})}\n\n")
                    evidence = await retrieve_evidence(cr.claim, exclude_domain=source_domain, on_think=think)
                    cr.evidence = evidence
                    await queue.put(f"event: claim_update\ndata: {json.dumps({'claim_id': cr.claim.id, 'status': 'verifying'})}\n\n")
                    return cr.claim.id, evidence
                except Exception as ex:
                    logger.error(f"Error getting evidence for {cr.claim.id}: {ex}")
                    await think("alert-triangle", f"Evidence search failed for Claim #{idx+1}", str(ex)[:80])
                    return cr.claim.id, []
                    
            # Fetch all evidence concurrently using Tavily (no LLM, no rate limits)
            ev_list = await asyncio.gather(*(get_ev(cr, i) for i, cr in enumerate(claim_reports)))
            all_evidence = dict(ev_list)
            
            total_sources = sum(len(v) for v in all_evidence.values())
            await think("shield-check", f"Cross-referencing {total_sources} sources total", "Preparing batch verification with Gemini AI...")
            
            from models.schemas import VerificationResult
            # Verify all claims in a single LLM request (Batching)
            await think("cpu", "Verifying claims with Gemini AI", f"Batch processing {len(claims)} claims against evidence...")
            batch_result = await asyncio.to_thread(verify_claims_batch, claims, all_evidence)
            await think("check-circle", "AI verification complete", "All claims have been analyzed and scored")
            
            # Repopulate and stream the updates
            for cr in claim_reports:
                res = batch_result.get(cr.claim.id)
                if res:
                    cr.verification = VerificationResult(
                        verdict=res.verdict,
                        confidence_score=res.confidence_score,
                        reasoning=res.reasoning,
                        citations=res.citations
                    )
                await queue.put(f"event: claim_update\ndata: {json.dumps({'claim_id': cr.claim.id, 'status': 'done', 'result': cr.model_dump(mode='json')})}\n\n")
            
            await think("bar-chart", "Building accuracy report", "Calculating overall credibility score...")
            final_report = build_report(claim_reports)
            await think("sparkles", f"Analysis Complete — Score: {final_report.overall_score}%", "Report ready for review")
            
            # Save completed report for shared links & history (Legacy in-memory fallback)
            from datetime import datetime
            completed_reports[job_id] = {
                "report": final_report.model_dump(mode='json'),
                "claims": {cr.claim.id: {'status': 'done', 'result': cr.model_dump(mode='json')} for cr in claim_reports},
                "completed_at": datetime.utcnow().isoformat() + "Z",
                "input_content": content[:200] if content else ""
            }
            
            # DB PERSISTENCE
            if SessionLocal:
                db = SessionLocal()
                try:
                    db_report = FactCheckReport(
                        job_id=job_id,
                        user_id=job_data.get("user_id"),
                        source="website",
                        input_type=input_type,
                        input_content=content[:500] if content else "",
                        url_hash=job_data.get("url_hash"),
                        report_json=json.dumps(final_report.model_dump(mode='json')),
                        claims_json=json.dumps({cr.claim.id: {'status': 'done', 'result': cr.model_dump(mode='json')} for cr in claim_reports}),
                        overall_score=final_report.overall_score,
                        total_claims=len(claims)
                    )
                    db.add(db_report)
                    db.commit()
                    logger.info(f"💾 Saved report {job_id} to DB")
                except Exception as db_e:
                    logger.error(f"Failed to save {job_id} to DB: {db_e}")
                    db.rollback()
                finally:
                    db.close()
            else:
                logger.info(f"Saved completed report for job {job_id} (Memory Only)")
            
            await queue.put(f"event: complete\ndata: {json.dumps({'report': final_report.model_dump(mode='json')})}\n\n")
            
        except Exception as e:
            logger.error(f"Pipeline error for job {job_id}: {e}", exc_info=True)
            await queue.put(f"event: error\ndata: {json.dumps({'message': str(e), 'recoverable': False})}\n\n")
        finally:
            await queue.put(None)
            
    # Start worker task
    task = asyncio.create_task(pipeline_worker())
    
    while True:
        msg = await queue.get()
        if msg is None:
            break
        yield msg

@app.get("/api/fact-check/stream/{job_id}")
async def stream_report(job_id: str):
    return StreamingResponse(fact_check_generator(job_id), media_type="text/event-stream")

from typing import Optional

@app.get("/api/fact-check/report/{job_id}")
async def get_saved_report(job_id: str):
    """Retrieve a previously completed report by job ID (for shared links)."""
    if SessionLocal:
        db = SessionLocal()
        try:
            db_report = db.query(FactCheckReport).filter(FactCheckReport.job_id == job_id).first()
            if db_report:
                return {
                    "report": json.loads(db_report.report_json) if db_report.report_json else {},
                    "claims": json.loads(db_report.claims_json) if db_report.claims_json else {},
                    "completed_at": db_report.created_at.isoformat() + "Z",
                    "input_content": db_report.input_content,
                    "cached": True
                }
        except Exception as e:
            logger.error(f"Error fetching report {job_id} from DB: {e}")
        finally:
            db.close()
            
    # Fallback to local memory dictionary
    if job_id in completed_reports:
        return completed_reports[job_id]
        
    return {"error": "Report not found in database or memory."}

@app.get("/api/fact-check/history")
async def get_history(user_id: Optional[str] = None):
    """Return a list of all completed reports for the history page."""
    history = []
    
    if SessionLocal:
        db = SessionLocal()
        try:
            query = db.query(FactCheckReport)
            if user_id:
                query = query.filter(FactCheckReport.user_id == user_id)
                
            # Fetch latest 100 reports ordered by date
            db_reports = query.order_by(FactCheckReport.created_at.desc()).limit(100).all()
            for r in db_reports:
                try:
                    report_data = json.loads(r.report_json) if r.report_json else {}
                    history.append({
                        "id": r.job_id,
                        "title": r.input_content[:100] if r.input_content else "Untitled Analysis",
                        "overallScore": r.overall_score or 0,
                        "claimCount": r.total_claims or 0,
                        "verdictBreakdown": report_data.get("breakdown_by_verdict", {}),
                        "completedAt": r.created_at.isoformat() + "Z",
                        "source": r.source
                    })
                except Exception as json_e:
                    logger.warning(f"Failed parsing JSON for job {r.job_id}: {json_e}")
            
            return {"history": history}
        except Exception as e:
            logger.error(f"Error fetching history from DB: {e}")
        finally:
            db.close()

    # Fallback to local memory if DB fails
    for job_id, data in completed_reports.items():
        report = data.get("report", {})
        history.append({
            "id": job_id,
            "title": data.get("input_content", "Untitled Analysis")[:100],
            "overallScore": report.get("overall_score", 0),
            "claimCount": report.get("total_claims", 0),
            "verdictBreakdown": report.get("breakdown_by_verdict", {}),
            "completedAt": data.get("completed_at", "")
        })
    history.reverse()
    return {"history": history}

@app.post("/api/detect-ai-text", response_model=AIDetectionResult)
async def detect_ai_text(request: TextDetectionRequest):
    model = get_gemini_model(system_instruction="""You are an AI-generated text classifier. Analyze
the following text for indicators of LLM generation:
Unnaturally uniform sentence length
Absence of stylistic quirks or errors
Overuse of transitional phrases
Generic, non-specific language
Lack of personal voice or anecdote

Provide a probability score (0-100) that this text was AI-generated, with specific indicators found.
Output ONLY valid JSON matching the schema.""")
    if not model:
        return AIDetectionResult(ai_generated_probability=0, indicators=["Gemini model unavailable."])
        
    prompt = f"Text: {request.text}"
    try:
        result = await asyncio.to_thread(generate_structured_content, model, prompt, AIDetectionResult)
        return result
    except Exception as e:
        logger.error(f"AI Detection failed: {e}")
        return AIDetectionResult(ai_generated_probability=0, indicators=[str(e)])

@app.post("/api/analyze-media")
async def analyze_media(request: MediaAnalysisRequest, req: Request):
    """Analyze the image strictly using Hugging Face Inference API using the official SDK."""
    hf_api_key = os.getenv("HUGGINGFACE_API_KEY")
    if not hf_api_key:
        return {"status": "error", "error": "HUGGINGFACE_API_KEY is not configured in the backend."}
        
    try:
        def perform_inference():
            client = InferenceClient(
                provider="hf-inference",
                api_key=hf_api_key
            )
            return client.image_classification(request.media_url, model="umm-maybe/AI-image-detector")
            
        predictions = await asyncio.to_thread(perform_inference)
        
        # Predictions format: [ClassificationOutput(label='artificial', score=0.99), ...]
        artificial_score = 0.0
        for p in predictions:
            # Handle both class object and dict formats for robust version support
            label = getattr(p, 'label', None)
            if label is None and isinstance(p, dict):
                label = p.get('label')
            
            score = getattr(p, 'score', None)
            if score is None and isinstance(p, dict):
                score = p.get('score', 0.0)
                
            if label == "artificial":
                artificial_score = score
                
        status_summary = f"Analyzed using AI-image-detector ({int(artificial_score * 100)}% likely AI)."
        
        return {
            "status": "success",
            "mediaType": "image",
            "manipulation_confidence": artificial_score,
            "summary": status_summary
        }
    except Exception as e:
        logger.error(f"Media analysis failed: {e}")
        return {"status": "error", "error": str(e)}

@app.post("/api/extension/analyze-text")
async def extension_analyze_text(request: ExtensionTextRequest):
    content = request.article_text
    
    # [1] FAST CACHE RETRIEVAL
    url_hash = None
    if request.url:
        import hashlib
        from models.database import SessionLocal, FactCheckReport
        if SessionLocal:
            try:
                url_hash = hashlib.md5(request.url.encode('utf-8')).hexdigest()
                db = SessionLocal()
                # Check unified FactCheckReport table
                cached = await asyncio.to_thread(lambda: db.query(FactCheckReport).filter(FactCheckReport.url_hash == url_hash).first())
                if cached:
                    logger.info(f"⚡ EXTENSION CACHE HIT! Served from FactCheckReport: {request.url}")
                    
                    # Store a duplicate for this extension user's history!
                    try:
                        has_user_cache = False
                        if getattr(request, 'user_id', None):
                            has_user_cache = db.query(FactCheckReport).filter(
                                FactCheckReport.url_hash == url_hash,
                                FactCheckReport.user_id == request.user_id
                            ).first() is not None
                            
                        if getattr(request, 'user_id', None) and not has_user_cache:
                            new_ext_job_id = f"ext_{uuid.uuid4().hex}"
                            duplicate_report = FactCheckReport(
                                job_id=new_ext_job_id,
                                user_id=request.user_id,
                                source="extension",
                                input_type=cached.input_type,
                                input_content=cached.input_content,
                                url_hash=cached.url_hash,
                                report_json=cached.report_json,
                                claims_json=cached.claims_json,
                                overall_score=cached.overall_score,
                                total_claims=cached.total_claims
                            )
                            db.add(duplicate_report)
                            db.commit()
                            logger.info(f"💾 Added cache hit to extension user's history")
                    except Exception as e:
                        logger.error(f"Failed to duplicate cache for user: {e}")
                    
                    db.close()
                    
                    # Reconstruct extension response format from unified db schema
                    try:
                        report_data = json.loads(cached.report_json)
                        claims_data = json.loads(cached.claims_json) if cached.claims_json else {}
                        
                        # Just wrap it to pass the extension UI requirements
                        return {
                            "textResult": {
                                "overall_score": report_data.get("overall_score", 0),
                                "total_claims": report_data.get("total_claims", 0),
                                "breakdown_by_verdict": report_data.get("breakdown_by_verdict", {}),
                                "label_0": "LABEL_0", # legacy compat 
                                "confidence": 1.0, # legacy compat
                            },
                            "fact_checks": [v.get('result', {}) for v in claims_data.values()],
                            "job_id": cached.job_id
                        }
                    except Exception as json_e:
                        logger.error(f"Failed parsing unified cache for extension: {json_e}")
                else:
                    db.close()
            except Exception as e:
                logger.error(f"Unified extension cache lookup failed: {e}")
                try:
                    db.close()
                except:
                    pass
    
    
    # Refine/truncate large raw HTML/text locally to prevent LLM token limits
    if content and len(content) > 10000:
        content = content[:10000] + "\n...[truncated for analysis]"
    
    source_domain = None
    if request.url:
        from urllib.parse import urlparse
        try:
            parsed = urlparse(request.url)
            if parsed.netloc:
                source_domain = parsed.netloc.replace("www.", "")
        except Exception:
            pass
            
    try:
        extraction_result = await asyncio.to_thread(extract_claims, content)
        claims = extraction_result.claims
        claim_reports = [ClaimReport(claim=c) for c in claims]
        
        async def get_ev(cr: ClaimReport):
            try:
                evidence = await retrieve_evidence(cr.claim, exclude_domain=source_domain)
                cr.evidence = evidence
                return cr.claim.id, evidence
            except Exception as ex:
                return cr.claim.id, []
                
        # Fetch all evidence concurrently using Tavily
        ev_list = await asyncio.gather(*(get_ev(cr) for cr in claim_reports))
        all_evidence = dict(ev_list)
        
        # Verify all claims in a single LLM request (Batching)
        batch_result = await asyncio.to_thread(verify_claims_batch, claims, all_evidence)
        
        for cr in claim_reports:
            res = batch_result.get(cr.claim.id)
            if res:
                from models.schemas import VerificationResult
                cr.verification = VerificationResult(
                    verdict=res.verdict,
                    confidence_score=res.confidence_score,
                    reasoning=res.reasoning,
                    citations=res.citations
                )
        
        final_report = build_report(claim_reports)
        
        # Determine the label based on TruthScope's old schema logic 
        # (LABEL_1 = fake, LABEL_0 = real)
        is_fake = final_report.overall_score < 70
        label = "LABEL_1" if is_fake else "LABEL_0"
        
        # Calculate a 0.0-1.0 confidence score
        confidence_metric = (100 - final_report.overall_score) / 100.0 if is_fake else (final_report.overall_score) / 100.0
        
        reasoning_list = []
        highlights = []
        fact_checks = []
        related_news = []
        seen_urls = set()
        
        for cr in claim_reports:
            url_to_title = {}
            # Build related news from evidence
            if cr.evidence:
                for ev in cr.evidence:
                    url = ev.source_url
                    display_title = getattr(ev, 'title', "")
                    if not display_title:
                        display_title = f"{ev.domain} Article"
                    
                    if url:
                        url_to_title[url] = display_title
                        
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        related_news.append({
                            "title": display_title,
                            "source": ev.domain,
                            "url": url
                        })

            if cr.verification:
                if cr.verification.verdict in ["FALSE", "PARTIALLY_TRUE", "CONFLICTING"]:
                    # CRITICAL: Append context_snippet so the UI can physically match and highlight the EXACT text
                    highlights.append(cr.claim.context_snippet)
                    reasoning_list.append(f"Regarding '{cr.claim.claim_text}': {cr.verification.reasoning}")
                elif cr.verification.verdict == "TRUE" and not is_fake:
                    reasoning_list.append(f"Verified: {cr.claim.claim_text}")
                
                for cit in cr.verification.citations:
                    # Look up the actual news heading from Tavily results using the URL
                    real_title = url_to_title.get(cit.url, "")
                    if not real_title or "Article" in real_title:
                        real_title = cit.supporting_snippet[:60] + "..." if cit.supporting_snippet else f"{cit.domain} Source"

                    fact_checks.append({
                        "source": cit.domain,
                        "title": real_title,
                        "url": cit.url,
                        "claim": cr.claim.claim_text,
                        "rating": cr.verification.verdict
                    })
        
        if not reasoning_list:
            reasoning_list = ["The claims align with verified information and no significant contradictions were found."]
            
        response_data = {
            "textResult": {
                "label": label,
                "score": max(0.5, confidence_metric), 
                "highlights": highlights,
                "reasoning": reasoning_list,
                "educational_insights": ["Always review sources independently to verify extreme claims.", "Check the provided citations for full context."],
                "fact_check": fact_checks,
                "related_news": related_news
            }
        }
        
        # Save to completed_reports for History page + Shareable links
        from datetime import datetime
        ext_job_id = f"job_{uuid.uuid4().hex}"
        completed_reports[ext_job_id] = {
            "report": final_report.model_dump(mode='json'),
            "claims": {cr.claim.id: {'status': 'done', 'result': cr.model_dump(mode='json')} for cr in claim_reports},
            "completed_at": datetime.utcnow().isoformat() + "Z",
            "input_content": (request.url or content[:200]) if content else "Extension Analysis",
            "source": "extension"
        }
        logger.info(f"Saved extension analysis to history as {ext_job_id}")
        
        # [2] SAVE RESPONSE TO CACHE
        if request.url:
            import hashlib
            from models.database import SessionLocal, FactCheckReport
            if SessionLocal:
                try:
                    url_hash = hashlib.md5(request.url.encode('utf-8')).hexdigest()
                    db = SessionLocal()
                    
                    def perform_db_save():
                        existing = db.query(FactCheckReport).filter(FactCheckReport.url_hash == url_hash).first()
                        if not existing:
                            # We format this exactly like the website report schema to keep things unified
                            new_cache = FactCheckReport(
                                job_id=ext_job_id,
                                user_id=request.user_id,
                                source="extension",
                                input_type="url",
                                input_content=request.url,
                                url_hash=url_hash,
                                report_json=json.dumps(final_report.model_dump(mode='json')),
                                claims_json=json.dumps({cr.claim.id: {'status': 'done', 'result': cr.model_dump(mode='json')} for cr in claim_reports}),
                                overall_score=final_report.overall_score,
                                total_claims=len(claims)
                            )
                            db.add(new_cache)
                            db.commit()
                            
                    await asyncio.to_thread(perform_db_save)
                    db.close()
                    logger.info(f"💾 Saved extension analysis to DB FactCheckReport: {request.url}")
                except Exception as e:
                    logger.error(f"Failed to save to database cache: {e}")
                    
        return response_data
    except Exception as e:
        logger.error(f"Extension text analysis failed: {e}")
        return {"textResult": {"error": str(e)}}

@app.post("/api/extension/analyze-sentiment", response_model=ExtensionSentimentBiasResult)
async def extension_analyze_sentiment(request: ExtensionSentimentRequest):
    model = get_gemini_model(system_instruction="""You are a Sentiment and Bias classifier.
Analyze the following text for its primary sentiment (positive, negative, or neutral) and potential bias.
Return ONLY valid JSON matching the exact schema provided. Provide a summary of the bias and a list of specific indicators (e.g., 'loaded language', 'one-sided reporting').""")
    if not model:
        return ExtensionSentimentBiasResult(
            sentiment={"label": "neutral", "score": 0.0},
            bias={"summary": "Gemini model unavailable.", "indicators": []}
        )
        
    # Truncate locally before sending to LLM
    text_to_analyze = request.text
    if len(text_to_analyze) > 10000:
        text_to_analyze = text_to_analyze[:10000] + "..."
        
    prompt = f"Text to analyze: {text_to_analyze}"
    try:
        result = await asyncio.to_thread(generate_structured_content, model, prompt, ExtensionSentimentBiasResult)
        return result
    except Exception as e:
        logger.error(f"Sentiment Analysis failed: {e}")
        return ExtensionSentimentBiasResult(
            sentiment={"label": "neutral", "score": 0.0},
            bias={"summary": f"Analysis failed: {str(e)}", "indicators": []}
        )
