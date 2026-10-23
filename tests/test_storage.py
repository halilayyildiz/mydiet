from __future__ import annotations

from pathlib import Path

from mydiet.settings import Settings
from mydiet.storage import DietRepository


def _repo(tmp_path: Path) -> DietRepository:
    return DietRepository(Settings(MYDIET_DB=tmp_path / "mydiet.db"))


def test_entries_round_trip_and_list_by_date_range(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.save_entry("halil", "2026-10-02", {"diary_text": "kahvaltı", "analysis": {"calories_in": 500}})
    repo.save_entry("halil", "2026-10-01", {"diary_text": "öğle"})
    repo.save_entry("halil", "2026-10-05", {"diary_text": "akşam"})
    repo.save_entry("other", "2026-10-02", {"diary_text": "x"})

    entry = repo.get_entry("halil", "2026-10-02")
    assert entry["diary_text"] == "kahvaltı"
    assert entry["analysis"] == {"calories_in": 500}
    assert entry["date"] == "2026-10-02"
    assert entry["id"] == "2026-10-02"
    assert repo.get_entry("halil", "2026-10-03") == {}

    listed = repo.list_entries("halil", start_date="2026-10-01", end_date="2026-10-02")
    assert [item["date"] for item in listed] == ["2026-10-01", "2026-10-02"]


def test_saving_an_entry_replaces_the_day(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.save_entry("halil", "2026-10-01", {"diary_text": "a", "image_urls": ["/uploads/x.jpg"]})
    repo.save_entry("halil", "2026-10-01", {"diary_text": "b"})
    assert "image_urls" not in repo.get_entry("halil", "2026-10-01")


def test_profile_merges_and_weight_updates_profile(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.save_profile("halil", {"height_cm": 180, "weight_kg": 90})
    repo.save_weight("halil", "2026-10-01", 88.5)

    profile = _repo(tmp_path).get_profile("halil")
    assert profile["height_cm"] == 180
    assert profile["weight_kg"] == 88.5
    logs = repo.list_weight_logs("halil", start_date="2026-01-01", end_date="2026-12-31")
    assert [(log["date"], log["weight_kg"]) for log in logs] == [("2026-10-01", 88.5)]
