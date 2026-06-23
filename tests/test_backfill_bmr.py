from __future__ import annotations

from mydiet.backfill_bmr import backfill_bmr
from mydiet.firestore_db import MemoryDietRepository


def test_backfill_bmr_dry_run_reports_without_writing() -> None:
    repo = _repo_with_old_entry()

    changes = backfill_bmr(repo, "halil")
    analysis = repo.get_entry("halil", "2026-06-13")["analysis"]

    assert len(changes) == 1
    assert changes[0].old_bmr == 0
    assert changes[0].new_bmr == 2165
    assert analysis["burned_calories"] == 2600
    assert "bmr_calories" not in analysis


def test_backfill_bmr_apply_updates_profile_and_entry_analysis() -> None:
    repo = _repo_with_old_entry()

    changes = backfill_bmr(repo, "halil", apply=True)
    profile = repo.get_profile("halil")
    analysis = repo.get_entry("halil", "2026-06-13")["analysis"]

    assert len(changes) == 1
    assert profile["bmr_calories"] == 2165
    assert analysis["bmr_calories"] == 2165
    assert analysis["burned_calories"] == 2565
    assert analysis["calorie_deficit"] == 1165


def _repo_with_old_entry() -> MemoryDietRepository:
    repo = MemoryDietRepository()
    repo.save_profile(
        "halil",
        {
            "age": 30,
            "gender": "male",
            "height_cm": 180,
            "weight_kg": 82.4,
            "activity_level": "low",
        },
    )
    repo.save_entry(
        "halil",
        "2026-06-13",
        {
            "diary_text": "walk",
            "image_urls": [],
            "analysis": {
                "food_calories": 1400,
                "activity_calories": 400,
                "burned_calories": 2600,
                "calorie_deficit": 1200,
            },
        },
    )
    return repo
