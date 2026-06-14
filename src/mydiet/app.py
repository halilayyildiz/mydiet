from __future__ import annotations

import secrets
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from flask import (
    Flask,
    flash,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.datastructures import FileStorage
from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename

from mydiet.firestore_db import DietRepository, MemoryDietRepository
from mydiet.gemini_client import GeminiDietClient
from mydiet.nutrition import (
    RANGE_OPTIONS,
    date_window,
    fallback_analysis,
    month_window,
    normalize_analysis,
    parse_iso_date,
    today_iso,
)
from mydiet.settings import Settings, get_settings


ASSET_VERSION = "20260614-5"


def create_app(
    settings: Settings | None = None,
    repository: DietRepository | MemoryDietRepository | None = None,
) -> Flask:
    settings = settings or get_settings()
    app = Flask(__name__, static_folder="../../static", template_folder="../../templates")
    app.config["SECRET_KEY"] = settings.flask_secret_key
    app.config["MAX_CONTENT_LENGTH"] = settings.max_upload_bytes
    app.config["UPLOAD_DIR"] = settings.upload_dir
    settings.upload_dir.mkdir(parents=True, exist_ok=True)

    repo = repository or (MemoryDietRepository() if settings.use_memory_repository else DietRepository(settings))

    @app.context_processor
    def inject_asset_version() -> dict[str, str]:
        return {"asset_version": ASSET_VERSION}

    @app.before_request
    def require_login() -> Any:
        if not settings.app_password and not settings.app_password_hash:
            session["authenticated"] = True
        if request.endpoint in {"login", "login_post", "static", "uploaded_file"}:
            return None
        if not session.get("authenticated"):
            return redirect(url_for("login", next=request.full_path))
        return None

    @app.get("/login")
    def login() -> str:
        return render_template("login.html")

    @app.post("/login")
    def login_post() -> Any:
        password = request.form.get("password", "")
        if _password_matches(settings, password):
            session["authenticated"] = True
            return redirect(request.args.get("next") or url_for("dashboard"))
        flash("Incorrect password.", "error")
        return redirect(url_for("login"))

    @app.post("/logout")
    def logout() -> Any:
        session.clear()
        return redirect(url_for("login"))

    @app.get("/")
    def dashboard() -> str:
        range_key = request.args.get("range", "14d")
        days = RANGE_OPTIONS.get(range_key, 14)
        dates = date_window(days)
        entries = repo.list_entries(settings.single_user_id, start_date=dates[0], end_date=dates[-1])
        weights = repo.list_weight_logs(
            settings.single_user_id,
            start_date=dates[0],
            end_date=dates[-1],
        )
        month = request.args.get("month") or today_iso()[:7]
        month_dates = month_window(month)
        month_entries = repo.list_entries(
            settings.single_user_id,
            start_date=month_dates[0],
            end_date=month_dates[-1],
        )
        averages = _averages(entries)
        return render_template(
            "dashboard.html",
            active_page="dashboard",
            range_key=range_key,
            range_options=RANGE_OPTIONS,
            trends=_trend_series(dates, entries),
            totals=_totals(entries),
            averages=averages,
            balance=_balance_summary(averages),
            recorded_days=len(entries),
            chart_range_label=_date_range_label(dates[0], dates[-1]),
            weight_series=_weight_series(dates, weights),
            calendar_days=_calendar_days(month_dates, month_entries),
            current_month=month,
            previous_month=_shift_month(month, -1),
            next_month=_shift_month(month, 1),
            today=today_iso(),
        )

    @app.get("/entry")
    def entry_form() -> str:
        entry_date = request.args.get("date") or today_iso()
        entry = repo.get_entry(settings.single_user_id, entry_date)
        return render_template(
            "entry.html",
            active_page="entry",
            entry=entry,
            entry_date=entry_date,
            today=today_iso(),
        )

    @app.post("/entry")
    def save_entry() -> Any:
        entry_date = request.form.get("date") or today_iso()
        diary_text = request.form.get("diary_text", "").strip()
        profile = repo.get_profile(settings.single_user_id)
        old_entry = repo.get_entry(settings.single_user_id, entry_date)
        image_paths, image_urls = _save_uploads(request.files.getlist("images"), settings)

        if settings.gemini_api_key and (diary_text or image_paths):
            try:
                analysis = GeminiDietClient(settings).analyze_day(
                    diary_text=diary_text,
                    profile=profile,
                    entry_date=entry_date,
                    image_paths=image_paths,
                )
                analysis = normalize_analysis(analysis)
            except Exception as exc:
                analysis = fallback_analysis(
                    diary_text,
                    profile,
                    reason=f"Gemini analysis failed: {exc}",
                )
                analysis["summary"] = f"Gemini analysis failed: {exc}"
        else:
            analysis = fallback_analysis(diary_text, profile)

        repo.save_entry(
            settings.single_user_id,
            entry_date,
            {
                "diary_text": diary_text,
                "image_urls": image_urls,
                "analysis": analysis,
            },
        )
        _delete_uploaded_files(old_entry.get("image_urls") or [], settings)
        flash("Day saved and analyzed.", "success")
        return redirect(url_for("entry_form", date=entry_date))

    @app.get("/weight")
    def weight() -> str:
        end_date = today_iso()
        start_date = (date.today() - timedelta(days=90)).isoformat()
        weight_logs = repo.list_weight_logs(
            settings.single_user_id,
            start_date=start_date,
            end_date=end_date,
        )
        return render_template(
            "weight.html",
            active_page="weight",
            today=end_date,
            weight_logs=list(reversed(weight_logs)),
        )

    @app.post("/weight")
    def save_weight() -> Any:
        entry_date = request.form.get("date") or today_iso()
        weight_text = request.form.get("weight_kg", "").strip()
        if not weight_text:
            flash("Enter a weight before logging it.", "error")
            return redirect(url_for("weight"))
        repo.save_weight(settings.single_user_id, entry_date, float(weight_text))
        flash("Weight logged.", "success")
        return redirect(url_for("weight"))

    @app.get("/profile")
    def profile() -> str:
        return render_template(
            "profile.html",
            active_page="profile",
            profile=repo.get_profile(settings.single_user_id),
            today=today_iso(),
        )

    @app.post("/profile")
    def save_profile() -> Any:
        payload = {
            "name": request.form.get("name", "").strip(),
            "age": _optional_int(request.form.get("age")),
            "gender": request.form.get("gender", "").strip(),
            "height_cm": _optional_int(request.form.get("height_cm")),
            "weight_kg": _optional_float(request.form.get("weight_kg")),
            "goal_weight_kg": _optional_float(request.form.get("goal_weight_kg")),
            "activity_level": request.form.get("activity_level", "moderate"),
            "goal": request.form.get("goal", "fat_loss"),
        }
        repo.save_profile(settings.single_user_id, payload)
        if payload["weight_kg"]:
            repo.save_weight(settings.single_user_id, today_iso(), float(payload["weight_kg"]))
        flash("Profile saved.", "success")
        return redirect(url_for("profile"))

    @app.get("/uploads/<path:filename>")
    def uploaded_file(filename: str) -> Any:
        return send_from_directory(settings.upload_dir, filename)

    return app


def _save_uploads(files: list[FileStorage], settings: Settings) -> tuple[list[Path], list[str]]:
    saved_paths: list[Path] = []
    urls: list[str] = []
    for file in files:
        if not file or not file.filename:
            continue
        extension = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if extension not in settings.allowed_upload_extensions:
            continue
        filename = f"{secrets.token_hex(8)}-{secure_filename(file.filename)}"
        path = settings.upload_dir / filename
        file.save(path)
        saved_paths.append(path)
        urls.append(url_for("uploaded_file", filename=filename))
    return saved_paths, urls


def _delete_uploaded_files(urls: list[str], settings: Settings) -> None:
    upload_dir = settings.upload_dir.resolve()
    for url in urls:
        parsed = urlparse(str(url))
        if not parsed.path.startswith("/uploads/"):
            continue
        filename = parsed.path.removeprefix("/uploads/")
        path = (upload_dir / filename).resolve()
        if upload_dir not in path.parents:
            continue
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def _trend_series(dates: list[str], entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date = {entry["date"]: entry for entry in entries}
    series: list[dict[str, Any]] = []
    for date_key in dates:
        entry = by_date.get(date_key)
        if not entry:
            series.append({"date": date_key, "has_data": False})
            continue
        analysis = entry.get("analysis") or {}
        series.append(
            {
                "date": date_key,
                "has_data": True,
                "food": int(analysis.get("food_calories") or 0),
                "burned": int(analysis.get("burned_calories") or 0),
                "activity": int(analysis.get("activity_calories") or 0),
                "deficit": int(analysis.get("calorie_deficit") or 0),
            }
        )
    return series


def _weight_series(dates: list[str], weights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date = {item.get("date"): item for item in weights}
    series: list[dict[str, Any]] = []
    for date_key in dates:
        item = by_date.get(date_key)
        if not item or not item.get("weight_kg"):
            series.append({"date": date_key, "has_data": False})
            continue
        series.append(
            {
                "date": date_key,
                "has_data": True,
                "weight": float(item.get("weight_kg") or 0),
            }
        )
    return series


def _calendar_days(month_dates: list[str], entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date = {entry["date"]: entry for entry in entries}
    first = parse_iso_date(month_dates[0])
    blanks = [{"blank": True} for _ in range(first.weekday())]
    days: list[dict[str, Any]] = []
    for date_key in month_dates:
        analysis = by_date.get(date_key, {}).get("analysis") or {}
        deficit = int(analysis.get("calorie_deficit") or 0)
        days.append(
            {
                "date": date_key,
                "day": int(date_key[-2:]),
                "deficit": deficit,
                "tone": "good" if deficit >= 0 else "bad",
            }
        )
    return blanks + days


def _shift_month(month: str, offset: int) -> str:
    year, month_number = (int(part) for part in month.split("-", 1))
    month_index = year * 12 + (month_number - 1) + offset
    shifted_year = month_index // 12
    shifted_month = month_index % 12 + 1
    return f"{shifted_year:04d}-{shifted_month:02d}"


def _date_range_label(start_date: str, end_date: str) -> str:
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    if start.year == end.year and start.month == end.month:
        return f"{start.strftime('%B')} {start.day}-{end.day}, {end.year}"
    if start.year == end.year:
        return f"{start.strftime('%b')} {start.day} - {end.strftime('%b')} {end.day}, {end.year}"
    return f"{start.strftime('%b')} {start.day}, {start.year} - {end.strftime('%b')} {end.day}, {end.year}"


def _totals(entries: list[dict[str, Any]]) -> dict[str, int]:
    totals = {"food": 0, "burned": 0, "activity": 0, "deficit": 0}
    for entry in entries:
        analysis = entry.get("analysis") or {}
        totals["food"] += int(analysis.get("food_calories") or 0)
        totals["burned"] += int(analysis.get("burned_calories") or 0)
        totals["activity"] += int(analysis.get("activity_calories") or 0)
        totals["deficit"] += int(analysis.get("calorie_deficit") or 0)
    return totals


def _averages(entries: list[dict[str, Any]]) -> dict[str, int]:
    totals = _totals(entries)
    divisor = max(len(entries), 1)
    return {key: round(value / divisor) for key, value in totals.items()}


def _balance_summary(averages: dict[str, int]) -> dict[str, Any]:
    food = max(int(averages.get("food") or 0), 0)
    burned = max(int(averages.get("burned") or 0), 0)
    activity = max(int(averages.get("activity") or 0), 0)
    basal = max(burned - activity, 0)
    deficit = int(averages.get("deficit") or burned - food)
    max_value = max(food, burned, 1)

    return {
        "food": food,
        "burned": burned,
        "activity": activity,
        "basal": basal,
        "deficit": deficit,
        "deficit_abs": abs(deficit),
        "balance_label": "Deficit" if deficit >= 0 else "Surplus",
        "food_pct": round(food / max_value * 100),
        "burned_pct": round(burned / max_value * 100),
        "basal_pct": round(basal / max_value * 100),
        "activity_pct": round(min(activity, burned) / max_value * 100),
    }


def _optional_int(value: str | None) -> int | None:
    if not value:
        return None
    return int(value)


def _optional_float(value: str | None) -> float | None:
    if not value:
        return None
    return float(value)


def _password_matches(settings: Settings, password: str) -> bool:
    if settings.app_password_hash:
        return check_password_hash(settings.app_password_hash, password)
    return not settings.app_password or password == settings.app_password


def main() -> None:
    create_app().run(host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
