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
            
            # --- SUSPICIOUS DOMAIN CHECK ---
            if source_domain and SessionLocal:
                db = SessionLocal()
                try:
                    from models.database import SuspiciousDomain
                    is_fake = db.query(SuspiciousDomain).filter(SuspiciousDomain.domain == source_domain).first()
                    base_domain = f"{source_domain.split('.')[-2]}.{source_domain.split('.')[-1]}" if len(source_domain.split('.')) >= 2 else source_domain
                    if not is_fake:
                        is_fake = db.query(SuspiciousDomain).filter(SuspiciousDomain.domain == base_domain).first()
                        
                    hardcoded_fakes = {"theonion.com": "Satire", "babylonbee.com": "Satire", "infowars.com": "Conspiracy/Fake News"}
                    fake_reason = (is_fake.reason if is_fake else None) or hardcoded_fakes.get(base_domain)
                    
                    if fake_reason:
                        await think("alert-triangle", "Suspicious Domain Detected", f"Domain '{base_domain}' is flagged as {fake_reason}.")
                        final_report.article_title = f"[WARNING: {fake_reason.upper()} SOURCE] " + (final_report.article_title or "")
                        final_report.summary = f"⚠️ WARNING: This article originates from {base_domain}, a known {fake_reason} domain. Please evaluate the following claims with strong caution, even if some individual statements are factually accurate.\n\n" + (final_report.summary or "")
                except Exception as e:
                    logger.error(f"Error checking suspicious domains: {e}")
                finally:
                    db.close()
            # -------------------------------
            
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
Lack of personal voice or anecdotes

Provide a probability score (0-100) that this text was AI-generated, with specific indicators found.
IMPORTANT: You MUST detect the language of the provided text and write the `indicators` in that EXACT SAME language.
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
                        
                        overall_score = report_data.get("overall_score", 0)
                        is_fake = overall_score < 70
                        label = "LABEL_1" if is_fake else "LABEL_0"
                        confidence_metric = (100 - overall_score) / 100.0 if is_fake else overall_score / 100.0
                        
                        # Rebuild highlights, reasoning, and related news from claims
                        highlights = []
                        reasoning_list = []
                        fact_checks = []
                        related_news = []
                        seen_urls = set()
                        
                        for claim_id, data in claims_data.items():
                            cr_result = data.get("result", {})
                            claim_obj = cr_result.get("claim", {})
                            verification = cr_result.get("verification", {})
                            evidence_list = cr_result.get("evidence", [])
                            
                            if evidence_list:
                                for ev in evidence_list:
                                    url = ev.get("source_url")
                                    if url and url not in seen_urls:
                                        seen_urls.add(url)
                                        related_news.append({
                                            "title": ev.get("title") or f"{ev.get('domain')} Article",
                                            "source": ev.get("domain"),
                                            "url": url
                                        })
                                        
                            if verification:
                                verdict = verification.get("verdict")
                                if verdict in ["FALSE", "PARTIALLY_TRUE", "CONFLICTING"]:
                                    if claim_obj.get("context_snippet"):
                                        highlights.append(claim_obj.get("context_snippet"))
                                    reasoning_list.append(f"Regarding '{claim_obj.get('claim_text')}': {verification.get('reasoning')}")
                                elif verdict == "TRUE" and not is_fake:
                                    reasoning_list.append(f"Verified: {claim_obj.get('claim_text')}")
                                
                                for cit in verification.get("citations", []):
                                    fact_checks.append({
                                        "source": cit.get("domain"),
                                        "url": cit.get("url"),
                                        "headline": cit.get("supporting_snippet", "")[:60] + "...",
                                        "verdict": verdict
                                    })
                        
                        # Wrap it in the exact structure expected by the extension
                        return {
                            "textResult": {
                                "label": label,
                                "score": confidence_metric,
                                "overall_score": overall_score,
                                "total_claims": report_data.get("total_claims", 0),
                                "breakdown_by_verdict": report_data.get("breakdown_by_verdict", {}),
                                "reasoning": reasoning_list,
                                "highlights": highlights,
                                "fact_check": fact_checks,
                                "related_news": related_news
                            },
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
    
    if not content and request.url:
        try:
            from utils.web_scraper import scrape_url
            content = await asyncio.to_thread(scrape_url, request.url)
        except Exception as e:
            logger.error(f"Failed to scrape URL for extension: {e}")
            content = ""
            
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
IMPORTANT: You MUST detect the language of the provided text and write the `summary` and `indicators` in that EXACT SAME language.
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

# ==========================================
# VIDEO DEEPFAKE DETECTION ENDPOINT
# ==========================================

from fastapi import UploadFile, File, Form
from pipeline.video_analyzer import VideoAnalyzer

_video_analyzer = VideoAnalyzer()

@app.post("/analyze/video")
async def analyze_video_endpoint(
    video: UploadFile = File(...),
    user_id: str = Form(default="anonymous")
):
    """
    Accepts video file upload, runs Hive deepfake analysis.
    Stores result in FactCheckReport table. Returns forensics report.
    """
    allowed_types = ["video/mp4", "video/webm", "video/quicktime", "video/avi", "video/x-msvideo"]
    if video.content_type not in allowed_types:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format. Allowed: mp4, webm, mov, avi"
        )

    video_bytes = await video.read()
    if len(video_bytes) > 50 * 1024 * 1024:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=413,
            detail="Video too large. Maximum size is 50MB."
        )

    report = await _video_analyzer.analyze_video(video_bytes, video.filename or "upload.mp4")

    if SessionLocal:
        db = SessionLocal()
        try:
            db_record = FactCheckReport(
                job_id=report["job_id"],
                user_id=user_id,
                source="website_video",
                input_type="video",
                input_content=video.filename or "upload.mp4",
                url_hash=hashlib.md5((video.filename or "upload.mp4").encode()).hexdigest(),
                report_json=json.dumps(report),
                claims_json=json.dumps([]),
                overall_score=int(100 - report.get("avg_ai_probability", 0)),
                total_claims=0
            )
            db.add(db_record)
            db.commit()
            logger.info(f"Saved video analysis {report['job_id']} to DB")
        except Exception as db_e:
            logger.error(f"Failed to save video report to DB: {db_e}")
            db.rollback()
        finally:
            db.close()

    return report


