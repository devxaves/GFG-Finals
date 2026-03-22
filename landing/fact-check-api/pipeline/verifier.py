import logging
from typing import List, Dict
from models.schemas import ClaimExtracted, Evidence, VerificationResultWithId, BatchVerificationResult
from utils.gemini_client import get_gemini_model, generate_structured_content

logger = logging.getLogger(__name__)

VERIFY_BATCH_PROMPT = """You are a strict fact-verification agent. Verify each claim based EXCLUSIVELY on the provided evidence.
Rules:
- For each claim, what does the evidence say? Do sources agree?
- Does the evidence support or contradict?
- Verdict must be TRUE, FALSE, PARTIALLY_TRUE, UNVERIFIABLE, or CONFLICTING.
- Output ONLY valid JSON matching the requested schema.
- Include the exact `claim_id` for each claim verified."""

def verify_claims_batch(claims: List[ClaimExtracted], all_evidence: Dict[str, List[Evidence]]) -> Dict[str, VerificationResultWithId]:
    if not claims:
        return {}
        
    logger.info(f"Batch verifying {len(claims)} claims.")
    
    prompt = "Verify these claims using the provided evidence:\n\n"
    for c in claims:
        prompt += f"--- CLAIM {c.id} ---\n{c.claim_text}\nEVIDENCE:\n"
        ev = all_evidence.get(c.id, [])
        if not ev:
            prompt += "No evidence retrieved.\n"
        else:
            # Limit to top 3 evidence to save tokens and prevent 413 Too Large errors
            for idx, e in enumerate(ev[:3]):
                 trunc_snippet = e.snippet[:400] + "..." if len(e.snippet) > 400 else e.snippet
                 prompt += f"[{idx+1}] {e.domain} ({e.source_url}): {trunc_snippet}\n"
        prompt += "\n"
        
    model = get_gemini_model(system_instruction=VERIFY_BATCH_PROMPT)
    if not model:
        raise ValueError("Failed to initialize Gemini model for verification.")
        
    try:
        batch_result = generate_structured_content(model, prompt, BatchVerificationResult)
        
        # Robust mapping
        llm_results = {r.claim_id: r for r in batch_result.results}
        
        final_dict = {}
        for i, c in enumerate(claims):
            match = llm_results.get(c.id)
            if not match and i < len(batch_result.results):
                # Fallback to index if LLM failed to copy the exact claim_id
                match = batch_result.results[i]
                
            if match:
                match.claim_id = c.id # Fix any discrepancies
                final_dict[c.id] = match
            else:
                final_dict[c.id] = VerificationResultWithId(
                    claim_id=c.id,
                    verdict="UNVERIFIABLE",
                    confidence_score=0,
                    reasoning="Verification failed. Could not verify securely.",
                    citations=[]
                )
        return final_dict
    except Exception as e:
        logger.error(f"Batch verification failed: {e}")
        # Create unverifiable stubs
        stubs = {}
        for c in claims:
            stubs[c.id] = VerificationResultWithId(
                claim_id=c.id,
                verdict="UNVERIFIABLE",
                confidence_score=0,
                reasoning=f"Verification failed due to an error: {str(e)}",
                citations=[]
            )
        return stubs
