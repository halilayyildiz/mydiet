from __future__ import annotations

import json

from mydiet.app import create_app
from mydiet.settings import Settings
from mydiet.storage import MemoryDietRepository


def _client(repo: MemoryDietRepository | None = None):
    settings = Settings(
        APP_PASSWORD="secret", FLASK_SECRET_KEY="test", ANTHROPIC_API_KEY="", MCP_TOKEN="tok"
    )
    app = create_app(settings=settings, repository=repo or MemoryDietRepository())
    return app.test_client()


def _call(client, name: str, arguments: dict) -> dict:
    response = client.post(
        "/mcp/tok",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}},
    )
    assert response.status_code == 200
    return response.get_json()["result"]


def test_wrong_token_is_not_found_and_needs_no_login() -> None:
    client = _client()
    assert client.post("/mcp/nope", json={}).status_code == 404
    response = client.post("/mcp/tok", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert response.get_json()["result"]["serverInfo"]["name"] == "mydiet"
    assert client.post("/mcp/tok", json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202


def test_tools_list_names_every_tool() -> None:
    response = _client().post("/mcp/tok", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    names = {tool["name"] for tool in response.get_json()["result"]["tools"]}
    assert names == {"save_day", "get_day", "list_days", "log_weight", "list_weights"}


def test_save_day_stores_chat_calories_and_replaces_the_day() -> None:
    repo = MemoryDietRepository()
    client = _client(repo)
    breakfast = {"name": "2 yumurta", "meal": "morning", "calories": 150, "protein_g": 12, "fat_g": 10}

    _call(client, "save_day", {"date": "2026-10-23", "diary_text": "2 yumurta", "food_items": [breakfast]})
    result = _call(
        client,
        "save_day",
        {
            "date": "2026-10-23",
            "diary_text": "2 yumurta, öğlen tavuk salata, 30 dk koşu",
            "food_items": [
                breakfast,
                {"name": "tavuk salata", "meal": "lunch", "calories": 450, "protein_g": 35, "carbs_g": 20},
            ],
            "activity_calories": 300,
            "burned_calories": 2500,
            "summary": "Dengeli gün.",
        },
    )

    assert json.loads(result["content"][0]["text"]) == {
        "date": "2026-10-23",
        "saved_items": 2,
        "food_calories": 600,
        "burned_calories": 2500,
        "calorie_deficit": 1900,
    }
    analysis = repo.get_entry("halil", "2026-10-23")["analysis"]
    assert analysis["protein_g"] == 47
    assert analysis["activity_calories"] == 300
    assert analysis["summary"] == "Dengeli gün."
    day = json.loads(_call(client, "get_day", {"date": "2026-10-23"})["content"][0]["text"])
    assert day["diary_text"] == "2 yumurta, öğlen tavuk salata, 30 dk koşu"
    days = json.loads(
        _call(client, "list_days", {"start_date": "2026-10-01", "end_date": "2026-10-31"})["content"][0]["text"]
    )
    assert days["days"] == [
        {"date": "2026-10-23", "food_calories": 600, "burned_calories": 2500, "calorie_deficit": 1900}
    ]


def test_save_day_estimates_burned_calories_from_profile() -> None:
    repo = MemoryDietRepository()
    repo.save_profile("halil", {"weight_kg": 90, "height_cm": 180, "age": 40, "gender": "male"})
    _call(
        _client(repo),
        "save_day",
        {"diary_text": "x", "food_items": [], "activity_calories": 200, "date": "2026-10-23"},
    )
    # BMR 1830 * 1.1 (low activity) + 200
    assert repo.get_entry("halil", "2026-10-23")["analysis"]["burned_calories"] == 2213


def test_bad_date_is_a_tool_error() -> None:
    result = _call(_client(), "save_day", {"diary_text": "çay", "food_items": [], "date": "dün"})
    assert result["isError"] is True


def test_log_weight_records_weight() -> None:
    repo = MemoryDietRepository()
    _call(_client(repo), "log_weight", {"weight_kg": 84.2, "date": "2026-10-23"})
    assert repo.get_profile("halil")["weight_kg"] == 84.2


def test_list_weights_returns_range_and_change() -> None:
    repo = MemoryDietRepository()
    for entry_date, kg in [("2026-10-20", 85.0), ("2026-10-24", 92.85), ("2026-10-28", 91.9)]:
        repo.save_weight("halil", entry_date, kg)
    result = json.loads(
        _call(_client(repo), "list_weights", {"start_date": "2026-10-21", "end_date": "2026-10-31"})["content"][0]["text"]
    )
    assert result == {
        "weights": [{"date": "2026-10-24", "weight_kg": 92.85}, {"date": "2026-10-28", "weight_kg": 91.9}],
        "change_kg": -0.95,
    }


def test_weight_api_records_a_shortcut_weigh_in() -> None:
    repo = MemoryDietRepository()
    client = _client(repo)
    response = client.post("/api/tok/weight", json={"weight_kg": "82,4 kg", "date": "2026-10-24T08:12:00+02:00"})
    assert response.status_code == 200
    assert response.get_json() == {"date": "2026-10-24", "weight_kg": 82.4}
    assert repo.list_weight_logs("halil", start_date="2026-10-24", end_date="2026-10-24")[0]["weight_kg"] == 82.4
    assert repo.get_profile("halil")["weight_kg"] == 82.4


def test_weight_api_rejects_bad_token_and_bad_weight() -> None:
    client = _client()
    assert client.post("/api/nope/weight", json={"weight_kg": 80}).status_code == 404
    assert client.post("/api/tok/weight", json={"weight_kg": "abc"}).status_code == 400
    assert client.post("/api/tok/weight", json={"weight_kg": 5}).status_code == 400


def test_weight_api_finds_the_weight_in_shortcut_text() -> None:
    client = _client()
    for sent, expected in [
        ("28 Eki 2026 08:12 82,4 kg", 82.4),
        ("181.5 lb", 82.33),
        (82400, None),
        ({"value": 82.4, "unit": "kg"}, 82.4),
    ]:
        response = client.post("/api/tok/weight", json={"weight_kg": sent, "date": "2026-10-28"})
        if expected is None:
            assert response.status_code == 400 and "82400" in response.get_json()["error"]
        else:
            assert response.get_json()["weight_kg"] == expected, sent


def test_get_day_includes_the_days_weight() -> None:
    client = _client()
    client.post("/api/tok/weight", json={"weight_kg": 81.9, "date": "2026-10-28"})
    result = json.loads(_call(client, "get_day", {"date": "2026-10-28"})["content"][0]["text"])
    assert result["weight_kg"] == 81.9
