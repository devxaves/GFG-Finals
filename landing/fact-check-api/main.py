import os
import uuid
import json
import asyncio
import logging
import httpx
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

load_dotenv()
configure_gemini()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TruthScope Fact & Claim Verification API",
    description="Backend API for the Fact Check and Claim Verification system.",
    version="1.0.0"
)

# Configure CORS
cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_jobs = {}

@app.get("/api/fact-check/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "message": "Fact Check API is running."}

@app.post("/api/fact-check/start")
async def start_fact_check(request: FactCheckRequest):
    job_id = f"job_{uuid.uuid4().hex}"
    active_jobs[job_id] = {
        "input_type": request.input_type,
        "content": request.content
    }
    return {"job_id": job_id}

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
                try:
                    text_to_analyze = await asyncio.to_thread(scrape_url, content)
                except Exception as e:
                    await queue.put(f"event: error\ndata: {json.dumps({'message': f'Failed to scrape URL: {e}. Please paste text directly.', 'recoverable': False})}\n\n")
                    return
                    
            extraction_result = await asyncio.to_thread(extract_claims, text_to_analyze)
            claims = extraction_result.claims
            
            await queue.put(f"event: stage\ndata: {json.dumps({'stage': 'gathering_evidence', 'message': f'Found {len(claims)} claims. Gathering evidence...'})}\n\n")
            
            claim_reports = [ClaimReport(claim=c) for c in claims]
            
            async def get_ev(cr: ClaimReport):
                try:
                    await queue.put(f"event: claim_update\ndata: {json.dumps({'claim_id': cr.claim.id, 'status': 'searching'})}\n\n")
                    evidence = await retrieve_evidence(cr.claim, exclude_domain=source_domain)
                    cr.evidence = evidence
                    await queue.put(f"event: claim_update\ndata: {json.dumps({'claim_id': cr.claim.id, 'status': 'verifying'})}\n\n")
                    return cr.claim.id, evidence
                except Exception as ex:
                    logger.error(f"Error getting evidence for {cr.claim.id}: {ex}")
                    return cr.claim.id, []
                    
            # Fetch all evidence concurrently using Tavily (no LLM, no rate limits)
            ev_list = await asyncio.gather(*(get_ev(cr) for cr in claim_reports))
            all_evidence = dict(ev_list)
            
            from models.schemas import VerificationResult
            # Verify all claims in a single LLM request (Batching)
            batch_result = await asyncio.to_thread(verify_claims_batch, claims, all_evidence)
            
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
            
            final_report = build_report(claim_reports)
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
            
        return {
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
