from __future__ import annotations

import base64
import json
import mimetypes
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

import anthropic
from pydantic import BaseModel

from mydiet.settings import Settings


class FoodItem(BaseModel):
    name: str
    meal: Literal["morning", "lunch", "dinner", "snacks"]
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


class DayAnalysis(BaseModel):
    food_calories: float
    food_items: list[FoodItem]
    activity_calories: float
    burned_calories: float
    calorie_deficit: float
    protein_g: float
    carbs_g: float
    fat_g: float
    confidence: Literal["low", "medium", "high"]
    summary: str
    assumptions: list[str]


class ClaudeAnalysisError(ValueError):
    pass


class ClaudeDietClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is required for Claude analysis.")
        self._settings = settings
        self._model = settings.claude_model
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    def analyze_day(
        self,
        *,
        diary_text: str,
        profile: dict[str, Any],
        entry_date: str,
        image_paths: list[Path],
        language: str = "en",
    ) -> dict[str, Any]:
        safe_profile = _json_safe(profile)
        content: list[dict[str, Any]] = []
        for path in image_paths:
            mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
            data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
            content.append({"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": data}})
        content.append(
            {
                "type": "text",
                "text": analysis_prompt(self._settings, diary_text, safe_profile, entry_date, language=language),
            }
        )

        response = self._client.messages.parse(
            model=self._model,
            max_tokens=16000,
            output_config={"effort": "medium"},
            messages=[{"role": "user", "content": content}],
            output_format=DayAnalysis,
        )
        if response.stop_reason == "refusal":
            raise ClaudeAnalysisError("Claude declined to analyze this day.")
        if response.parsed_output is None:
            raise ClaudeAnalysisError(f"Claude returned no analysis (stop reason: {response.stop_reason}).")
        return response.parsed_output.model_dump()


def analysis_prompt(
    settings: Settings,
    diary_text: str,
    profile: dict[str, Any],
    entry_date: str,
    *,
    language: str = "en",
) -> str:
    template = settings.analysis_prompt_path.read_text(encoding="utf-8")
    output_language = _output_language(language)
    return template.format(
        entry_date=entry_date,
        language=language,
        output_language=output_language,
        profile_json=json.dumps(profile, ensure_ascii=False),
        diary_text=diary_text,
    ).strip()


def _output_language(language: str) -> str:
    if language == "tr":
        return "Turkish"
    return "English"


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
