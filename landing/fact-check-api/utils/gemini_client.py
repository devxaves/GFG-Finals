import os
import logging
import json
import requests
import google.generativeai as genai
from typing import Type
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Note: We configure the API key globally when loading the app.
def configure_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key and api_key != "your_gemini_api_key":
        genai.configure(api_key=api_key)
        logger.info("Gemini API configured.")
    else:
        logger.warning("GEMINI_API_KEY is not set or is using placeholder. Gemini calls will fail.")

def get_gemini_model(model_name: str = "gemini-2.5-flash", system_instruction: str = None):
    generation_config = {
        "temperature": 0.1,
        "top_p": 0.95,
        "top_k": 32,
        "max_output_tokens": 2048,  # Reduced for speed - claim extraction doesn't need 8k tokens
    }
    
    try:
        # If the SDK version supports system_instruction directly in constructor
        model = genai.GenerativeModel(
            model_name=model_name,
            generation_config=generation_config,
            system_instruction=system_instruction
        )
        model._custom_system_instruction = system_instruction
        return model
    except Exception as e:
        logger.error(f"Failed to initialize Gemini model: {e}")
        return None

def generate_structured_content(model, prompt: str, response_schema: Type[BaseModel]):
    """Helper to generate structured content from Gemini, with Groq fallback."""
    try:
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                response_schema=response_schema
            )
        )
        text = response.text
        return response_schema.model_validate_json(text)
    except Exception as e:
        logger.error(f"Gemini generation error: {e}. Attempting Groq fallback...")
        groq_key = os.getenv("GROQ_API_KEY")
        if not groq_key:
            raise ValueError(f"Gemini API failed. Set GROQ_API_KEY in .env for Groq fallback. Gemini error: {str(e)}")
            
        sys_inst = getattr(model, '_custom_system_instruction', "") or ""
        schema_json = response_schema.model_json_schema()
        full_sys = sys_inst + f"\n\nYou MUST respond ONLY with a raw JSON object matching this exact JSON Schema. No markdown tags, no extra text. Schema:\n{json.dumps(schema_json)}"
        
        try:
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": full_sys},
                        {"role": "user", "content": prompt}
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1
                },
                timeout=30.0
            )
            if not resp.ok:
                raise ValueError(f"Status {resp.status_code}: {resp.text}")
            content = resp.json()["choices"][0]["message"]["content"]
            return response_schema.model_validate_json(content)
        except Exception as groq_e:
            logger.error(f"Groq fallback failed: {groq_e}. Attempting Nvidia fallback...")
            
            nvidia_key = os.getenv("NVIDIA_API_KEY", "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")
            invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {nvidia_key}",
                "Accept": "application/json"
            }
            payload = {
                "model": "qwen/qwen3.5-122b-a10b",
                "messages": [
                    {"role": "system", "content": full_sys},
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": 16384,
                "temperature": 0.1,
                "top_p": 0.95,
                "stream": False,
                "chat_template_kwargs": {"enable_thinking": True}
            }
            try:
                resp = requests.post(invoke_url, headers=headers, json=payload, timeout=60.0)
                if not resp.ok:
                    raise ValueError(f"Status {resp.status_code}: {resp.text}")
                content = resp.json()["choices"][0]["message"]["content"]
                
                # Cleanup potential thinking blocks and markdown tags for strict JSON validation
                if "<think>" in content and "</think>" in content:
                    content = content.split("</think>")[-1]
                content = content.strip()
                if content.startswith("```json"):
                    content = content[7:]
                if content.endswith("```"):
                    content = content[:-3]
                content = content.strip()
                
                return response_schema.model_validate_json(content)
            except Exception as nvidia_e:
                logger.error(f"Nvidia fallback failed: {nvidia_e}")
                raise ValueError(f"All API calls failed. Gemini: {str(e)} | Groq: {str(groq_e)} | Nvidia: {str(nvidia_e)}")
