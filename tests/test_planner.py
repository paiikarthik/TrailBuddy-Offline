"""
tests/test_planner.py - Unit and integration tests for the rule-based outdoor planner.
"""

import pytest
from app import app
from services.planner import generate_rule_based_plan, load_activities


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_activities_dataset_loads():
    """Verifies that the activities dataset is populated and contains valid templates."""
    activities = load_activities()
    assert len(activities) >= 8
    for act in activities:
        assert "id" in act
        assert "title" in act
        assert "activity_type" in act
        assert "environment" in act
        assert "energy_level" in act
        assert "steps" in act
        assert "nature_observation_task" in act


def test_rule_based_plan_required_fields():
    """Verifies that the generated plan satisfies all 9 core requirements."""
    plan = generate_rule_based_plan(
        time_available="30 minutes",
        activity_type="walking",
        energy_level="low",
        budget="free",
        environment="park",
    )

    required_fields = [
        "title",
        "estimated_duration",
        "step_by_step_instructions",
        "required_equipment",
        "estimated_budget",
        "nature_observation_task",
        "screen_free_recommendation",
        "safety_checklist",
        "reflection_question",
        "disclaimer",
        "source",
    ]

    for field in required_fields:
        assert field in plan, f"Missing required field: {field}"

    assert plan["source"] == "rule_based"
    assert isinstance(plan["step_by_step_instructions"], list)
    assert len(plan["step_by_step_instructions"]) >= 3
    assert isinstance(plan["required_equipment"], list)
    assert isinstance(plan["safety_checklist"], list)
    assert "Independent verification" in plan["disclaimer"]


def test_duration_adaptation():
    """Tests that durations alter the pacing, instructions, or titles."""
    plan_15m = generate_rule_based_plan(time_available="15 minutes", activity_type="walking")
    assert "Micro" in plan_15m["title"] or "15" in plan_15m["estimated_duration"]

    plan_half_day = generate_rule_based_plan(time_available="half a day", activity_type="hiking")
    assert "Half" in plan_half_day["title"] or "Half" in plan_half_day["estimated_duration"]
    # Should include snack / extra water for half-day
    equip_str = " ".join(plan_half_day["required_equipment"]).lower()
    assert "water" in equip_str or "snack" in equip_str or "lunch" in equip_str


def test_accessibility_adaptation():
    """Tests that accessibility preferences adapt the plan steps and checklist."""
    plan_accessible = generate_rule_based_plan(
        activity_type="walking",
        environment="park",
        accessibility={"wheelchair_accessible": True, "paved_trail": True, "seated_option": True},
    )

    all_steps = " ".join(plan_accessible["step_by_step_instructions"]).lower()
    all_safety = " ".join(plan_accessible["safety_checklist"]).lower()

    assert "paved" in all_steps or "level" in all_steps or "barrier" in all_steps or "bench" in all_steps or "paved" in all_safety


def test_rule_based_endpoint(client):
    """Verifies that the /api/plan/rule-based endpoint returns 200 and a full plan."""
    payload = {
        "time_available": "1 hour",
        "activity_type": "gardening",
        "energy_level": "moderate",
        "budget": "low-cost",
        "environment": "garden",
        "accessibility": {"low_impact": True},
    }

    response = client.post("/api/plan/rule-based", json=payload)
    assert response.status_code == 200
    data = response.get_json()
    assert data["success"] is True
    plan = data["plan"]
    assert plan["source"] == "rule_based"
    assert "garden" in plan["matched_template_id"].lower() or "plant" in plan["title"].lower()
