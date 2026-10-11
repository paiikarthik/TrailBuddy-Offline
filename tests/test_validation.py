"""
tests/test_validation.py - Input validation and AI error handling/fallback tests.
"""

from unittest.mock import patch
import pytest
import requests
from app import app
from services.ai_provider import AIPlannerService


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_invalid_time_available(client):
    """Verifies that unapproved durations are rejected with 400."""
    payload = {
        "time_available": "5 days",
        "activity_type": "walking",
        "energy_level": "moderate",
        "budget": "free",
        "environment": "park",
    }
    response = client.post("/api/plan", json=payload)
    assert response.status_code == 400
    data = response.get_json()
    assert "Invalid time_available" in data["error"]


def test_invalid_activity_type(client):
    """Verifies that unknown activities are rejected with 400."""
    payload = {
        "time_available": "30 minutes",
        "activity_type": "skydiving",
        "energy_level": "moderate",
        "budget": "free",
        "environment": "park",
    }
    response = client.post("/api/plan", json=payload)
    assert response.status_code == 400
    data = response.get_json()
    assert "Invalid activity_type" in data["error"]


def test_invalid_energy_level(client):
    """Verifies that unknown energy levels are rejected with 400."""
    payload = {
        "time_available": "30 minutes",
        "activity_type": "walking",
        "energy_level": "ultra_extreme",
        "budget": "free",
        "environment": "park",
    }
    response = client.post("/api/plan", json=payload)
    assert response.status_code == 400
    data = response.get_json()
    assert "Invalid energy_level" in data["error"]


def test_invalid_environment(client):
    """Verifies that unsupported environments are rejected with 400."""
    payload = {
        "time_available": "30 minutes",
        "activity_type": "walking",
        "energy_level": "moderate",
        "budget": "free",
        "environment": "subterranean_cave",
    }
    response = client.post("/api/plan", json=payload)
    assert response.status_code == 400
    data = response.get_json()
    assert "Invalid environment" in data["error"]


def test_non_json_request(client):
    """Verifies that non-JSON request body is rejected with 400."""
    response = client.post(
        "/api/plan",
        data="just plain text",
        content_type="text/plain",
    )
    assert response.status_code == 400
    data = response.get_json()
    assert "Content-Type must be application/json" in data["error"]


def test_ai_timeout_falls_back_gracefully():
    """Verifies that AI timeout does NOT crash the app and triggers rule-based fallback."""
    service = AIPlannerService()
    service.provider = "ollama"

    with patch("requests.post", side_effect=requests.exceptions.Timeout("Read timeout")):
        plan = service.generate_plan(
            {
                "time_available": "30 minutes",
                "activity_type": "walking",
                "energy_level": "low",
                "budget": "free",
                "environment": "park",
            }
        )

        assert plan["source"] == "rule_based"
        assert "timed out" in plan["fallback_reason"].lower()
        assert "step_by_step_instructions" in plan
        assert len(plan["step_by_step_instructions"]) >= 3


def test_ai_connection_refused_falls_back():
    """Verifies that connection refusal (e.g. Ollama not running) triggers rule-based fallback."""
    service = AIPlannerService()
    service.provider = "ollama"

    with patch("requests.post", side_effect=requests.exceptions.ConnectionError("Connection refused")):
        plan = service.generate_plan(
            {
                "time_available": "1 hour",
                "activity_type": "birdwatching",
                "energy_level": "low",
                "budget": "free",
                "environment": "forest",
            }
        )

        assert plan["source"] == "rule_based"
        assert "could not connect" in plan["fallback_reason"].lower()


def test_ai_malformed_json_falls_back():
    """Verifies that AI model hallucinating invalid JSON triggers fallback."""
    service = AIPlannerService()
    service.provider = "ollama"

    mock_resp = requests.Response()
    mock_resp.status_code = 200
    mock_resp._content = b'{"message": {"content": "Here is your plan: sorry, I forgot to produce JSON!"}}'

    with patch("requests.post", return_value=mock_resp):
        plan = service.generate_plan(
            {
                "time_available": "15 minutes",
                "activity_type": "relaxation",
                "energy_level": "low",
                "budget": "free",
                "environment": "garden",
            }
        )

        assert plan["source"] == "rule_based"
        assert "non-standard" in plan["fallback_reason"].lower()


def test_ai_valid_response_succeeds():
    """Verifies that a well-formatted AI response is parsed and marked with source: 'ai'."""
    service = AIPlannerService()
    service.provider = "ollama"

    valid_ai_json = {
        "title": "Zen Moss Observation Walk",
        "estimated_duration": "30 minutes",
        "step_by_step_instructions": ["Find an old oak tree.", "Look closely at moss patches.", "Notice moisture."],
        "required_equipment": ["None needed"],
        "estimated_budget": "Free",
        "nature_observation_task": "Observe microscopic water droplets on moss leaves.",
        "screen_free_recommendation": "Leave your phone at home.",
        "safety_checklist": ["Watch for slippery tree roots."],
        "reflection_question": "How old do you think the oldest organism in this grove is?",
    }

    import json

    mock_resp = requests.Response()
    mock_resp.status_code = 200
    mock_resp._content = json.dumps({"message": {"content": json.dumps(valid_ai_json)}}).encode("utf-8")

    with patch("requests.post", return_value=mock_resp):
        plan = service.generate_plan(
            {
                "time_available": "30 minutes",
                "activity_type": "walking",
                "energy_level": "low",
                "budget": "free",
                "environment": "park",
            }
        )

        assert plan["source"] == "ai"
        assert plan["title"] == "Zen Moss Observation Walk"
        assert "safety_checklist" in plan
