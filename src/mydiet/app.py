from __future__ import annotations

import secrets
from datetime import timedelta
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
    food_item_groups,
    local_date,
    month_window,
    normalize_analysis,
    parse_iso_date,
    today_iso,
)
from mydiet.settings import Settings, get_settings


ASSET_VERSION = "20260623-9"

TEXTS = {
    "en": {
        "activity": "Activity",
        "activity_calories": "Activity calories",
        "activity_level": "Activity level",
        "activity_trend": "Activity trend",
        "active_calories_by_day": "Active calories by day",
        "add_today": "Add today",
        "age": "Age",
        "analysis": "Analysis",
        "analyze_day": "Analyze day",
        "analyzing": "Analyzing...",
        "analyzing_day": "Analyzing your day with Gemini. This can take a few seconds.",
        "basal": "Basal",
        "body_weight": "Body weight",
        "burned": "Burned",
        "calendar_month": "Calendar month",
        "calorie_deficit_calendar": "Calorie deficit calendar",
        "calorie_deficit_trend": "Calorie deficit trend",
        "calorie_trend_chart": "Calorie trend chart",
        "carbs": "Carbs",
        "confidence": "Confidence",
        "consumed": "Consumed",
        "current_weight": "Current weight",
        "daily_average": "Daily average",
        "daily_average_energy_balance": "Daily average energy balance",
        "daily_calorie_balance": "Daily calorie balance",
        "daily_deficit_or_surplus": "Daily deficit or surplus",
        "dashboard": "Dashboard",
        "language": "Language",
        "date": "Date",
        "days": "days",
        "deficit": "Deficit",
        "dinner": "Dinner",
        "diary_placeholder": "Example: breakfast eggs and toast, lunch chicken salad, 45 minute walk...",
        "eaten": "Eaten",
        "energy_balance": "Energy balance",
        "enter": "Enter",
        "entry": "Entry",
        "fat": "Fat",
        "fat_loss": "Fat loss",
        "female": "Female",
        "food": "Food",
        "food_and_activity_notes": "Food and activity notes",
        "food_breakdown": "Food breakdown",
        "gender": "Gender",
        "goal": "Goal",
        "goal_weight": "Goal weight",
        "height": "Height",
        "high": "High",
        "last_days": "Last {days} days",
        "log_out": "Log out",
        "log_weight": "Log weight",
        "logging": "Logging...",
        "logging_weight": "Logging your weight.",
        "low": "Low",
        "lunch": "Lunch",
        "male": "Male",
        "maintenance": "Maintenance",
        "moderate": "Moderate",
        "morning": "Morning",
        "muscle_gain": "Muscle gain",
        "name": "Name",
        "nav_label": "Primary navigation",
        "next_month": "Next month",
        "no_analysis": "No analysis for this date yet.",
        "no_weight_logs": "No weight logs yet.",
        "open_menu": "Open navigation menu",
        "other": "Other",
        "password": "Password",
        "personal_dashboard": "Personal dashboard",
        "personal_settings": "Personal settings",
        "previous_month": "Previous month",
        "profile": "Profile",
        "protein": "Protein",
        "recent_weights": "Recent weights",
        "recorded_days": "recorded days",
        "save_profile": "Save profile",
        "saving": "Saving...",
        "saving_profile": "Saving your profile and refreshing your weight trend.",
        "snacks": "Snacks",
        "surplus": "Surplus",
        "update_weight": "Update weight",
        "weight": "Weight",
        "weight_log": "Weight log",
        "weight_trend": "Weight trend",
        "what_happened_today": "What happened today?",
        "day_saved": "Day saved and analyzed.",
        "enter_weight": "Enter a weight before logging it.",
        "incorrect_password": "Incorrect password.",
        "username": "Username",
        "profile_saved": "Profile saved.",
        "weight_logged": "Weight logged.",
    },
    "tr": {
        "activity": "Aktivite",
        "activity_calories": "Aktivite kalorisi",
        "activity_level": "Aktivite seviyesi",
        "activity_trend": "Aktivite trendi",
        "active_calories_by_day": "Günlük aktivite kalorisi",
        "add_today": "Bugünü ekle",
        "age": "Yaş",
        "analysis": "Analiz",
        "analyze_day": "Günü analiz et",
        "analyzing": "Analiz ediliyor...",
        "analyzing_day": "Günün Gemini ile analiz ediliyor. Birkaç saniye sürebilir.",
        "basal": "Bazal",
        "body_weight": "Vücut ağırlığı",
        "burned": "Yakılan",
        "calendar_month": "Takvim ayı",
        "calorie_deficit_calendar": "Kalori açığı takvimi",
        "calorie_deficit_trend": "Kalori açığı trendi",
        "calorie_trend_chart": "Kalori trend grafiği",
        "carbs": "Karbonhidrat",
        "confidence": "Güven",
        "consumed": "Alınan",
        "current_weight": "Mevcut kilo",
        "daily_average": "Günlük ortalama",
        "daily_average_energy_balance": "Günlük ortalama enerji dengesi",
        "daily_calorie_balance": "Günlük kalori dengesi",
        "daily_deficit_or_surplus": "Günlük açık veya fazlalık",
        "dashboard": "Panel",
        "date": "Tarih",
        "days": "gün",
        "deficit": "Açık",
        "dinner": "Akşam",
        "diary_placeholder": "Örnek: kahvaltıda yumurta ve tost, öğlen tavuk salata, 45 dakika yürüyüş...",
        "eaten": "Yenilen",
        "energy_balance": "Enerji dengesi",
        "enter": "Giriş",
        "entry": "Kayıt",
        "fat": "Yağ",
        "fat_loss": "Yağ kaybı",
        "female": "Kadın",
        "food": "Yemek",
        "food_and_activity_notes": "Yemek ve aktivite notları",
        "food_breakdown": "Yemek dökümü",
        "gender": "Cinsiyet",
        "goal": "Hedef",
        "goal_weight": "Hedef kilo",
        "height": "Boy",
        "high": "Yüksek",
        "language": "Dil",
        "last_days": "Son {days} gün",
        "log_out": "Çıkış",
        "log_weight": "Kilo gir",
        "logging": "Kaydediliyor...",
        "logging_weight": "Kilon kaydediliyor.",
        "low": "Düşük",
        "lunch": "Öğlen",
        "male": "Erkek",
        "maintenance": "Korumak",
        "moderate": "Orta",
        "morning": "Sabah",
        "muscle_gain": "Kas kazanımı",
        "name": "İsim",
        "nav_label": "Ana navigasyon",
        "next_month": "Sonraki ay",
        "no_analysis": "Bu tarih için henüz analiz yok.",
        "no_weight_logs": "Henüz kilo kaydı yok.",
        "open_menu": "Navigasyon menüsünü aç",
        "other": "Diğer",
        "password": "Şifre",
        "personal_dashboard": "Kişisel dashboard",
        "personal_settings": "Kişisel ayarlar",
        "previous_month": "Önceki ay",
        "profile": "Profil",
        "protein": "Protein",
        "recent_weights": "Son kilolar",
        "recorded_days": "kayıtlı gün",
        "save_profile": "Profili kaydet",
        "saving": "Kaydediliyor...",
        "saving_profile": "Profilin kaydediliyor ve kilo trendin yenileniyor.",
        "snacks": "Atıştırmalıklar",
        "surplus": "Fazla",
        "update_weight": "Kilo güncelle",
        "weight": "Kilo",
        "weight_log": "Kilo kaydı",
        "weight_trend": "Kilo trendi",
        "what_happened_today": "Bugün ne oldu?",
        "day_saved": "Gün kaydedildi ve analiz edildi.",
        "enter_weight": "Kaydetmeden önce kilo gir.",
        "incorrect_password": "Kullanıcı adı veya şifre yanlış.",
        "username": "Kullanıcı adı",
        "profile_saved": "Profil kaydedildi.",
        "weight_logged": "Kilo kaydedildi.",
    },
}

