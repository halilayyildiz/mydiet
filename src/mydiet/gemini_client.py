from __future__ import annotations

import json
import mimetypes
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from mydiet.settings import Settings


class GeminiJsonError(ValueError):
    pass


class GeminiDietClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is required for Gemini analysis.")
        self._settings = settings
        self._model = settings.gemini_model
        self._client = genai.Client(api_key=settings.gemini_api_key)

    def analyze_day(
        self,
        *,
        diary_text: str,
        profile: dict[str, Any],
        entry_date: str,
        image_paths: list[Path],
    ) -> dict[str, Any]:
        safe_profile = _json_safe(profile)
        parts: list[types.Part] = [
            types.Part(text=analysis_prompt(self._settings, diary_text, safe_profile, entry_date))
        ]
        for path in image_paths:
            mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
            parts.append(types.Part.from_bytes(data=path.read_bytes(), mime_type=mime_type))

        response = self._client.models.generate_content(
            model=self._model,
            contents=types.Content(parts=parts),
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        return _loads_json_object(_response_text(response))


def analysis_prompt(
    settings: Settings,
    diary_text: str,
    profile: dict[str, Any],
    entry_date: str,
) -> str:
    template = settings.analysis_prompt_path.read_text(encoding="utf-8")
    return template.format(
        entry_date=entry_date,
        profile_json=json.dumps(profile, ensure_ascii=False),
        diary_text=diary_text,
    ).strip()


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if text:
        return str(text)

    parts: list[str] = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            part_text = getattr(part, "text", None)
            if part_text:
                parts.append(str(part_text))
    return "\n".join(parts)


def _loads_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if not cleaned:
        raise GeminiJsonError("Gemini returned an empty response instead of JSON.")
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            snippet = re.sub(r"\s+", " ", cleaned[:300]).strip()
            raise GeminiJsonError(f"Gemini response was not valid JSON: {snippet}") from None
        payload = json.loads(match.group(0))
    if not isinstance(payload, dict):
        raise GeminiJsonError("Gemini returned JSON, but it was not an object.")
    return payload
