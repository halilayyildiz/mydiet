from __future__ import annotations

from mydiet.nutrition import date_window, month_window, normalize_analysis


def test_date_window_returns_requested_days() -> None:
    assert date_window(3, end=__import__("datetime").date(2026, 6, 13)) == [
        "2026-06-11",
        "2026-06-12",
        "2026-06-13",
    ]


def test_month_window_handles_june() -> None:
    days = month_window("2026-06")

    assert days[0] == "2026-06-01"
    assert days[-1] == "2026-06-30"


def test_normalize_analysis_casts_numbers() -> None:
    payload = normalize_analysis({"food_calories": "1200.4", "assumptions": ["estimated"]})

    assert payload["food_calories"] == 1200
    assert payload["burned_calories"] == 0
    assert payload["assumptions"] == ["estimated"]
