from bs4 import BeautifulSoup
import requests
from newspaper import Article
import logging

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

def scrape_url(url: str) -> str:
    """Scrapes article text from a URL using newspaper3k, falling back to BeautifulSoup."""
    try:
        logger.info(f"Attempting to scrape {url} using newspaper3k")
        article = Article(url)
        article.download()
        article.parse()
        text = article.text
        if text and len(text.strip()) > 50:
            return text.strip()
    except Exception as e:
        logger.warning(f"newspaper3k failed for {url}: {e}")

    try:
        logger.info(f"Falling back to BeautifulSoup for {url}")
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, timeout=10, headers=headers)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'lxml')
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "header", "aside"]):
            script.extract()
            
        # Get text
        text = soup.get_text(separator=' ')
        # Break into lines and remove leading and trailing space on each
        lines = (line.strip() for line in text.splitlines())
        # Break multi-headlines into a line each
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        # Drop blank lines
        text = '\n'.join(chunk for chunk in chunks if chunk)
        
        if not text or len(text.strip()) < 50:
             raise ValueError("Extracted text is too short or empty.")
             
        return text
    except Exception as e:
        logger.error(f"BeautifulSoup fallback failed for {url}: {e}")
        raise ValueError(f"Failed to extract readable content from URL: {url}")
