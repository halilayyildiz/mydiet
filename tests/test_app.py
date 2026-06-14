from __future__ import annotations

from pathlib import Path

from mydiet.app import (
    _balance_summary,
    _date_range_label,
    _shift_month,
    _trend_series,
    _weight_series,
    create_app,
)
from mydiet.firestore_db import MemoryDietRepository
from mydiet.nutrition import date_window
from mydiet.settings import Settings
from werkzeug.security import generate_password_hash


def test_dashboard_renders_with_memory_repository() -> None:
    app = create_app(settings=_settings(), repository=MemoryDietRepository())

    response = app.test_client().get("/")

    assert response.status_code == 200
    assert b"Daily calorie balance" in response.data
    assert b"Calorie deficit calendar" in response.data
    assert b"Open navigation menu" in response.data
    assert b'<div class="menu-title">MyDiet</div>' in response.data
    assert b">Dashboard</a>" in response.data
    assert b">Entry</a>" in response.data
    assert b">Weight</a>" in response.data
    assert b">Profile</a>" in response.data
    assert b"data-menu-close" in response.data
    assert b"/static/nav.js?v=20260614-6" in response.data
    assert b'class="logout-form"' in response.data
    assert b"Log out" in response.data


def test_dashboard_shows_entry_day_energy_balance() -> None:
    repo = MemoryDietRepository()
    repo.save_entry(
        "halil",
        "2026-06-13",
        {
            "diary_text": "sample",
            "image_urls": [],
            "analysis": {
                "food_calories": 1400,
                "burned_calories": 2800,
                "activity_calories": 700,
                "calorie_deficit": 1400,
            },
        },
    )
    app = create_app(settings=_settings(), repository=repo)

    response = app.test_client().get("/?range=14d")

    assert response.status_code == 200
    assert b"Energy balance" in response.data
    assert b"Eaten" in response.data
    assert b"1400 kcal" in response.data
    assert b"Burned" in response.data
    assert b"Basal 2100 kcal" in response.data
    assert b"Activity 700 kcal" in response.data
    assert b"Deficit" in response.data
    assert b"recorded days" in response.data
    assert b'<div id="calorieChart" class="svg-chart"' in response.data
    assert b"Activity trend" in response.data
    assert b'<div id="activityChart" class="svg-chart"' in response.data
    assert b"Update weight" in response.data


def test_balance_summary_builds_bar_segments() -> None:
    summary = _balance_summary(
        {
            "food": 1400,
            "burned": 2800,
            "activity": 700,
            "deficit": 1400,
        }
    )

    assert summary["balance_label"] == "Deficit"
    assert summary["deficit_abs"] == 1400
    assert summary["food_pct"] == 50
    assert summary["burned_pct"] == 100
    assert summary["basal"] == 2100
    assert summary["basal_pct"] == 75
    assert summary["activity_pct"] == 25


def test_dashboard_weight_series_uses_selected_range() -> None:
    repo = MemoryDietRepository()
    repo.save_weight("halil", "2026-05-01", 90.0)
    repo.save_weight("halil", "2026-06-13", 82.4)
    app = create_app(settings=_settings(), repository=repo)

    response = app.test_client().get("/?range=14d")

    assert response.status_code == 200
    assert b'"weight": 82.4' in response.data
    assert b'"weight": 90.0' not in response.data
    assert f'"date": "{date_window(14)[0]}"'.encode() in response.data


def test_dashboard_calendar_has_month_navigation() -> None:
    app = create_app(settings=_settings(), repository=MemoryDietRepository())

    response = app.test_client().get("/?range=30d&month=2026-01")

    assert response.status_code == 200
    assert b'aria-label="Previous month"' in response.data
    assert b"data-calendar-link" in response.data
    assert b"/?range=30d&amp;month=2025-12" in response.data
    assert b'aria-label="Next month"' in response.data
    assert b"/?range=30d&amp;month=2026-02" in response.data
    assert b'data-calendar-month' in response.data
    assert b">Show</button>" not in response.data
    assert b"/static/styles.css?v=20260614-6" in response.data
    assert b"/static/charts.js?v=20260614-6" in response.data
    assert b"/static/dashboard.js?v=20260614-6" in response.data


def test_shift_month_handles_year_edges() -> None:
    assert _shift_month("2026-01", -1) == "2025-12"
    assert _shift_month("2026-12", 1) == "2027-01"


def test_date_range_label_formats_month_context() -> None:
    assert _date_range_label("2026-06-01", "2026-06-14") == "June 1-14, 2026"
    assert _date_range_label("2026-05-31", "2026-06-14") == "May 31 - Jun 14, 2026"
    assert _date_range_label("2025-12-31", "2026-01-02") == "Dec 31, 2025 - Jan 2, 2026"


def test_trend_series_marks_empty_days_without_zero_values() -> None:
    series = _trend_series(
        ["2026-06-12", "2026-06-13"],
        [
            {
                "date": "2026-06-13",
                "analysis": {
                    "food_calories": 1400,
                    "burned_calories": 2600,
                    "activity_calories": 400,
                    "calorie_deficit": 1200,
                },
            }
        ],
    )

    assert series[0] == {"date": "2026-06-12", "has_data": False}
    assert series[1]["has_data"] is True
    assert series[1]["food"] == 1400


def test_weight_series_uses_full_selected_date_window() -> None:
    series = _weight_series(
        ["2026-06-11", "2026-06-12", "2026-06-13"],
        [{"date": "2026-06-13", "weight_kg": 82.4}],
    )

    assert series[0] == {"date": "2026-06-11", "has_data": False}
    assert series[1] == {"date": "2026-06-12", "has_data": False}
    assert series[2] == {"date": "2026-06-13", "has_data": True, "weight": 82.4}