@app.get("/analyze/video/{job_id}")
async def get_video_report(job_id: str):
    """Fetch a previously analyzed video report by job_id."""
    if SessionLocal:
        db = SessionLocal()
        try:
            record = db.query(FactCheckReport).filter(
                FactCheckReport.job_id == job_id
            ).first()
            if record:
                return json.loads(record.report_json)
        except Exception as e:
            logger.error(f"Error fetching video report {job_id}: {e}")
        finally:
            db.close()

    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Video report not found")


# ==========================================
# TEXT ANALYSIS ENDPOINT (for Extension OCR)
# ==========================================

from pydantic import BaseModel as _BaseModel

class TextAnalysisRequest(_BaseModel):
    text: str
    source_url: str = "direct_text"
    user_id: str = "anonymous"
    source: str = "extension"


@app.post("/analyze/text")
async def analyze_text_endpoint(request: TextAnalysisRequest):
    """
    Accepts raw text (from OCR or selection), runs the full claim extraction
    → evidence search → verification pipeline. Returns structured fact-check report.
    Used by the Chrome extension OCR and selection fact-check flows.
    """
    from pipeline.claim_extractor import extract_from_text as _extract_from_text

    text = request.text.strip()
    if not text or len(text) < 20:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Text is too short to fact-check (minimum 20 characters).")

    # Truncate to prevent LLM token limits
    if len(text) > 10000:
        text = text[:10000] + "\n...[truncated for analysis]"

    text_hash = hashlib.md5(text.lower().encode()).hexdigest()

    # Check cache
    if SessionLocal:
        db = SessionLocal()
        try:
            cached = db.query(FactCheckReport).filter(
                FactCheckReport.url_hash == text_hash
            ).first()
            if cached:
                cached_report = json.loads(cached.report_json)
                # Clone for this user's history
                if request.user_id and request.user_id != "anonymous":
                    has_user = db.query(FactCheckReport).filter(
                        FactCheckReport.url_hash == text_hash,
                        FactCheckReport.user_id == request.user_id
                    ).first()
                    if not has_user:
                        clone = FactCheckReport(
                            job_id=f"job_{uuid.uuid4().hex}",
                            user_id=request.user_id,
                            source=request.source,
                            input_type="text",
                            input_content=request.text[:500],
                            url_hash=text_hash,
                            report_json=cached.report_json,
                            claims_json=cached.claims_json,
                            overall_score=cached.overall_score,
                            total_claims=cached.total_claims
                        )
                        db.add(clone)
                        db.commit()
                cached_report["cached"] = True
                db.close()
                return cached_report
        except Exception as e:
            logger.error(f"Cache lookup failed for /analyze/text: {e}")
        finally:
            try:
                db.close()
            except Exception:
                pass

    # Run full pipeline
    try:
        extraction_result = await asyncio.to_thread(
            __import__('pipeline.claim_extractor', fromlist=['extract_claims']).extract_claims, text
        )
        claims = extraction_result.claims
        claim_reports = [ClaimReport(claim=c) for c in claims]

        async def get_ev(cr: ClaimReport):
            try:
                evidence = await retrieve_evidence(cr.claim, exclude_domain=None)
                cr.evidence = evidence
                return cr.claim.id, evidence
            except Exception:
                return cr.claim.id, []

        ev_list = await asyncio.gather(*(get_ev(cr) for cr in claim_reports))
        all_evidence = dict(ev_list)

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
        job_id = f"job_{uuid.uuid4().hex}"

        report_dict = final_report.model_dump(mode="json")
        report_dict["job_id"] = job_id
        report_dict["analysis_type"] = "text_factcheck"
        report_dict["source_url"] = request.source_url
        report_dict["cached"] = False

        # Persist to DB
        if SessionLocal:
            db = SessionLocal()
            try:
                db_record = FactCheckReport(
                    job_id=job_id,
                    user_id=request.user_id,
                    source=request.source,
                    input_type="text",
                    input_content=request.text[:500],
                    url_hash=text_hash,
                    report_json=json.dumps(report_dict),
                    claims_json=json.dumps({
                        cr.claim.id: {"status": "done", "result": cr.model_dump(mode="json")}
                        for cr in claim_reports
                    }),
                    overall_score=final_report.overall_score,
                    total_claims=len(claims)
                )
                db.add(db_record)
                db.commit()
                logger.info(f"Saved /analyze/text result as {job_id}")
            except Exception as db_e:
                logger.error(f"Failed to save /analyze/text to DB: {db_e}")
                db.rollback()
            finally:
                db.close()

        return report_dict

    except Exception as e:
        logger.error(f"/analyze/text pipeline failed: {e}", exc_info=True)
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