CHART_TEXT_KEYS = {
    "activity",
    "basal",
    "burned",
    "consumed",
    "deficit",
    "surplus",
}

CHART_TEXT_EXTRA = {
    "en": {
        "activityEmpty": "No activity logs yet.",
        "dataEmpty": "No data for this range yet.",
        "deficitEmpty": "No deficit logs yet.",
        "weight": "Weight",
        "weightEmpty": "No weight logs yet.",
    },
    "tr": {
        "activityEmpty": "Henüz aktivite kaydı yok.",
        "dataEmpty": "Bu aralık için henüz veri yok.",
        "deficitEmpty": "Henüz kalori açığı kaydı yok.",
        "weight": "Kilo",
        "weightEmpty": "Henüz kilo kaydı yok.",
    },
}


def create_app(
    settings: Settings | None = None,
    repository: DietRepository | MemoryDietRepository | None = None,
) -> Flask:
    settings = settings or get_settings()
    _validate_runtime_settings(settings)
    app = Flask(__name__, static_folder="../../static", template_folder="../../templates")
    app.config["SECRET_KEY"] = settings.flask_secret_key
    app.config["MAX_CONTENT_LENGTH"] = settings.max_upload_bytes
    app.config["UPLOAD_DIR"] = settings.upload_dir
    settings.upload_dir.mkdir(parents=True, exist_ok=True)

    repo = repository or (MemoryDietRepository() if settings.use_memory_repository else DietRepository(settings))

    @app.context_processor
    def inject_globals() -> dict[str, Any]:
        lang = _current_lang()
        text = TEXTS[lang]
        chart_text = {key: text[key] for key in CHART_TEXT_KEYS}
        chart_text.update(CHART_TEXT_EXTRA[lang])
        return {
            "asset_version": ASSET_VERSION,
            "chart_text": chart_text,
            "lang": lang,
            "t": text,
            "username": settings.single_user_id,
        }

    @app.before_request
    def load_preferred_language() -> None:
        if session.get("lang") in TEXTS or request.endpoint in {"static", "uploaded_file"}:
            return
        profile = repo.get_profile(settings.single_user_id)
        preferred_language = str(profile.get("preferred_language") or "")
        if preferred_language in TEXTS:
            session["lang"] = preferred_language

    @app.before_request
    def require_login() -> Any:
        if not settings.app_password and not settings.app_password_hash:
            session["authenticated"] = True
        if request.endpoint in {"login", "login_post", "set_language", "static", "uploaded_file"}:
            return None
        if not session.get("authenticated"):
            return redirect(url_for("login", next=request.full_path))
        return None

    @app.post("/language")
    def set_language() -> Any:
        lang = request.form.get("lang", "en")
        selected_lang = lang if lang in TEXTS else "en"
        session["lang"] = selected_lang
        repo.save_profile(settings.single_user_id, {"preferred_language": selected_lang})
        next_url = request.form.get("next") or url_for("dashboard")
        if not next_url.startswith("/"):
            next_url = url_for("dashboard")
        return redirect(next_url)

    @app.get("/login")
    def login() -> str:
        return render_template("login.html")

    @app.post("/login")
    def login_post() -> Any:
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if username == settings.single_user_id and _password_matches(settings, password):
            session["authenticated"] = True
            return redirect(request.args.get("next") or url_for("dashboard"))
        flash(_t("incorrect_password"), "error")
        return redirect(url_for("login"))

    @app.post("/logout")
    def logout() -> Any:
        lang = session.get("lang")
        session.clear()
        if lang in TEXTS:
            session["lang"] = lang
        return redirect(url_for("login"))

    @app.get("/")
    def dashboard() -> str:
        range_key = request.args.get("range", "14d")
        days = RANGE_OPTIONS.get(range_key, 14)
        today = today_iso(settings.timezone)
        dates = date_window(days, timezone_name=settings.timezone)
        entries = repo.list_entries(settings.single_user_id, start_date=dates[0], end_date=dates[-1])
        weights = repo.list_weight_logs(
            settings.single_user_id,
            start_date=dates[0],
            end_date=dates[-1],
        )
        month = request.args.get("month") or today[:7]
        month_dates = month_window(month, timezone_name=settings.timezone)
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
            chart_range_label=_date_range_label(dates[0], dates[-1], lang=_current_lang()),
            weight_series=_weight_series(dates, weights),
            calendar_days=_calendar_days(month_dates, month_entries),
            current_month=month,
            previous_month=_shift_month(month, -1),
            next_month=_shift_month(month, 1),
            today=today,
        )

    @app.get("/entry")
    def entry_form() -> str:
        today = today_iso(settings.timezone)
        entry_date = request.args.get("date") or today
        entry = repo.get_entry(settings.single_user_id, entry_date)
        return render_template(
            "entry.html",
            active_page="entry",
            entry=entry,
            entry_date=entry_date,
            food_groups=food_item_groups(entry.get("analysis") or {}),
            today=today,
        )

    @app.post("/entry")
    def save_entry() -> Any:
        entry_date = request.form.get("date") or today_iso(settings.timezone)
        diary_text = request.form.get("diary_text", "").strip()
        profile = repo.get_profile(settings.single_user_id)
        old_entry = repo.get_entry(settings.single_user_id, entry_date)
        image_paths, image_urls = _save_uploads(request.files.getlist("images"), settings)
        language = _current_lang()

        if settings.gemini_api_key and (diary_text or image_paths):
            try:
                analysis = GeminiDietClient(settings).analyze_day(
                    diary_text=diary_text,
                    profile=profile,
                    entry_date=entry_date,
                    image_paths=image_paths,
                    language=language,
                )
                analysis = normalize_analysis(analysis)
            except Exception as exc:
                error_summary = f"Gemini analysis failed: {exc}"
                if language == "tr":
                    error_summary = f"Gemini analizi başarısız oldu: {exc}"
                analysis = fallback_analysis(
                    diary_text,
                    profile,
                    reason=error_summary,
                    language=language,
                )
                analysis["summary"] = error_summary
        else:
            reason = "Set GEMINI_API_KEY to calculate from diary text and images."
            if language == "tr":
                reason = "Günlük metni ve görsellerden hesaplamak için GEMINI_API_KEY ayarla."
            analysis = fallback_analysis(diary_text, profile, reason=reason, language=language)

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
        flash(_t("day_saved"), "success")
        return redirect(url_for("entry_form", date=entry_date))

    @app.get("/weight")
    def weight() -> str:
        end = local_date(settings.timezone)
        end_date = end.isoformat()
        start_date = (end - timedelta(days=90)).isoformat()
        weight_logs = repo.list_weight_logs(
            settings.single_user_id,
            start_date=start_date,
            end_date=end_date,
        )
        recent_weight_logs = list(reversed(weight_logs))
        profile = repo.get_profile(settings.single_user_id)
        current_weight = (
            recent_weight_logs[0].get("weight_kg")
            if recent_weight_logs
            else profile.get("weight_kg")
        )
        return render_template(
            "weight.html",
            active_page="weight",
            today=end_date,
            current_weight=current_weight,
            weight_logs=recent_weight_logs,
        )

    @app.post("/weight")
    def save_weight() -> Any:
        entry_date = request.form.get("date") or today_iso(settings.timezone)
        weight_text = request.form.get("weight_kg", "").strip()
        if not weight_text:
            flash(_t("enter_weight"), "error")
            return redirect(url_for("weight"))
        repo.save_weight(settings.single_user_id, entry_date, _required_float(weight_text))
        flash(_t("weight_logged"), "success")
        return redirect(url_for("weight"))

    @app.get("/profile")
    def profile() -> str:
        return render_template(
            "profile.html",
            active_page="profile",
            profile=repo.get_profile(settings.single_user_id),
            today=today_iso(settings.timezone),
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
            repo.save_weight(settings.single_user_id, today_iso(settings.timezone), float(payload["weight_kg"]))
        flash(_t("profile_saved"), "success")
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
        if not _has_valid_image_signature(file, extension):
            continue
        filename = f"{secrets.token_hex(8)}-{secure_filename(file.filename)}"
        path = settings.upload_dir / filename
        file.save(path)
        saved_paths.append(path)
        urls.append(url_for("uploaded_file", filename=filename))
    return saved_paths, urls


def _has_valid_image_signature(file: FileStorage, extension: str) -> bool:
    stream = file.stream
    position = stream.tell()
    header = stream.read(16)
    stream.seek(position)
    if extension in {"jpg", "jpeg"}:
        return header.startswith(b"\xff\xd8\xff")
    if extension == "png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if extension == "webp":
        return header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    return False


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


def _validate_runtime_settings(settings: Settings) -> None:
    if settings.app_env.lower() not in {"prod", "production"}:
        return
    if settings.flask_secret_key == "change-me-in-prod":
        raise RuntimeError("FLASK_SECRET_KEY must be set to a secure value in production.")
    if not settings.app_password and not settings.app_password_hash:
        raise RuntimeError("APP_PASSWORD_HASH or APP_PASSWORD must be set in production.")


def _current_lang() -> str:
    lang = str(session.get("lang") or "en")
    return lang if lang in TEXTS else "en"


def _t(key: str) -> str:
    lang = _current_lang()
    return TEXTS[lang].get(key, TEXTS["en"].get(key, key))


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
                "tone": _calendar_tone(deficit),
            }
        )
    return blanks + days


