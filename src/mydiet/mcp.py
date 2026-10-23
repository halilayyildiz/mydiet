"""A small MCP server (streamable HTTP, JSON responses) so a Claude chat can log meals here.

claude.ai connects to https://<host>/mcp/<MCP_TOKEN>; the secret path is the only credential.
"""

from __future__ import annotations

import hmac
import json
from datetime import date, datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from flask import Flask, Response, abort, jsonify, request

from mydiet.claude_client import analyze_entry
from mydiet.settings import Settings
from mydiet.storage import DietRepository, MemoryDietRepository

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "mydiet", "version": "0.1.0"}

_DATE = {
    "type": "string",
    "description": "Day as YYYY-MM-DD. Defaults to today in the user's timezone (Europe/Amsterdam).",
}

TOOLS = [
    {
        "name": "log_food",
        "description": (
            "Add what the user ate or did (food, drinks, exercise) to a day's diary in MyDiet. "
            "The text is appended to that day's existing notes and the whole day is re-analyzed for "
            "calories and macros. Use the user's own words; pass only the new items, not the whole day."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string", "description": "New diary text."}, "date": _DATE},
            "required": ["text"],
        },
    },
    {
        "name": "set_day",
        "description": (
            "Replace a day's whole diary text in MyDiet and re-analyze it. Use to correct a day; "
            "call get_day first so nothing already logged is lost."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string", "description": "The full diary for the day."}, "date": _DATE},
            "required": ["text"],
        },
    },
    {
        "name": "get_day",
        "description": "Read a day's diary text and its calorie/macro analysis from MyDiet.",
        "inputSchema": {"type": "object", "properties": {"date": _DATE}},
    },
    {
        "name": "list_days",
        "description": "Calories eaten, burned and deficit for each logged day in a date range.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "YYYY-MM-DD"},
                "end_date": {"type": "string", "description": "YYYY-MM-DD"},
            },
            "required": ["start_date", "end_date"],
        },
    },
    {
        "name": "log_weight",
        "description": "Record the user's body weight in kg for a day.",
        "inputSchema": {
            "type": "object",
            "properties": {"weight_kg": {"type": "number"}, "date": _DATE},
            "required": ["weight_kg"],
        },
    },
]


class ToolError(ValueError):
    pass


def register_mcp(app: Flask, repo: DietRepository | MemoryDietRepository, settings: Settings) -> None:
    user_id = settings.single_user_id

    def day(args: dict[str, Any]) -> str:
        value = args.get("date")
        if not value:
            return datetime.now(ZoneInfo(settings.timezone)).date().isoformat()
        try:
            return date.fromisoformat(str(value)).isoformat()
        except ValueError:
            raise ToolError(f"Invalid date {value!r}; use YYYY-MM-DD.") from None

    def save_day(entry_date: str, diary_text: str) -> dict[str, Any]:
        entry = repo.get_entry(user_id, entry_date)
        analysis = analyze_entry(
            settings,
            diary_text=diary_text,
            profile=repo.get_profile(user_id),
            entry_date=entry_date,
            image_paths=[],
            language="tr",
        )
        repo.save_entry(
            user_id,
            entry_date,
            {"diary_text": diary_text, "image_urls": entry.get("image_urls") or [], "analysis": analysis},
        )
        return {"date": entry_date, "diary_text": diary_text, "analysis": analysis}

    def log_food(args: dict[str, Any]) -> dict[str, Any]:
        text = str(args.get("text") or "").strip()
        if not text:
            raise ToolError("text is empty.")
        entry_date = day(args)
        existing = str(repo.get_entry(user_id, entry_date).get("diary_text") or "").strip()
        return save_day(entry_date, f"{existing}\n{text}" if existing else text)

    def set_day(args: dict[str, Any]) -> dict[str, Any]:
        return save_day(day(args), str(args.get("text") or "").strip())

    def get_day(args: dict[str, Any]) -> dict[str, Any]:
        entry_date = day(args)
        entry = repo.get_entry(user_id, entry_date)
        if not entry:
            return {"date": entry_date, "logged": False}
        return {"date": entry_date, "diary_text": entry.get("diary_text", ""), "analysis": entry.get("analysis")}

    def list_days(args: dict[str, Any]) -> dict[str, Any]:
        start, end = day({"date": args.get("start_date")}), day({"date": args.get("end_date")})
        days = []
        for entry in repo.list_entries(user_id, start_date=start, end_date=end):
            analysis = entry.get("analysis") or {}
            days.append(
                {
                    "date": entry.get("date"),
                    "food_calories": analysis.get("food_calories"),
                    "burned_calories": analysis.get("burned_calories"),
                    "calorie_deficit": analysis.get("calorie_deficit"),
                }
            )
        return {"days": days}

    def log_weight(args: dict[str, Any]) -> dict[str, Any]:
        try:
            weight_kg = float(args["weight_kg"])
        except (KeyError, TypeError, ValueError):
            raise ToolError("weight_kg must be a number.") from None
        entry_date = day(args)
        repo.save_weight(user_id, entry_date, weight_kg)
        return {"date": entry_date, "weight_kg": weight_kg}

    handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
        "log_food": log_food,
        "set_day": set_day,
        "get_day": get_day,
        "list_days": list_days,
        "log_weight": log_weight,
    }

    def call_tool(params: dict[str, Any]) -> dict[str, Any]:
        handler = handlers.get(params.get("name", ""))
        if handler is None:
            raise LookupError(f"Unknown tool {params.get('name')!r}")
        try:
            result = handler(params.get("arguments") or {})
        except ToolError as exc:
            return {"content": [{"type": "text", "text": str(exc)}], "isError": True}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, default=str)}]}

    def handle(message: dict[str, Any]) -> dict[str, Any] | None:
        method = message.get("method")
        if "id" not in message:
            return None  # notifications need no answer
        try:
            if method == "initialize":
                result: dict[str, Any] = {
                    "protocolVersion": (message.get("params") or {}).get("protocolVersion") or PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": SERVER_INFO,
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                result = call_tool(message.get("params") or {})
            else:
                return _error(message["id"], -32601, f"Method not found: {method}")
        except LookupError as exc:
            return _error(message["id"], -32602, str(exc))
        return {"jsonrpc": "2.0", "id": message["id"], "result": result}

    @app.route("/mcp/<token>", methods=["GET", "POST", "DELETE"], endpoint="mcp")
    def mcp(token: str) -> Any:
        if not settings.mcp_token or not hmac.compare_digest(token, settings.mcp_token):
            abort(404)
        if request.method != "POST":
            return Response(status=405, headers={"Allow": "POST"})
        payload = request.get_json(silent=True)
        if isinstance(payload, list):
            replies = [reply for reply in (handle(item) for item in payload) if reply]
            return jsonify(replies) if replies else Response(status=202)
        if not isinstance(payload, dict):
            return jsonify(_error(None, -32700, "Parse error")), 400
        reply = handle(payload)
        return jsonify(reply) if reply else Response(status=202)


def _error(message_id: Any, code: int, text: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": message_id, "error": {"code": code, "message": text}}
