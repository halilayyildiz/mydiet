from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore

from mydiet.settings import Settings


class DietRepository:
    def __init__(self, settings: Settings) -> None:
        kwargs: dict[str, Any] = {}
        if settings.firestore_project_for_env:
            kwargs["project"] = settings.firestore_project_for_env
        if settings.firestore_database_for_env:
            kwargs["database"] = settings.firestore_database_for_env
        self.client = firestore.Client(**kwargs)

    def get_profile(self, user_id: str) -> dict[str, Any]:
        snapshot = self._profile_ref(user_id).get()
        return snapshot.to_dict() or {}

    def save_profile(self, user_id: str, payload: dict[str, Any]) -> None:
        self._profile_ref(user_id).set(
            {
                **payload,
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def get_entry(self, user_id: str, entry_date: str) -> dict[str, Any]:
        snapshot = self._entry_ref(user_id, entry_date).get()
        data = snapshot.to_dict() or {}
        if data:
            data["id"] = snapshot.id
        return data

    def save_entry(self, user_id: str, entry_date: str, payload: dict[str, Any]) -> None:
        self._entry_ref(user_id, entry_date).set(
            {
                **payload,
                "date": entry_date,
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
        )

    def list_entries(self, user_id: str, *, start_date: str, end_date: str) -> list[dict[str, Any]]:
        query = (
            self._entries_ref(user_id)
            .where("date", ">=", start_date)
            .where("date", "<=", end_date)
            .order_by("date")
        )
        entries: list[dict[str, Any]] = []
        for snapshot in query.stream():
            entries.append({**(snapshot.to_dict() or {}), "id": snapshot.id})
        return entries

    def list_all_entries(self, user_id: str) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for snapshot in self._entries_ref(user_id).stream():
            data = snapshot.to_dict() or {}
            entries.append({**data, "id": snapshot.id, "date": data.get("date") or snapshot.id})
        return sorted(entries, key=lambda entry: str(entry.get("date") or entry.get("id") or ""))

    def update_entry_analysis(self, user_id: str, entry_date: str, analysis: dict[str, Any]) -> None:
        self._entry_ref(user_id, entry_date).set(
            {
                "analysis": analysis,
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def list_weight_logs(self, user_id: str, *, start_date: str, end_date: str) -> list[dict[str, Any]]:
        query = (
            self._weights_ref(user_id)
            .where("date", ">=", start_date)
            .where("date", "<=", end_date)
            .order_by("date")
        )
        logs: list[dict[str, Any]] = []
        for snapshot in query.stream():
            logs.append({**(snapshot.to_dict() or {}), "id": snapshot.id})
        return logs

    def save_weight(self, user_id: str, entry_date: str, weight_kg: float) -> None:
        self._weights_ref(user_id).document(entry_date).set(
            {
                "date": entry_date,
                "weight_kg": weight_kg,
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        self.save_profile(user_id, {"weight_kg": weight_kg})

    def _user_ref(self, user_id: str) -> Any:
        return self.client.collection("users").document(user_id)

    def _profile_ref(self, user_id: str) -> Any:
        return self._user_ref(user_id).collection("profile").document("current")

    def _entries_ref(self, user_id: str) -> Any:
        return self._user_ref(user_id).collection("daily_entries")

    def _entry_ref(self, user_id: str, entry_date: str) -> Any:
        return self._entries_ref(user_id).document(entry_date)

    def _weights_ref(self, user_id: str) -> Any:
        return self._user_ref(user_id).collection("weight_logs")


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
