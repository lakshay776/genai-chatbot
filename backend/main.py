from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
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
MODEL_NAME = "gemini-2.5-flash"

persona_prompts = {
    "anshuman": anshumnan,
    "abhimanyu": abhimanyu,
    "kshitij": kshitij,
}


class ChatRequest(BaseModel):
    persona: str
    message: str
    history: list


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
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=chat_history,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=300,
            ),
        )
        reply = response.text
        print("/chat response text:", reply)
        return {"reply": reply}
    except Exception as e:
        print("/chat error:", e)
        return {"reply": f"Something went wrong: {str(e)}"}
