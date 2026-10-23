from __future__ import annotations

from datetime import datetime, timezone

from mydiet.claude_client import _json_safe, analysis_prompt
from mydiet.settings import Settings


def test_json_safe_converts_datetime_values() -> None:
    payload = {
        "name": "Halil",
        "updated_at": datetime(2026, 6, 13, tzinfo=timezone.utc),
        "nested": [{"seen_at": datetime(2026, 6, 12, tzinfo=timezone.utc)}],
    }

    safe = _json_safe(payload)

    assert safe["updated_at"] == "2026-06-13T00:00:00+00:00"
    assert safe["nested"][0]["seen_at"] == "2026-06-12T00:00:00+00:00"


def test_default_claude_model() -> None:
    settings = Settings(
        APP_ENV="missing-config-env",
        APP_PASSWORD="",
        APP_PASSWORD_HASH="",
        ANTHROPIC_API_KEY="",
        FLASK_SECRET_KEY="test",
    )
    settings.app_config.clear()

    assert settings.claude_model == "claude-opus-5-5"


def test_analysis_prompt_comes_from_configured_file(tmp_path) -> None:
    prompt_path = tmp_path / "prompt.txt"
    prompt_path.write_text(
        "Date={entry_date}\nProfile={profile_json}\nDiary={diary_text}",
        encoding="utf-8",
    )
    settings = Settings(
        APP_ENV="test",
        APP_PASSWORD="",
        APP_PASSWORD_HASH="",
        ANTHROPIC_API_KEY="",
        FLASK_SECRET_KEY="test",
    )
    settings.app_config["analysis_prompt_path"] = str(prompt_path)

    prompt = analysis_prompt(settings, "ate eggs", {"weight_kg": 82.4}, "2026-06-13")

    assert "Date=2026-06-13" in prompt
    assert 'Profile={"weight_kg": 82.4}' in prompt
    assert "Diary=ate eggs" in prompt


def test_default_analysis_prompt_requests_food_items() -> None:
    settings = Settings(
        APP_ENV="test",
        APP_PASSWORD="",
        APP_PASSWORD_HASH="",
        ANTHROPIC_API_KEY="",
        FLASK_SECRET_KEY="test",
    )

    prompt = analysis_prompt(settings, "ate eggs", {}, "2026-06-13")

    assert '"food_items"' in prompt
    assert '"bmr_calories"' in prompt
    assert '"meal"' in prompt
    assert '"protein_g"' in prompt
    assert "total macro grams" in prompt


def test_analysis_prompt_uses_selected_output_language() -> None:
    settings = Settings(
        APP_ENV="test",
        APP_PASSWORD="",
        APP_PASSWORD_HASH="",
        ANTHROPIC_API_KEY="",
        FLASK_SECRET_KEY="test",
    )

    prompt = analysis_prompt(settings, "yumurta yedim", {}, "2026-06-13", language="tr")

    assert "Output language: Turkish" in prompt
    assert "Keep all user-facing text in Turkish" in prompt


def test_analyze_day_sends_images_and_returns_parsed_analysis(tmp_path) -> None:
    from types import SimpleNamespace

    from mydiet.claude_client import ClaudeDietClient, DayAnalysis

    image = tmp_path / "lunch.png"
    image.write_bytes(b"png-bytes")
    analysis = DayAnalysis(
        food_calories=600,
        food_items=[
            {"name": "salad", "meal": "lunch", "calories": 600, "protein_g": 30, "carbs_g": 40, "fat_g": 20}
        ],
        bmr_calories=2200,
        activity_calories=0,
        burned_calories=2200,
        calorie_deficit=1600,
        protein_g=30,
        carbs_g=40,
        fat_g=20,
        confidence="medium",
        summary="ok",
        assumptions=[],
    )
    calls = []

    def fake_parse(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(stop_reason="end_turn", parsed_output=analysis)

    client = ClaudeDietClient(Settings(ANTHROPIC_API_KEY="test", FLASK_SECRET_KEY="test"))
    client._client = SimpleNamespace(messages=SimpleNamespace(parse=fake_parse))

    result = client.analyze_day(
        diary_text="salad", profile={}, entry_date="2026-10-23", image_paths=[image], language="en"
    )

    assert result["food_items"][0]["meal"] == "lunch"
    content = calls[0]["messages"][0]["content"]
    assert content[0]["type"] == "image"
    assert content[0]["source"]["media_type"] == "image/png"
    assert content[-1]["type"] == "text"
    assert calls[0]["output_format"] is DayAnalysis
