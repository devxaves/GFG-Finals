import logging
from models.schemas import ClaimExtracted, Evidence
from utils.tavily_client import get_tavily_client

logger = logging.getLogger(__name__)

SOCIAL_MEDIA_DOMAINS = [
    "instagram.com",
    "twitter.com",
    "tiktok.com",
    "reddit.com",
    "snapchat.com",
    "threads.net"
]

async def retrieve_evidence(claim: ClaimExtracted, exclude_domain: str = None, on_think=None) -> list[Evidence]:
    """Retrieves evidence for a single claim using Tavily, excluding the source domain and social media."""
    print(f"\n🔍 Searching Evidence -> Claim: {claim.claim_text[:50]}...")
    
    # Slice to prevent 400 errors from abnormally long claims
    query1 = claim.claim_text[:350]
    query2 = f"fact check {claim.claim_text[:300]}"
    queries = [query1, query2]
    
    tavily = get_tavily_client()
    evidence_list = []
    seen_urls = set()
    
    if tavily:
        for i, query in enumerate(queries):
            try:
                query_label = "Direct search" if i == 0 else "Fact-check search"
                if on_think:
                    await on_think("search", f"{query_label}: querying Tavily", f'"{query[:60]}..."')
                
                # Ask for 5 in case some get filtered
                kwargs = {"query": query, "search_depth": "basic", "max_results": 5}
                
                exclude_list = list(SOCIAL_MEDIA_DOMAINS)
                if exclude_domain:
                    clean_domain = exclude_domain.replace("https://", "").replace("http://", "").split("/")[0]
                    exclude_list.append(clean_domain)
                    
                kwargs["exclude_domains"] = exclude_list
                    
                response = tavily.search(**kwargs)
                results = response.get("results", [])
                print(f"   ✅ Tavily found {len(results)} results for: '{query[:50]}...'")
                
                if on_think:
                    await on_think("check-circle", f"Tavily returned {len(results)} results", f"{query_label} complete")
                
                for res in results:
                    url = res.get("url", "")
                    if url and url not in seen_urls:
                        domain = url.split("//")[-1].split("/")[0]
                        
                        # Strict subdomain/base name check
                        if exclude_domain:
                            # e.g., theonion.com -> theonion
                            base_name = exclude_domain.replace("www.", "").split('.')[0]
                            if base_name in domain:
                                print(f"   ⏭️ Skipped related domain: {url}")
                                continue
                                
                        # Strict social media check just in case Tavily missed the API param
                        is_social = any(sm in domain for sm in SOCIAL_MEDIA_DOMAINS)
                        if is_social:
                            print(f"   ⏭️ Skipped social media: {url}")
                            continue
                            
                        seen_urls.add(url)
                        evidence_list.append(Evidence(
                            source_url=url,
                            domain=domain,
                            title=res.get("title", ""),
                            snippet=res.get("content", ""),
                            relevance_score=res.get("score", 0.5)
                        ))
            except Exception as e:
                print(f"   ❌ TAVILY SEARCH FAILED for '{query[:50]}...': {e}")
                logger.error(f"Tavily search failed for query '{query[:100]}...': {e}")
                if on_think:
                    await on_think("alert-triangle", f"Search query failed", str(e)[:60])
    else:
        print("   ❌ CRITICAL: Tavily client is missing! Set TAVILY_API_KEY in .env!")
        logger.warning("No Tavily client available.")
        if on_think:
            await on_think("alert-triangle", "Tavily client unavailable", "Set TAVILY_API_KEY in .env")
        
    print(f"📊 Total Evidence Gathered for claim {claim.id}: {len(evidence_list)}")
    if on_think:
        await on_think("database", f"Gathered {len(evidence_list)} evidence sources", f"From {len(seen_urls)} unique URLs across {len(queries)} queries")
    return evidence_list

