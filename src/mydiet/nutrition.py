from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


RANGE_OPTIONS = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
}

MEAL_GROUPS = [
    ("morning", "Morning"),
    ("lunch", "Lunch"),
    ("dinner", "Dinner"),
    ("snacks", "Snacks"),
]


def parse_iso_date(value: str | None, *, default: date | None = None) -> date:
    if not value:
        return default or date.today()
    return date.fromisoformat(value)


def local_date(timezone_name: str | None = None) -> date:
    if not timezone_name:
        return date.today()
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return date.today()


def today_iso(timezone_name: str | None = None) -> str:
    return local_date(timezone_name).isoformat()


def date_window(
    days: int,
    *,
    end: date | None = None,
    timezone_name: str | None = None,
) -> list[str]:
    end_date = end or local_date(timezone_name)
    start = end_date - timedelta(days=days - 1)
    return [(start + timedelta(days=offset)).isoformat() for offset in range(days)]


def month_window(month: str | None = None, *, timezone_name: str | None = None) -> list[str]:
    base = local_date(timezone_name)
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
        "food_items": _food_items(payload.get("food_items")),
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


def food_item_groups(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {
        key: {"key": key, "label": label, "calories": 0, "items": []}
        for key, label in MEAL_GROUPS
    }
    for item in _food_items(analysis.get("food_items")):
        meal_key = _meal_key(item.get("meal") or item.get("name"))
        groups[meal_key]["calories"] += _number(item.get("calories"))
        groups[meal_key]["items"].append(item)
    return [group for group in groups.values() if group["items"]]


def fallback_analysis(
    diary_text: str,
    profile: dict[str, Any],
    *,
    reason: str = "Set GEMINI_API_KEY to calculate from diary text and images.",
    language: str = "en",
) -> dict[str, Any]:
    weight = _number(profile.get("weight_kg")) or 80
    height = _number(profile.get("height_cm")) or 175
    age = _number(profile.get("age")) or 35
    gender = str(profile.get("gender") or "").lower()
    bmr = 10 * weight + 6.25 * height - 5 * age + (5 if gender == "male" else -161)
    food = _rough_food_calories(diary_text)
    food_items = _rough_food_items(diary_text, food)
    activity = _rough_activity_calories(diary_text)
    burned = round(max(bmr * 1.25 + activity, 1200))
    summary = "Saved without Gemini analysis. Values are rough placeholders."
    if language == "tr":
        summary = "Gemini analizi olmadan kaydedildi. Değerler yaklaşık yer tutuculardır."
    return {
        "food_calories": food,
        "food_items": food_items,
        "activity_calories": activity,
        "burned_calories": burned,
        "calorie_deficit": burned - food,
        "protein_g": 0,
        "carbs_g": 0,
        "fat_g": 0,
        "confidence": "low",
        "summary": summary,
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


def _food_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        items.append(
            {
                "name": name,
                "meal": _meal_key(item.get("meal") or name),
                "calories": _number(item.get("calories")),
                "protein_g": _number(item.get("protein_g")),
                "carbs_g": _number(item.get("carbs_g")),
                "fat_g": _number(item.get("fat_g")),
            }
        )
    return items


def _meal_key(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"morning", "breakfast", "sabah"}:
        return "morning"
    if text in {"lunch", "noon", "oglen", "öğlen"}:
        return "lunch"
    if text in {"dinner", "evening", "aksam", "akşam"}:
        return "dinner"
    if text in {"snack", "snacks", "atistirmalik", "atıştırmalık", "atistirmaliklar", "atıştırmalıklar"}:
        return "snacks"
    if any(word in text for word in ["breakfast", "morning", "coffee"]):
        return "morning"
    if any(word in text for word in ["lunch", "noon"]):
        return "lunch"
    if any(word in text for word in ["dinner", "evening"]):
        return "dinner"
    if any(word in text for word in ["snack", "strawberry", "nuts"]):
        return "snacks"
    return "snacks"


def _rough_food_items(text: str, total_calories: int) -> list[dict[str, Any]]:
    if not total_calories:
        return []
    lowered = text.lower()
    labels = [
        word
        for word in ["breakfast", "lunch", "dinner", "snack"]
        if word in lowered
    ]
    if not labels:
        labels = ["food notes"]
    calories = round(total_calories / len(labels))
    return [
        {
            "name": label.title(),
            "meal": _meal_key(label),
            "calories": calories,
            "protein_g": 0,
            "carbs_g": 0,
            "fat_g": 0,
        }
        for label in labels
    ]


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
