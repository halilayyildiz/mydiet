"""A small MCP server (streamable HTTP, JSON responses) so a Claude chat can save the days it
already worked out (foods, calories, activity) here.

claude.ai connects to https://<host>/mcp/<MCP_TOKEN>; the secret path is the only credential.
"""

from __future__ import annotations

import hmac
import json
from datetime import date, datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from flask import Flask, Response, abort, jsonify, request

from mydiet.nutrition import analysis_from_items
from mydiet.settings import Settings
from mydiet.storage import DietRepository, MemoryDietRepository

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "mydiet", "version": "0.1.0"}

_DATE = {
    "type": "string",
    "description": "Day as YYYY-MM-DD. Defaults to today in the user's timezone (Europe/Amsterdam).",
}

_FOOD_ITEM = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Short name in Turkish, e.g. \"2 haşlanmış yumurta\"."},
        "meal": {"type": "string", "enum": ["morning", "lunch", "dinner", "snacks"]},
        "calories": {"type": "number"},
        "protein_g": {"type": "number"},
        "carbs_g": {"type": "number"},
        "fat_g": {"type": "number"},
    },
    "required": ["name", "meal", "calories"],
}

TOOLS = [
    {
        "name": "save_day",
        "description": (
            "Save a day in MyDiet with the calories you already worked out in this chat. Send the "
            "WHOLE day every time (every food and drink so far, not just the new ones): it replaces "
            "what is stored for that date, so calling it again after each meal is safe. Totals and "
            "the deficit are computed from the items. Call get_day first if the day may hold items "
            "you don't know about."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "date": _DATE,
                "diary_text": {
                    "type": "string",
                    "description": "What the user wrote about the day, in their words (shown as the day's notes).",
                },
                "food_items": {"type": "array", "items": _FOOD_ITEM},
                "activity_calories": {
                    "type": "number",
                    "description": "Calories burned by exercise and activity beyond normal daily life.",
                },
                "burned_calories": {
                    "type": "number",
                    "description": (
                        "Total calories burned that day (BMR + activity). Omit to let MyDiet estimate it "
                        "from the profile plus activity_calories."
                    ),
                },
                "summary": {"type": "string", "description": "One or two sentences on the day, in Turkish."},
            },
            "required": ["diary_text", "food_items"],
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

    def save_day(args: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(args.get("food_items"), list):
            raise ToolError("food_items must be a list.")
        entry_date = day(args)
        entry = repo.get_entry(user_id, entry_date)
        analysis = analysis_from_items(
            repo.get_profile(user_id),
            food_items=args["food_items"],
            activity_calories=args.get("activity_calories"),
            burned_calories=args.get("burned_calories"),
            summary=str(args.get("summary") or ""),
        )
        diary_text = str(args.get("diary_text") or "").strip()
        repo.save_entry(
            user_id,
            entry_date,
            {"diary_text": diary_text, "image_urls": entry.get("image_urls") or [], "analysis": analysis},
        )
        totals = {key: analysis[key] for key in ("food_calories", "burned_calories", "calorie_deficit")}
        return {"date": entry_date, "saved_items": len(analysis["food_items"]), **totals}

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
        "save_day": save_day,
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
