import logging
from typing import List
from models.schemas import ClaimExtracted, Evidence, VerificationResult, ClaimReport, AccuracyReport

logger = logging.getLogger(__name__)

def build_report(claims: List[ClaimReport]) -> AccuracyReport:
    """Aggregates all claim reports into a final Accuracy Report."""
    logger.info("Building final accuracy report.")
    
    total_claims = len(claims)
    if total_claims == 0:
        return AccuracyReport(
            overall_score=0,
            total_claims=0,
            breakdown_by_verdict={},
            claims=[]
        )
        
    breakdown = {
        "TRUE": 0,
        "FALSE": 0,
        "PARTIALLY_TRUE": 0,
        "UNVERIFIABLE": 0,
        "CONFLICTING": 0
    }
    
    total_confidence_points = 0
    valid_scored_claims = 0
    
    for report in claims:
        verdict = report.verification.verdict if report.verification else "UNVERIFIABLE"
        # Validate verdict against known schema
        if verdict not in breakdown:
             verdict = "UNVERIFIABLE"
                
        score = report.verification.confidence_score if report.verification else 0
        
        breakdown[verdict] = breakdown.get(verdict, 0) + 1
        
        # Overall score = weighted avg of true/partially true
        if verdict in ["TRUE", "PARTIALLY_TRUE", "FALSE", "CONFLICTING"]:
            valid_scored_claims += 1
            if verdict == "TRUE":
                total_confidence_points += score
            elif verdict == "PARTIALLY_TRUE":
                total_confidence_points += (score * 0.5)
            # FALSE/CONFLICTING add to denominator but contribute 0 points to accuracy
            
    if valid_scored_claims > 0:
        overall_score = int(total_confidence_points / valid_scored_claims)
    else:
        overall_score = 0
        
    logger.info(f"Report built. Score: {overall_score}, Total: {total_claims}")
    
    return AccuracyReport(
        overall_score=overall_score,
        total_claims=total_claims,
        breakdown_by_verdict=breakdown,
        claims=claims
    )
