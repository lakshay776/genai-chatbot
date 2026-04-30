from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import time
from google import genai
from google.genai import types
from dotenv import load_dotenv
from pathlib import Path
from personas import anshumnan, abhimanyu, kshitij

dotenv_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise RuntimeError("GOOGLE_API_KEY is not set. Make sure backend/.env exists and contains the key.")

client = genai.Client(api_key=api_key)

persona_prompts = {
    "anshuman": anshumnan,
    "abhimanyu": abhimanyu,
    "kshitij": kshitij,
}


class ChatRequest(BaseModel):
    persona: str
    message: str
    history: list



# Model priority: try flash-2.5 first, fall back to flash-2.0
MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"]
MAX_RETRIES = 3


def call_with_retry(contents, system_instruction):
    """Try each model with exponential backoff on 503 errors."""
    last_error = None

    for model_name in MODELS:
        for attempt in range(MAX_RETRIES):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        max_output_tokens=300,
                    ),
                )
                print(f"[OK] model={model_name} attempt={attempt+1}")
                return response.text
            except Exception as e:
                last_error = e
                err_str = str(e)
                # Only retry on 503 (overloaded) — bail immediately on auth/quota errors
                if "503" in err_str or "UNAVAILABLE" in err_str:
                    wait = 2 ** attempt  # 1s, 2s, 4s
                    print(f"[WARN] {model_name} attempt {attempt+1} failed (503). Retrying in {wait}s…")
                    time.sleep(wait)
                else:
                    print(f"[ERROR] {model_name} non-retryable error: {e}")
                    break  # try next model

    raise last_error


@app.post("/chat")
def chat(req: ChatRequest):
    system_prompt = persona_prompts.get(req.persona)

    if not system_prompt:
        return {"reply": "Invalid persona selected"}

    # Build conversation history in the format the new SDK expects
    chat_history: list[types.Content] = []
    for msg in (req.history or []):
        role = "user" if msg["role"] == "user" else "model"
        chat_history.append(
            types.Content(role=role, parts=[types.Part(text=msg["content"])])
        )

    # Append the new user message
    chat_history.append(
        types.Content(role="user", parts=[types.Part(text=req.message)])
    )

    try:
        reply = call_with_retry(chat_history, system_prompt)
        print("/chat response text:", reply)
        return {"reply": reply}
    except Exception as e:
        err_str = str(e)
        print("/chat final error:", err_str)
        if "503" in err_str or "UNAVAILABLE" in err_str:
            return {"reply": "⚠ The AI model is overloaded right now. Please try again in a few seconds."}
        return {"reply": f"Something went wrong. Please try again."}

