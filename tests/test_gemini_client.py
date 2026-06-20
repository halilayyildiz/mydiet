from __future__ import annotations

from datetime import datetime, timezone

from mydiet.gemini_client import _json_safe, analysis_prompt
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


def test_default_gemini_model_tracks_latest_flash() -> None:
    settings = Settings(
        APP_ENV="missing-config-env",
        APP_PASSWORD="",
        APP_PASSWORD_HASH="",
        GEMINI_API_KEY="",
        FLASK_SECRET_KEY="test",
    )
    settings.app_config.clear()

    assert settings.gemini_model == "gemini-flash-latest"


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
        GEMINI_API_KEY="",
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
        GEMINI_API_KEY="",
        FLASK_SECRET_KEY="test",
    )

    prompt = analysis_prompt(settings, "ate eggs", {}, "2026-06-13")

    assert '"food_items"' in prompt
    assert '"meal"' in prompt
    assert '"protein_g"' in prompt
    assert "total macro grams" in prompt


def test_analysis_prompt_uses_selected_output_language() -> None:
    settings = Settings(
        APP_ENV="test",
        APP_PASSWORD="",
        APP_PASSWORD_HASH="",
        GEMINI_API_KEY="",
        FLASK_SECRET_KEY="test",
    )

    prompt = analysis_prompt(settings, "yumurta yedim", {}, "2026-06-13", language="tr")

    assert "Output language: Turkish" in prompt
    assert "Keep all user-facing text in Turkish" in prompt
