from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mydiet.settings import Settings


class DietRepository:
    """Stores each profile, day and weight log as a JSON document in a local SQLite file."""

    def __init__(self, settings: Settings) -> None:
        self.path = settings.database_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(_SCHEMA)

    def get_profile(self, user_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT data FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
        return json.loads(row[0]) if row else {}

    def save_profile(self, user_id: str, payload: dict[str, Any]) -> None:
        profile = {**self.get_profile(user_id), **payload, "updated_at": _iso_now()}
        with self._connect() as db:
            db.execute(
                "INSERT INTO profiles (user_id, data) VALUES (?, ?) "
                "ON CONFLICT (user_id) DO UPDATE SET data = excluded.data",
                (user_id, _dumps(profile)),
            )

    def get_entry(self, user_id: str, entry_date: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute(
                "SELECT data FROM daily_entries WHERE user_id = ? AND date = ?", (user_id, entry_date)
            ).fetchone()
        if not row:
            return {}
        return {**json.loads(row[0]), "id": entry_date}

    def save_entry(self, user_id: str, entry_date: str, payload: dict[str, Any]) -> None:
        entry = {**payload, "date": entry_date, "updated_at": _iso_now()}
        self._put("daily_entries", user_id, entry_date, entry)

    def list_entries(self, user_id: str, *, start_date: str, end_date: str) -> list[dict[str, Any]]:
        return self._range("daily_entries", user_id, start_date, end_date)

    def list_all_entries(self, user_id: str) -> list[dict[str, Any]]:
        return self._range("daily_entries", user_id, "0000-00-00", "9999-99-99")

    def update_entry_analysis(self, user_id: str, entry_date: str, analysis: dict[str, Any]) -> None:
        entry = self.get_entry(user_id, entry_date)
        entry.pop("id", None)
        self._put(
            "daily_entries",
            user_id,
            entry_date,
            {**entry, "date": entry_date, "analysis": analysis, "updated_at": _iso_now()},
        )

    def list_weight_logs(self, user_id: str, *, start_date: str, end_date: str) -> list[dict[str, Any]]:
        return self._range("weight_logs", user_id, start_date, end_date)

    def save_weight(self, user_id: str, entry_date: str, weight_kg: float) -> None:
        log = {"date": entry_date, "weight_kg": weight_kg, "updated_at": _iso_now()}
        self._put("weight_logs", user_id, entry_date, log)
        self.save_profile(user_id, {"weight_kg": weight_kg})

    def _connect(self) -> sqlite3.Connection:
        return closing_connection(self.path)

    def _put(self, table: str, user_id: str, entry_date: str, data: dict[str, Any]) -> None:
        with self._connect() as db:
            db.execute(
                f"INSERT INTO {table} (user_id, date, data) VALUES (?, ?, ?) "
                "ON CONFLICT (user_id, date) DO UPDATE SET data = excluded.data",
                (user_id, entry_date, _dumps(data)),
            )

    def _range(self, table: str, user_id: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                f"SELECT date, data FROM {table} WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date",
                (user_id, start_date, end_date),
            ).fetchall()
        return [{**json.loads(data), "id": date} for date, data in rows]


_SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_entries (
  user_id TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS weight_logs (
  user_id TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, date)
);
"""


@contextmanager
def closing_connection(path: Path) -> Iterator[sqlite3.Connection]:
    """A short-lived connection per call, so gunicorn's threads never share one."""
    db = sqlite3.connect(path, timeout=10)
    try:
        with db:
            yield db
    finally:
        db.close()


def _dumps(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)


class MemoryDietRepository:
    def __init__(self) -> None:
        self.profiles: dict[str, dict[str, Any]] = {}
        self.entries_by_user: dict[str, dict[str, dict[str, Any]]] = {}
        self.weights_by_user: dict[str, dict[str, dict[str, Any]]] = {}

    def get_profile(self, user_id: str) -> dict[str, Any]:
        return dict(self.profiles.get(user_id, {}))

    def save_profile(self, user_id: str, payload: dict[str, Any]) -> None:
        profile = self.profiles.setdefault(user_id, {})
        profile.update(payload)
        profile["updated_at"] = _iso_now()

    def get_entry(self, user_id: str, entry_date: str) -> dict[str, Any]:
        data = self.entries_by_user.get(user_id, {}).get(entry_date, {})
        return dict(data)

    def save_entry(self, user_id: str, entry_date: str, payload: dict[str, Any]) -> None:
        entries = self.entries_by_user.setdefault(user_id, {})
        entries[entry_date] = {
            **payload,
            "date": entry_date,
            "updated_at": _iso_now(),
        }

    def list_entries(self, user_id: str, *, start_date: str, end_date: str) -> list[dict[str, Any]]:
        return [
            dict(entry)
            for date_key, entry in sorted(self.entries_by_user.get(user_id, {}).items())
            if start_date <= date_key <= end_date
        ]

    def list_all_entries(self, user_id: str) -> list[dict[str, Any]]:
        return [
            {**dict(entry), "id": date_key, "date": entry.get("date") or date_key}
            for date_key, entry in sorted(self.entries_by_user.get(user_id, {}).items())
        ]

    def update_entry_analysis(self, user_id: str, entry_date: str, analysis: dict[str, Any]) -> None:
        entries = self.entries_by_user.setdefault(user_id, {})
        entry = entries.setdefault(entry_date, {"date": entry_date})
        entry["analysis"] = analysis
        entry["updated_at"] = _iso_now()

    def list_weight_logs(self, user_id: str, *, start_date: str, end_date: str) -> list[dict[str, Any]]:
        return [
            dict(log)
            for date_key, log in sorted(self.weights_by_user.get(user_id, {}).items())
            if start_date <= date_key <= end_date
        ]

    def save_weight(self, user_id: str, entry_date: str, weight_kg: float) -> None:
        weights = self.weights_by_user.setdefault(user_id, {})
        weights[entry_date] = {
            "date": entry_date,
            "weight_kg": weight_kg,
            "updated_at": _iso_now(),
        }
        self.save_profile(user_id, {"weight_kg": weight_kg})


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()