def test_entry_post_saves_fallback_analysis() -> None:
    repo = MemoryDietRepository()
    app = create_app(settings=_settings(), repository=repo)

    response = app.test_client().post(
        "/entry",
        data={
            "date": "2026-06-13",
            "weight_kg": "82.4",
            "diary_text": "Breakfast eggs, lunch chicken salad, dinner soup, 45 minute walk.",
        },
        follow_redirects=True,
    )
    entry = repo.get_entry("halil", "2026-06-13")

    assert response.status_code == 200
    assert entry["analysis"]["confidence"] == "low"
    assert repo.get_profile("halil") == {}


def test_entry_post_replaces_existing_day() -> None:
    repo = MemoryDietRepository()
    repo.save_entry(
        "halil",
        "2026-06-13",
        {
            "diary_text": "old",
            "image_urls": ["/uploads/old.jpg"],
            "analysis": {"food_calories": 123},
            "stale_field": "remove me",
        },
    )
    app = create_app(settings=_settings(), repository=repo)

    response = app.test_client().post(
        "/entry",
        data={
            "date": "2026-06-13",
            "diary_text": "new lunch and a walk",
        },
        follow_redirects=True,
    )
    entry = repo.get_entry("halil", "2026-06-13")

    assert response.status_code == 200
    assert entry["diary_text"] == "new lunch and a walk"
    assert entry["image_urls"] == []
    assert "stale_field" not in entry


def test_entry_post_deletes_old_uploaded_files(tmp_path: Path) -> None:
    repo = MemoryDietRepository()
    old_file = tmp_path / "old.jpg"
    old_file.write_text("old", encoding="utf-8")
    repo.save_entry(
        "halil",
        "2026-06-13",
        {
            "diary_text": "old",
            "image_urls": ["/uploads/old.jpg"],
            "analysis": {},
        },
    )
    settings = _settings()
    settings.app_config["upload_dir"] = str(tmp_path)
    app = create_app(settings=settings, repository=repo)

    response = app.test_client().post(
        "/entry",
        data={"date": "2026-06-13", "diary_text": "replacement"},
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert not old_file.exists()


def test_weight_post_logs_weight_separately() -> None:
    repo = MemoryDietRepository()
    app = create_app(settings=_settings(), repository=repo)

    response = app.test_client().post(
        "/weight",
        data={"date": "2026-06-13", "weight_kg": "82.4"},
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert repo.get_profile("halil")["weight_kg"] == 82.4
    assert repo.list_weight_logs(
        "halil",
        start_date="2026-06-13",
        end_date="2026-06-13",
    )[0]["weight_kg"] == 82.4


def test_weight_page_renders_log_form_and_recent_weights() -> None:
    repo = MemoryDietRepository()
    repo.save_weight("halil", "2026-06-13", 82.4)
    app = create_app(settings=_settings(), repository=repo)

    response = app.test_client().get("/weight")

    assert response.status_code == 200
    assert b"Weight log" in response.data
    assert b"Log weight" in response.data
    assert b"82.4 kg" in response.data
    assert b"data-loading-form" in response.data


def test_entry_form_includes_loading_state() -> None:
    app = create_app(settings=_settings(), repository=MemoryDietRepository())

    response = app.test_client().get("/entry?date=2026-06-13")

    assert response.status_code == 200
    assert b"/static/forms.js?v=20260614-6" in response.data
    assert b"data-loading-form" in response.data
    assert b"data-loading-status" in response.data
    assert b"data-loading-status hidden" in response.data
    assert b"Analyzing..." in response.data
    assert b"Log weight" not in response.data


def test_profile_form_includes_loading_state() -> None:
    app = create_app(settings=_settings(), repository=MemoryDietRepository())

    response = app.test_client().get("/profile")

    assert response.status_code == 200
    assert b"data-loading-form" in response.data
    assert b"data-loading-status" in response.data
    assert b"data-loading-status hidden" in response.data
    assert b"Saving..." in response.data


def test_login_post_accepts_configured_password() -> None:
    settings = Settings(
        APP_ENV="test",
        APP_PASSWORD="secret",
        APP_PASSWORD_HASH="",
        FLASK_SECRET_KEY="test",
        GEMINI_API_KEY="",
        SINGLE_USER_ID="halil",
        USE_MEMORY_REPOSITORY=True,
    )
    app = create_app(settings=settings, repository=MemoryDietRepository())

    response = app.test_client().post("/login", data={"password": "secret"})

    assert response.status_code == 302
    assert response.headers["Location"] == "/"


def test_login_post_accepts_configured_password_hash() -> None:
    settings = Settings(
        APP_ENV="test",
        APP_PASSWORD="",
        APP_PASSWORD_HASH=generate_password_hash("secret"),
        FLASK_SECRET_KEY="test",
        GEMINI_API_KEY="",
        SINGLE_USER_ID="halil",
        USE_MEMORY_REPOSITORY=True,
    )
    app = create_app(settings=settings, repository=MemoryDietRepository())

    response = app.test_client().post("/login", data={"password": "secret"})

    assert response.status_code == 302
    assert response.headers["Location"] == "/"


def _settings() -> Settings:
    return Settings(
        APP_ENV="test",
        APP_PASSWORD="",
        APP_PASSWORD_HASH="",
        FLASK_SECRET_KEY="test",
        GEMINI_API_KEY="",
        SINGLE_USER_ID="halil",
        USE_MEMORY_REPOSITORY=True,
    )
