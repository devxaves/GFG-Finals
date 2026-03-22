import logging
import uuid
from models.schemas import ExtractionResult
from utils.gemini_client import get_gemini_model, generate_structured_content

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a precise fact-extraction engine. Your job
is to decompose text into atomic, independently verifiable
factual claims.
Rules:
- Extract up to 10 of the most significant, objective, falsifiable statements.
- Ignore opinions, predictions, and subjective language.
- Each claim must be a single, standalone fact.
- Do not paraphrase — preserve key names, numbers, dates.
- 'context_snippet' MUST be an EXACT, verbatim, unbroken substring from the provided text that contains the claim, so it can be physically matched on the frontend.
- Output ONLY valid JSON matching the provided schema."""

def extract_claims(text: str) -> ExtractionResult:
    """Extracts claims from text using Gemini 2.5 Flash."""
    logger.info("Extracting claims from text...")
    model = get_gemini_model(system_instruction=SYSTEM_PROMPT)
    if not model:
        raise ValueError("Failed to initialize Gemini model.")
        
    prompt = f"Text to analyze:\n{text}"
    
    try:
        result = generate_structured_content(model, prompt, ExtractionResult)
        
        # Ensure unique IDs
        for i, claim in enumerate(result.claims):
            if not getattr(claim, 'id', None) or claim.id == "string":
                claim.id = f"claim_{uuid.uuid4().hex[:8]}"
                
        logger.info(f"Extracted {len(result.claims)} claims.")
        return result
    except Exception as e:
        logger.error(f"Failed to extract claims: {e}")
        raise
