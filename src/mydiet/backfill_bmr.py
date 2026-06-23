from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any

from mydiet.firestore_db import DietRepository
from mydiet.nutrition import compute_bmr_calories
from mydiet.settings import get_settings


@dataclass(frozen=True)
class BackfillChange:
    entry_date: str
    old_bmr: int
    new_bmr: int
    old_burned: int
    new_burned: int
    old_deficit: int
    new_deficit: int


def build_backfilled_analysis(analysis: dict[str, Any], bmr_calories: int) -> dict[str, Any]:
    updated = dict(analysis)
    food = _int(updated.get("food_calories"))
    activity = _int(updated.get("activity_calories"))
    burned = bmr_calories + activity
    updated["bmr_calories"] = bmr_calories
    updated["burned_calories"] = burned
    updated["calorie_deficit"] = burned - food
    return updated


def backfill_bmr(repository: Any, user_id: str, *, apply: bool = False) -> list[BackfillChange]:
    profile = repository.get_profile(user_id)
    bmr_calories = compute_bmr_calories(profile, use_stored=False)
    changes: list[BackfillChange] = []

    if apply:
        repository.save_profile(user_id, {"bmr_calories": bmr_calories})

    for entry in repository.list_all_entries(user_id):
        entry_date = str(entry.get("date") or entry.get("id") or "")
        analysis = entry.get("analysis") or {}
        if not entry_date or not isinstance(analysis, dict):
            continue
        updated = build_backfilled_analysis(analysis, bmr_calories)
        change = BackfillChange(
            entry_date=entry_date,
            old_bmr=_int(analysis.get("bmr_calories")),
            new_bmr=_int(updated.get("bmr_calories")),
            old_burned=_int(analysis.get("burned_calories")),
            new_burned=_int(updated.get("burned_calories")),
            old_deficit=_int(analysis.get("calorie_deficit")),
            new_deficit=_int(updated.get("calorie_deficit")),
        )
        if (
            change.old_bmr == change.new_bmr
            and change.old_burned == change.new_burned
            and change.old_deficit == change.new_deficit
        ):
            continue
        changes.append(change)
        if apply:
            repository.update_entry_analysis(user_id, entry_date, updated)

    return changes


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill daily entry BMR-derived analysis values.")
    parser.add_argument("--user", help="User id to backfill. Defaults to SINGLE_USER_ID.")
    parser.add_argument("--apply", action="store_true", help="Write changes. Omit for dry-run.")
    args = parser.parse_args()

    settings = get_settings()
    user_id = args.user or settings.single_user_id
    changes = backfill_bmr(DietRepository(settings), user_id, apply=args.apply)

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"{mode}: {len(changes)} entries need BMR backfill for user {user_id}.")
    for change in changes:
        print(
            f"{change.entry_date}: "
            f"bmr {change.old_bmr}->{change.new_bmr}, "
            f"burned {change.old_burned}->{change.new_burned}, "
            f"deficit {change.old_deficit}->{change.new_deficit}"
        )
    if not args.apply:
        print("No writes performed. Re-run with --apply to update Firestore.")


def _int(value: Any) -> int:
    try:
        return int(round(float(value or 0)))
    except (TypeError, ValueError):
        return 0


if __name__ == "__main__":
    main()