# ==========================================
# LEADERBOARD & VOTING ENDPOINTS
# ==========================================

from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
from sqlalchemy import func
from models.database import SessionLocal, FactCheckReport, VotingRecord

class VoteRequest(BaseModel):
    vote_type: str  # "up" or "down"
    user_id: str

@app.get("/api/leaderboard")
async def get_leaderboard(timeframe: str = "week"):
    if not SessionLocal:
        return {"error": "Database not configured"}
        
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        if timeframe == "week":
            start_date = now - timedelta(days=7)
        elif timeframe == "month":
            start_date = now - timedelta(days=30)
        else:
            start_date = datetime.min
            
        # Group by url_hash to deduplicate
        # We want the WORST credibility (minimum overall_score)
        
        # Subquery to find min overall_score and max created_at per url_hash
        # Since sqlite/basic setup might not support complex distinct on, we fetch and aggregate in python if needed, 
        query = db.query(FactCheckReport).filter(
            FactCheckReport.created_at >= start_date,
            FactCheckReport.overall_score <= 60  # Only show actual misinformation!
        ).all()
        
        grouped = {}
        for report in query:
            # Group by url_hash for URLs, or input_content for raw text scans
            uh = report.url_hash if report.url_hash else str(report.input_content)[:50]
            if not uh:
                uh = report.job_id
                
            if uh not in grouped:
                grouped[uh] = {
                    "report": report,
                    "scans": 1
                }
            else:
                grouped[uh]["scans"] += 1
                # Keep the one with the worst score
                if getattr(report, "overall_score", 100) is not None and getattr(grouped[uh]["report"], "overall_score", 100) is not None:
                    if report.overall_score < grouped[uh]["report"].overall_score:
                        grouped[uh]["report"] = report
                        
        # Sort by overall score ASC (lowest first)
        def get_score(report_dict):
            val = getattr(report_dict["report"], "overall_score", 100)
            return val if val is not None else 100
            
        sorted_groups = sorted(grouped.values(), key=get_score)
        top_20 = sorted_groups[:20]
        
        leaderboard_data = []
        for idx, item in enumerate(top_20):
            rep = item["report"]
            try:
                r_json = json.loads(rep.report_json) if rep.report_json else {}
                c_json = json.loads(rep.claims_json) if rep.claims_json else {}
            except:
                r_json = {}
                c_json = {}
                
            worst_claim = ""
            for claim_id, c_data in c_json.items():
                res = c_data.get("result", {})
                verif = res.get("verification", {})
                if verif.get("verdict") == "FALSE":
                    worst_claim = res.get("claim", {}).get("claim_text", "")
                    break
            if not worst_claim:
                # Fallback to any claim
                for claim_id, c_data in c_json.items():
                    worst_claim = c_data.get("result", {}).get("claim", {}).get("claim_text", "")
                    break
                    
            domain = ""
            if rep.input_type == "url" and rep.input_content:
                from urllib.parse import urlparse
                try:
                    domain = urlparse(rep.input_content).netloc
                except:
                    pass
                    
            title = r_json.get("article_title")
            if not title or title.lower() == "unknown title":
                title = worst_claim or (str(rep.input_content)[:50] + "..." if rep.input_content else "Unknown Scan")
                
            leaderboard_data.append({
                "rank": idx + 1,
                "article_title": title,
                "article_url": rep.input_content if rep.input_type == "url" else "",
                "overall_score": rep.overall_score or 0,
                "verdict": r_json.get("verdict", "UNVERIFIABLE"),
                "scan_count": item["scans"],
                "worst_claim": worst_claim,
                "job_id": rep.job_id,
                "domain": domain
            })
            
        # Stats
        total_scanned = db.query(func.count(FactCheckReport.id)).filter(FactCheckReport.created_at >= start_date).scalar() or 0
        total_claims_verified = db.query(func.sum(FactCheckReport.total_claims)).filter(FactCheckReport.created_at >= start_date).scalar() or 0
        
        return {
            "leaderboard": leaderboard_data,
            "total_articles_scanned": total_scanned,
            "total_claims_verified": total_claims_verified,
            "timeframe": timeframe
        }
    except Exception as e:
        logger.error(f"Leaderboard error: {e}")
        return {"error": str(e)}
    finally:
        db.close()


