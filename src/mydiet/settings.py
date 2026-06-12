from __future__ import annotations

import json
from functools import cached_property, lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv


load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="staging", alias="APP_ENV")
    app_password: str = Field(default="", alias="APP_PASSWORD")
    app_password_hash: str = Field(default="", alias="APP_PASSWORD_HASH")
    flask_secret_key: str = Field(default="change-me-in-prod", alias="FLASK_SECRET_KEY")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    single_user_id: str = Field(default="halil", alias="SINGLE_USER_ID")
    use_memory_repository: bool = Field(default=False, alias="USE_MEMORY_REPOSITORY")

    @cached_property
    def app_config(self) -> dict[str, Any]:
        path = Path("config/app_settings.json")
        if not path.exists():
            return {}
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        base = {
            key: value
            for key, value in payload.items()
            if key not in {"default", "environments"}
        }
        if isinstance(payload.get("default"), dict):
            base.update(payload["default"])
        environments = payload.get("environments")
        if isinstance(environments, dict) and isinstance(environments.get(self.app_env), dict):
            base.update(environments[self.app_env])
        return base

    @property
    def gemini_model(self) -> str:
        return str(self.app_config.get("gemini_model") or "gemini-2.5-flash")

    @property
    def analysis_prompt_path(self) -> Path:
        return Path(str(self.app_config.get("analysis_prompt_path") or "config/analysis_prompt.en.txt"))

    @property
    def upload_dir(self) -> Path:
        return Path(str(self.app_config.get("upload_dir") or "uploads"))

    @property
    def allowed_upload_extensions(self) -> set[str]:
        values = self.app_config.get("allowed_upload_extensions") or ["jpg", "jpeg", "png", "webp"]
        return {str(value).lower().lstrip(".") for value in values}

    @property
    def max_upload_bytes(self) -> int:
        value = self.app_config.get("max_upload_mb") or 8
        return int(value) * 1024 * 1024

    @property
    def timezone(self) -> str:
        return str(self.app_config.get("timezone") or "Europe/Amsterdam")

    @property
    def firestore_project_for_env(self) -> str:
        return str(self.app_config.get("google_cloud_project") or "")

    @property
    def firestore_database_for_env(self) -> str:
        return str(self.app_config.get("firestore_database") or "")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
