from pydantic import BaseModel, Field
from typing import List, Optional

# API Input
class FactCheckRequest(BaseModel):
    input_type: str = Field(..., description="'text' or 'url'")
    content: str

class TextDetectionRequest(BaseModel):
    text: str

class MediaAnalysisRequest(BaseModel):
    media_url: str

# Stage 1: Extraction
class ClaimExtracted(BaseModel):
    id: str = Field(description="Unique identifier for the claim")
    claim_text: str = Field(description="The specific, atomic, verifiable claim")
    context_snippet: str = Field(description="The surrounding text for context")

class ExtractionResult(BaseModel):
    claims: List[ClaimExtracted]

# Stage 2: Evidence
class Evidence(BaseModel):
    source_url: str
    domain: str
    title: str = ""
    snippet: str
    relevance_score: float

class SearchQueries(BaseModel):
    query1: str = Field(description="Direct verification angle")
    query2: str = Field(description="Alternative angle")

# Stage 3: Verification
class VerificationCitation(BaseModel):
    url: str
    domain: str
    supporting_snippet: str

class VerificationResult(BaseModel):
    verdict: str = Field(description="TRUE, FALSE, PARTIALLY_TRUE, UNVERIFIABLE, or CONFLICTING")
    confidence_score: int = Field(description="0-100")
    reasoning: str = Field(description="Detailed chain-of-thought explaining the verdict based on citations")
    citations: List[VerificationCitation] = Field(default_factory=list)

class VerificationResultWithId(VerificationResult):
    claim_id: str

class BatchVerificationResult(BaseModel):
    results: List[VerificationResultWithId]

# Stage 4: Report
class ClaimReport(BaseModel):
    claim: ClaimExtracted
    verification: Optional[VerificationResult] = None
    evidence: Optional[List[Evidence]] = None

class AccuracyReport(BaseModel):
    overall_score: int
    total_claims: int
    breakdown_by_verdict: dict
    claims: List[ClaimReport]

# Text Detection
class AIDetectionResult(BaseModel):
    ai_generated_probability: int
    indicators: List[str]

# --- Chrome Extension Schemas ---

class ExtensionTextRequest(BaseModel):
    url: Optional[str] = None
    article_text: str

class ExtensionSentimentRequest(BaseModel):
    text: str

class ExtensionSentimentData(BaseModel):
    label: str = Field(description="positive, negative, or neutral")
    score: float = Field(description="Confidence score 0.0 to 1.0")

class ExtensionBiasData(BaseModel):
    summary: str
    indicators: List[str]

class ExtensionSentimentBiasResult(BaseModel):
    sentiment: ExtensionSentimentData
    bias: ExtensionBiasData
