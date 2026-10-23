"""Read-only demo with made-up data, shared at /demo.

It runs inside the same app (no extra process on the small server) but reads and writes a database of its own,
never the real one. The 90 days of data are rebuilt whenever the newest day is no longer today, so the demo
always looks current: someone going from 101 kg to 92 kg, with a few overeating days along the way.
"""

from __future__ import annotations

import random
from datetime import date, timedelta
from typing import Any

from flask import session

from mydiet.nutrition import analysis_from_items, compute_bmr_calories
from mydiet.storage import DietRepository, MemoryDietRepository

DEMO_USER = "demo"
DEMO_DAYS = 90
START_KG = 101.0
END_KG = 92.0

PROFILE = {
    "name": "Demo",
    "username": DEMO_USER,
    "age": 38,
    "gender": "male",
    "height_cm": 182,
    "activity_level": "moderate",
    "goal": "fat_loss",
    "goal_weight_kg": 88.0,
    "profile_complete": True,
}

# (name, meal, calories, protein, carbs, fat); Turkish names since the demo opens in Turkish.
MEALS = {
    "morning": [
        ("2 haşlanmış yumurta, beyaz peynir, domates", 320, 22, 8, 22),
        ("Yulaf, süt ve muz", 380, 15, 62, 8),
        ("Menemen ve 1 dilim tam buğday ekmek", 420, 20, 30, 24),
        ("Yoğurt, granola ve çilek", 350, 16, 48, 10),
    ],
    "lunch": [
        ("Tavuk salata", 480, 42, 18, 24),
        ("Mercimek çorbası ve bulgur pilavı", 560, 22, 88, 12),
        ("Izgara köfte ve salata", 620, 38, 20, 40),
        ("Ton balıklı sandviç", 520, 32, 50, 18),
        ("Etli kuru fasulye ve pilav", 690, 30, 92, 20),
    ],
    "dinner": [
        ("Fırında somon ve sebze", 560, 40, 22, 32),
        ("Tavuk sote ve bulgur", 610, 45, 58, 18),
        ("Zeytinyağlı taze fasulye ve yoğurt", 420, 14, 36, 24),
        ("Izgara tavuk but ve közlenmiş sebze", 590, 48, 20, 34),
    ],
    "snacks": [
        ("Elma", 90, 0, 23, 0),
        ("Bir avuç badem", 170, 6, 6, 15),
        ("Kefir", 120, 8, 12, 4),
        ("Türk kahvesi", 20, 0, 3, 1),
    ],
}

CHEAT_MEALS = [
    ("Lahmacun (3 adet) ve ayran", 980, 40, 120, 34, "dinner"),
    ("İskender ve künefe", 1650, 60, 150, 85, "dinner"),
    ("Pizza (yarım büyük) ve kola", 1350, 48, 160, 52, "dinner"),
    ("Hamburger menü", 1250, 38, 130, 60, "lunch"),
    ("Baklava (4 dilim)", 680, 8, 80, 38, "snacks"),
]

ACTIVITIES = [
    ("", 0),
    ("8000 adım", 180),
    ("30 dk tempolu yürüyüş", 220),
    ("45 dk ağırlık antrenmanı", 280),
    ("40 dk koşu", 420),
    ("1 saat bisiklet", 480),
]


def is_demo() -> bool:
    return bool(session.get("demo"))


class SessionRepository:
    """Sends each call to the demo database while the visitor is in the demo, otherwise to the real one."""

    def __init__(self, real: DietRepository | MemoryDietRepository, demo: DietRepository | MemoryDietRepository):
        self._real = real
        self._demo = demo

    def __getattr__(self, name: str) -> Any:
        return getattr(self._demo if is_demo() else self._real, name)


def ensure_demo_data(repo: DietRepository | MemoryDietRepository, today: date) -> None:
    """Rebuild the demo's 90 days unless they already end today."""
    if repo.get_entry(DEMO_USER, today.isoformat()):
        return
    start = today - timedelta(days=DEMO_DAYS - 1)
    rng = random.Random(start.toordinal())
    weight = START_KG
    for offset in range(DEMO_DAYS):
        day = start + timedelta(days=offset)
        target = START_KG + (END_KG - START_KG) * offset / (DEMO_DAYS - 1)
        weight = round(target + rng.uniform(-0.35, 0.35), 1) if 0 < offset < DEMO_DAYS - 1 else target
        profile = {**PROFILE, "weight_kg": weight}
        items, diary = _day_menu(rng, cheat=day.weekday() in (4, 5) and rng.random() < 0.55)
        activity_text, activity = rng.choice(ACTIVITIES)
        if activity_text:
            diary += f"\nAktivite: {activity_text}"
        analysis = analysis_from_items(
            profile,
            food_items=items,
            activity_calories=activity,
            summary="Örnek gün: demo verisi.",
        )
        analysis["bmr_calories"] = compute_bmr_calories(profile, use_stored=False)
        repo.save_entry(DEMO_USER, day.isoformat(), {"diary_text": diary, "image_urls": [], "analysis": analysis})
        if offset % 3 == 0 or offset == DEMO_DAYS - 1:
            repo.save_weight(DEMO_USER, day.isoformat(), weight)
    repo.save_profile(
        DEMO_USER,
        {**PROFILE, "weight_kg": END_KG, "bmr_calories": compute_bmr_calories({**PROFILE, "weight_kg": END_KG}, use_stored=False)},
    )


def _day_menu(rng: random.Random, *, cheat: bool) -> tuple[list[dict[str, Any]], str]:
    picks = [(meal, rng.choice(options)) for meal, options in MEALS.items() if meal != "snacks"]
    picks += [("snacks", choice) for choice in rng.sample(MEALS["snacks"], k=rng.randint(1, 2))]
    if cheat:
        name, calories, protein, carbs, fat, meal = rng.choice(CHEAT_MEALS)
        picks = [pick for pick in picks if pick[0] != meal] + [(meal, (name, calories, protein, carbs, fat))]
        picks.append(("snacks", ("Sütlaç ve kola", 520, 9, 90, 12)))
    items = [
        {"name": name, "meal": meal, "calories": calories, "protein_g": protein, "carbs_g": carbs, "fat_g": fat}
        for meal, (name, calories, protein, carbs, fat) in picks
    ]
    labels = {"morning": "Sabah", "lunch": "Öğle", "dinner": "Akşam", "snacks": "Ara öğün"}
    diary = "\n".join(f"{labels[item['meal']]}: {item['name']}" for item in items)
    return items, diary
