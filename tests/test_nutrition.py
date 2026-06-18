from __future__ import annotations

from mydiet.nutrition import date_window, food_item_groups, month_window, normalize_analysis


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
    payload = normalize_analysis(
        {
            "food_calories": "1200.4",
            "assumptions": ["estimated"],
            "food_items": [
                {
                    "name": "Chicken salad",
                    "meal": "lunch",
                    "calories": "520.6",
                    "protein_g": "42",
                    "carbs_g": "18",
                    "fat_g": "22",
                },
                {"name": "", "calories": 10},
                "ignore",
            ],
        }
    )

    assert payload["food_calories"] == 1200
    assert payload["burned_calories"] == 0
    assert payload["assumptions"] == ["estimated"]
    assert payload["food_items"] == [
        {
            "name": "Chicken salad",
            "meal": "lunch",
            "calories": 521,
            "protein_g": 42,
            "carbs_g": 18,
            "fat_g": 22,
        }
    ]


def test_food_item_groups_orders_meals_and_totals_calories() -> None:
    groups = food_item_groups(
        {
            "food_items": [
                {"name": "Coffee", "meal": "morning", "calories": 60},
                {"name": "Steak", "meal": "dinner", "calories": 500},
                {"name": "Strawberries", "meal": "snacks", "calories": 90},
                {"name": "Salad", "meal": "dinner", "calories": 120},
            ]
        }
    )

    assert [group["label"] for group in groups] == ["Morning", "Dinner", "Snacks"]
    assert groups[0]["calories"] == 60
    assert groups[1]["calories"] == 620