@app.post("/api/fact-check/report/{job_id}/vote")
async def cast_vote(job_id: str, request: VoteRequest):
    if not SessionLocal:
        return {"error": "Database not configured"}
        
    db = SessionLocal()
    try:
        if request.vote_type not in ["up", "down"]:
            return {"error": "Invalid vote type"}
            
        report = db.query(FactCheckReport).filter(FactCheckReport.job_id == job_id).first()
        if not report:
            return {"error": "Report not found"}
            
        # Check existing vote
        existing_vote = db.query(VotingRecord).filter(
            VotingRecord.job_id == job_id,
            VotingRecord.user_id == request.user_id
        ).first()
        
        if existing_vote:
            if existing_vote.vote_type == request.vote_type:
                # Same vote, do nothing or remove? The prompt says "Already voted"
                return {"error": "Already voted"}
            else:
                # Switch vote
                if existing_vote.vote_type == "up":
                    report.upvotes = max(0, (report.upvotes or 0) - 1)
                    report.downvotes = (report.downvotes or 0) + 1
                else:
                    report.downvotes = max(0, (report.downvotes or 0) - 1)
                    report.upvotes = (report.upvotes or 0) + 1
                existing_vote.vote_type = request.vote_type
        else:
            # New vote
            new_vote = VotingRecord(
                job_id=job_id,
                user_id=request.user_id,
                vote_type=request.vote_type
            )
            db.add(new_vote)
            if request.vote_type == "up":
                report.upvotes = (report.upvotes or 0) + 1
            else:
                report.downvotes = (report.downvotes or 0) + 1
                
        db.commit()
        db.refresh(report)
        
        return {
            "upvotes": report.upvotes or 0,
            "downvotes": report.downvotes or 0,
            "user_vote": request.vote_type
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Vote error: {e}")
        return {"error": str(e)}
    finally:
        db.close()


@app.get("/api/fact-check/report/{job_id}/votes")
async def get_votes(job_id: str, user_id: Optional[str] = None):
    if not SessionLocal:
        return {"error": "Database not configured"}
        
    db = SessionLocal()
    try:
        report = db.query(FactCheckReport).filter(FactCheckReport.job_id == job_id).first()
        if not report:
            return {"error": "Report not found"}
            
        user_vote = None
        if user_id:
            existing_vote = db.query(VotingRecord).filter(
                VotingRecord.job_id == job_id,
                VotingRecord.user_id == user_id
            ).first()
            if existing_vote:
                user_vote = existing_vote.vote_type
                
        return {
            "upvotes": report.upvotes or 0,
            "downvotes": report.downvotes or 0,
            "user_vote": user_vote
        }
    except Exception as e:
        return {"error": str(e)}
    finally:
        db.close()
