from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any


RANGE_OPTIONS = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
}


def parse_iso_date(value: str | None, *, default: date | None = None) -> date:
    if not value:
        return default or date.today()
    return date.fromisoformat(value)


def today_iso() -> str:
    return date.today().isoformat()


def date_window(days: int, *, end: date | None = None) -> list[str]:
    end_date = end or date.today()
    start = end_date - timedelta(days=days - 1)
    return [(start + timedelta(days=offset)).isoformat() for offset in range(days)]


def month_window(month: str | None = None) -> list[str]:
    base = date.today()
    if month:
        base = date.fromisoformat(f"{month}-01")
    first = base.replace(day=1)
    if first.month == 12:
        next_month = first.replace(year=first.year + 1, month=1)
    else:
        next_month = first.replace(month=first.month + 1)
    days = (next_month - first).days
    return [(first + timedelta(days=offset)).isoformat() for offset in range(days)]


def normalize_analysis(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "food_calories": _number(payload.get("food_calories")),
        "activity_calories": _number(payload.get("activity_calories")),
        "burned_calories": _number(payload.get("burned_calories")),
        "calorie_deficit": _number(payload.get("calorie_deficit")),
        "protein_g": _number(payload.get("protein_g")),
        "carbs_g": _number(payload.get("carbs_g")),
        "fat_g": _number(payload.get("fat_g")),
        "confidence": str(payload.get("confidence") or "medium"),
        "summary": str(payload.get("summary") or ""),
        "assumptions": _string_list(payload.get("assumptions")),
    }


def fallback_analysis(
    diary_text: str,
    profile: dict[str, Any],
    *,
    reason: str = "Set GEMINI_API_KEY to calculate from diary text and images.",
) -> dict[str, Any]:
    weight = _number(profile.get("weight_kg")) or 80
    height = _number(profile.get("height_cm")) or 175
    age = _number(profile.get("age")) or 35
    gender = str(profile.get("gender") or "").lower()
    bmr = 10 * weight + 6.25 * height - 5 * age + (5 if gender == "male" else -161)
    food = _rough_food_calories(diary_text)
    activity = _rough_activity_calories(diary_text)
    burned = round(max(bmr * 1.25 + activity, 1200))
    return {
        "food_calories": food,
        "activity_calories": activity,
        "burned_calories": burned,
        "calorie_deficit": burned - food,
        "protein_g": 0,
        "carbs_g": 0,
        "fat_g": 0,
        "confidence": "low",
        "summary": "Saved without Gemini analysis. Values are rough placeholders.",
        "assumptions": [reason],
    }


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _number(value: Any) -> int:
    if value in {None, ""}:
        return 0
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def _rough_food_calories(text: str) -> int:
    lowered = text.lower()
    calories = 0
    for marker in ["kcal", "calorie", "calories"]:
        if marker in lowered:
            return 0
    portions = ["breakfast", "lunch", "dinner", "snack", "meal", "ate", "food"]
    calories += sum(450 for word in portions if word in lowered)
    return max(calories, 0)


def _rough_activity_calories(text: str) -> int:
    lowered = text.lower()
    activity_words = ["walk", "run", "gym", "bike", "swim", "workout", "steps"]
    return sum(120 for word in activity_words if word in lowered)
