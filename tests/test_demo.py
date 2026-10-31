from __future__ import annotations

from datetime import date

from mydiet.app import create_app
from mydiet.demo import DEMO_USER, ensure_demo_data
from mydiet.settings import Settings
from mydiet.storage import MemoryDietRepository


def _client(repo: MemoryDietRepository):
    settings = Settings(APP_PASSWORD="secret", FLASK_SECRET_KEY="test", ANTHROPIC_API_KEY="")
    return create_app(settings=settings, repository=repo).test_client()


def test_demo_data_covers_90_days_from_101_to_92_kg_with_some_surplus_days() -> None:
    repo = MemoryDietRepository()
    ensure_demo_data(repo, date(2026, 10, 24))

    entries = repo.list_all_entries(DEMO_USER)
    weights = repo.list_weight_logs(DEMO_USER, start_date="2026-01-01", end_date="2026-12-31")
    assert len(entries) == 90
    assert entries[0]["date"] == "2026-07-27" and entries[-1]["date"] == "2026-10-24"
    assert weights[0]["weight_kg"] == 101.0 and weights[-1]["weight_kg"] == 92.0
    deficits = [entry["analysis"]["calorie_deficit"] for entry in entries]
    assert any(value < 0 for value in deficits)
    assert sum(deficits) / len(deficits) > 0


def test_demo_is_separate_from_real_data_and_read_only() -> None:
    repo = MemoryDietRepository()
    client = _client(repo)

    response = client.get("/demo")
    assert response.status_code == 302
    dashboard = client.get("/?range=90d")
    assert dashboard.status_code == 200
    assert b"Exit demo" in dashboard.data

    client.post("/weight", data={"date": "2026-10-24", "weight_kg": "80"})
    assert repo.get_profile(DEMO_USER) == {}
    assert repo.list_weight_logs("halil", start_date="2026-01-01", end_date="2026-12-31") == []

    client.get("/demo/exit")
    assert client.get("/").status_code == 302


def test_first_time_visitor_lands_on_english_demo_and_returning_visitor_gets_login() -> None:
    client = _client(MemoryDietRepository())

    response = client.get("/")
    assert response.status_code == 302 and response.location.endswith("/demo")
    client.get("/demo")
    assert b"Exit demo" in client.get("/?range=90d").data

    # Still a first-timer while only the demo has been seen.
    client.get("/demo/exit")
    # Exiting the demo shows the login page, which marks the visitor as known.
    client.get("/login")
    response = client.get("/")
    assert response.status_code == 302 and "/login" in response.location


def test_visitor_who_has_seen_login_page_is_not_sent_to_demo() -> None:
    client = _client(MemoryDietRepository())
    client.get("/login")
    response = client.get("/")
    assert "/login" in response.location
