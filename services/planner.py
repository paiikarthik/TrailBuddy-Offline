"""
services/planner.py - Intelligent Rule-Based Outdoor Activity Planner.

Provides 100% offline-capable, deterministic, and context-aware plan generation.
Matches user preferences (time, activity, energy, environment, budget, accessibility)
against curated activity templates and adapts step-by-step instructions dynamically.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "activities.json"

_CACHED_ACTIVITIES: Optional[List[Dict[str, Any]]] = None


def load_activities() -> List[Dict[str, Any]]:
    """Loads bundled activities from JSON, with in-memory caching."""
    global _CACHED_ACTIVITIES
    if _CACHED_ACTIVITIES is not None:
        return _CACHED_ACTIVITIES

    if DATA_PATH.exists():
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                _CACHED_ACTIVITIES = json.load(f)
                return _CACHED_ACTIVITIES
        except Exception:
            pass

    # Fallback default activity if file missing
    return [
        {
            "id": "act-default",
            "title": "Mindful Nature Immersion",
            "activity_type": "walking",
            "environment": "park",
            "energy_level": "moderate",
            "budget": "free",
            "base_duration": "30 minutes",
            "suitable_durations": ["15 minutes", "30 minutes", "1 hour", "2 hours", "half a day"],
            "accessibility": {
                "wheelchair_accessible": True,
                "seated_option": True,
                "low_impact": True,
                "paved_trail": True,
                "sensory_friendly": True,
            },
            "steps": [
                "Step outside and take three deep breaths of fresh air.",
                "Stroll along a quiet, tree-lined path or green space.",
                "Notice natural textures, sounds, and ambient seasonal scents.",
                "Return refreshed with a cleared mental headspace.",
            ],
            "equipment": ["Comfortable shoes", "Water bottle", "Weather layer"],
            "nature_observation_task": "Count five natural colors you don't typically see on digital screens.",
            "screen_free_recommendation": "Leave your phone in airplane mode or keep it zipped securely inside a pocket.",
            "safety_checklist": [
                "Check local weather forecast before heading out.",
                "Stay on designated paths and respect wildlife habitats.",
                "Ensure someone knows your general location.",
            ],
            "reflection_question": "How did changing your physical perspective alter your mental stress level?",
        }
    ]


def _score_activity(
    activity: Dict[str, Any],
    time_available: str,
    activity_type: str,
    energy_level: str,
    budget: str,
    environment: str,
    accessibility: Dict[str, bool],
) -> int:
    """Scores how closely an activity matches the requested parameters."""
    score = 0

    # Activity type match
    if activity.get("activity_type") == activity_type:
        score += 40

    # Environment match
    if activity.get("environment") == environment:
        score += 30

    # Energy level match
    if activity.get("energy_level") == energy_level:
        score += 20

    # Time compatibility
    suitable_durations = activity.get("suitable_durations", [])
    if time_available in suitable_durations:
        score += 15
    elif activity.get("base_duration") == time_available:
        score += 20

    # Budget match
    if activity.get("budget") == budget or budget == "flexible":
        score += 10
    elif activity.get("budget") == "free" and budget == "low-cost":
        score += 10

    # Accessibility match
    act_access = activity.get("accessibility", {})
    for req_key, req_val in accessibility.items():
        if req_val:
            if act_access.get(req_key, False):
                score += 15
            else:
                score -= 10  # Penalize if specific accessibility requirement is not met

    return score


def _adapt_plan_for_duration(
    activity: Dict[str, Any],
    requested_duration: str,
    requested_energy: str,
    accessibility: Dict[str, bool],
) -> Dict[str, Any]:
    """Dynamically adapts instructions, equipment, and duration notes."""
    base_title = activity.get("title", "Outdoor Adventure")
    base_steps = list(activity.get("steps", []))
    base_equipment = list(activity.get("equipment", []))
    base_safety = list(activity.get("safety_checklist", []))

    # Duration-specific pacing and adjustments
    duration_lower = requested_duration.lower()
    if "15" in duration_lower:
        title = f"{base_title} (Micro Session)"
        time_note = "15 minutes (Quick Unplug)"
        # Compress steps for a quick micro-adventure
        adapted_steps = [
            f"Set aside exactly 15 minutes. Put all devices on silent.",
            base_steps[0] if base_steps else "Step outdoors into your nearest open green space.",
            f"Spend 8-10 focused minutes immersed in: {activity.get('nature_observation_task', 'observing nature')}.",
            "Conclude with three grounding breaths before returning to your day.",
        ]
    elif "half a day" in duration_lower:
        title = f"{base_title} (Half-Day Expedition)"
        time_note = "Half Day (~3-4 hours)"
        adapted_steps = [
            "Prepare your day pack with water, trail snacks, and weather layers.",
            base_steps[0] if base_steps else "Arrive at your destination during morning or early afternoon light.",
            "Pace yourself with steady breath and take 10-minute resting pauses every hour.",
            "Explore quiet side trails, observing seasonal wildlife and shifting light patterns.",
            "Conclude with a dedicated 20-minute rest session reflecting on the experience.",
        ]
        if "Trail snacks / nutritious packed meal" not in base_equipment:
            base_equipment.append("Nutritious trail lunch / hearty snacks")
        if "Extra water supply (1.5L+)" not in base_equipment:
            base_equipment.append("Extra water supply (1.5L+)")
    elif "2 hour" in duration_lower:
        title = f"{base_title} (Extended Immersion)"
        time_note = "2 hours"
        adapted_steps = base_steps + [
            "Spend the second hour exploring deeper, allowing yourself to pause and linger without looking at the time.",
            "Take a seated 10-minute break with a drink of water to absorb the ambient soundscape.",
        ]
        if "Electrolyte drink or water bottle" not in base_equipment:
            base_equipment.append("Water bottle (at least 1 liter)")
    elif "1 hour" in duration_lower:
        title = f"{base_title} (Full Hour Journey)"
        time_note = "1 hour"
        adapted_steps = base_steps
    else:  # 30 minutes default
        title = base_title
        time_note = "30 minutes"
        adapted_steps = base_steps

    # Accessibility adaptations
    if accessibility.get("wheelchair_accessible") or accessibility.get("paved_trail"):
        adapted_steps.insert(0, "Verify that the path entrance has level grade and barrier-free access.")
        base_safety.append("Confirm that paved pathways are clear of fallen wet branches or seasonal debris.")

    if accessibility.get("seated_option"):
        adapted_steps.append("Identify a bench, sturdy fallen log, or bring a lightweight folding sit-pad for seated rest.")

    if accessibility.get("sensory_friendly"):
        adapted_steps.append("Choose an early morning or weekday afternoon hour to ensure low ambient human noise.")

    # Format budget label
    budget_label = activity.get("budget", "free").capitalize()
    if budget_label.lower() == "free":
        budget_display = "Free ($0 — Uses existing items and open spaces)"
    elif budget_label.lower() == "low-cost":
        budget_display = "Low Cost (Under $10 for snacks, seeds, or park entrance)"
    else:
        budget_display = "Flexible Budget (Equipment or optional permits)"

    return {
        "title": title,
        "estimated_duration": time_note,
        "step_by_step_instructions": adapted_steps,
        "required_equipment": base_equipment,
        "estimated_budget": budget_display,
        "nature_observation_task": activity.get(
            "nature_observation_task",
            "Observe the motion of wind through foliage and notice subtle wildlife sounds.",
        ),
        "screen_free_recommendation": activity.get(
            "screen_free_recommendation",
            "Keep your smartphone inside your backpack or set to Do-Not-Disturb mode.",
        ),
        "safety_checklist": list(dict.fromkeys(base_safety)),  # remove duplicates
        "reflection_question": activity.get(
            "reflection_question",
            "What natural sensation (breeze, warmth, scent, sound) made the strongest impression?",
        ),
        "disclaimer": (
            "Independent verification required: Weather conditions, trail accessibility, and park "
            "opening hours vary. Always independently verify local safety rules and environmental "
            "conditions before departing."
        ),
        "source": "rule_based",
        "model": "Rule-Based Offline Engine",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "matched_template_id": activity.get("id", "custom"),
        "sample_location": activity.get("sample_location", "Local Natural Area (Demo)"),
    }


def generate_rule_based_plan(
    time_available: str = "30 minutes",
    activity_type: str = "walking",
    energy_level: str = "moderate",
    budget: str = "free",
    environment: str = "park",
    accessibility: Optional[Dict[str, bool]] = None,
) -> Dict[str, Any]:
    """
    Generates a personalized, structured outdoor plan using rule-based synthesis.
    Fully deterministic and 100% offline; guaranteed to succeed without external APIs.
    """
    if accessibility is None:
        accessibility = {}

    activities = load_activities()
    if not activities:
        raise ValueError("Activities catalog is empty.")

    # Find the best scoring activity
    scored = [
        (
            _score_activity(
                act,
                time_available,
                activity_type,
                energy_level,
                budget,
                environment,
                accessibility,
            ),
            act,
        )
        for act in activities
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    best_activity = scored[0][1]

    # Synthesize tailored plan
    return _adapt_plan_for_duration(
        best_activity,
        requested_duration=time_available,
        requested_energy=energy_level,
        accessibility=accessibility,
    )
