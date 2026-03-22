import os
import logging
from tavily import TavilyClient

logger = logging.getLogger(__name__)

_tavily_client = None

def get_tavily_client() -> TavilyClient:
    global _tavily_client
    if _tavily_client is not None:
        return _tavily_client
        
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key or api_key == "your_tavily_api_key":
        logger.warning("TAVILY_API_KEY is missing. Tavily search may fail.")
        return None
        
    try:
        _tavily_client = TavilyClient(api_key=api_key)
        return _tavily_client
    except Exception as e:
        logger.error(f"Failed to initialize Tavily client: {e}")
        return None