def _calendar_tone(deficit: int) -> str:
    if deficit > 0:
        return "good"
    if deficit < 0:
        return "bad"
    return "neutral"


def _shift_month(month: str, offset: int) -> str:
    year, month_number = (int(part) for part in month.split("-", 1))
    month_index = year * 12 + (month_number - 1) + offset
    shifted_year = month_index // 12
    shifted_month = month_index % 12 + 1
    return f"{shifted_year:04d}-{shifted_month:02d}"


def _date_range_label(start_date: str, end_date: str, *, lang: str = "en") -> str:
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    if lang == "tr":
        month_names = [
            "",
            "Ocak",
            "Şubat",
            "Mart",
            "Nisan",
            "Mayıs",
            "Haziran",
            "Temmuz",
            "Ağustos",
            "Eylül",
            "Ekim",
            "Kasım",
            "Aralık",
        ]
        short_months = [
            "",
            "Oca",
            "Şub",
            "Mar",
            "Nis",
            "May",
            "Haz",
            "Tem",
            "Ağu",
            "Eyl",
            "Eki",
            "Kas",
            "Ara",
        ]
        if start.year == end.year and start.month == end.month:
            return f"{start.day}-{end.day} {month_names[start.month]} {end.year}"
        if start.year == end.year:
            return f"{start.day} {short_months[start.month]} - {end.day} {short_months[end.month]} {end.year}"
        return f"{start.day} {short_months[start.month]} {start.year} - {end.day} {short_months[end.month]} {end.year}"
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
    return _required_float(value)


def _required_float(value: str) -> float:
    return float(value.strip().replace(",", "."))


def _password_matches(settings: Settings, password: str) -> bool:
    if settings.app_password_hash:
        return check_password_hash(settings.app_password_hash, password)
    return not settings.app_password or password == settings.app_password


def main() -> None:
    create_app().run(host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
