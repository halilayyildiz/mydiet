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
    assert names == {"log_food", "set_day", "get_day", "list_days", "log_weight"}


def test_log_food_appends_to_the_day_and_analyzes_it() -> None:
    repo = MemoryDietRepository()
    client = _client(repo)

    _call(client, "log_food", {"text": "2 yumurta", "date": "2026-10-23"})
    result = _call(client, "log_food", {"text": "1 elma", "date": "2026-10-23"})

    payload = json.loads(result["content"][0]["text"])
    assert payload["diary_text"] == "2 yumurta\n1 elma"
    assert repo.get_entry("halil", "2026-10-23")["analysis"]["food_calories"] >= 0
    day = json.loads(_call(client, "get_day", {"date": "2026-10-23"})["content"][0]["text"])
    assert day["diary_text"] == "2 yumurta\n1 elma"
    days = json.loads(
        _call(client, "list_days", {"start_date": "2026-10-01", "end_date": "2026-10-31"})["content"][0]["text"]
    )
    assert [item["date"] for item in days["days"]] == ["2026-10-23"]


def test_bad_date_is_a_tool_error() -> None:
    result = _call(_client(), "log_food", {"text": "çay", "date": "dün"})
    assert result["isError"] is True


def test_log_weight_records_weight() -> None:
    repo = MemoryDietRepository()
    _call(_client(repo), "log_weight", {"weight_kg": 84.2, "date": "2026-10-23"})
    assert repo.get_profile("halil")["weight_kg"] == 84.2
