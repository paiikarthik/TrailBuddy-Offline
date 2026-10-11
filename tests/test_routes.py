"""
tests/test_routes.py - Integration tests for Flask routes and endpoints.
"""

import json
import pytest
from app import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_home_page(client):
    """Verifies that the home dashboard renders with 200 OK."""
    response = client.get("/")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "TrailBuddy" in html
    assert "Less scrolling. More exploring." in html
    assert "Touch Grass" in html


def test_health_endpoint(client):
    """Verifies health check returns healthy JSON structure."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "healthy"
    assert data["app"] == "TrailBuddy Offline"
    assert "uptime_seconds" in data
    assert "ai_provider" in data
    assert "pwa_ready" in data


def test_api_status(client):
    """Verifies API status returns configuration safely."""
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.get_json()
    assert "ai_status" in data
    assert data["offline_engine_ready"] is True


def test_api_activities(client):
    """Verifies the activities catalog endpoint."""
    response = client.get("/api/activities")
    assert response.status_code == 200
    data = response.get_json()
    assert data["count"] > 0
    assert isinstance(data["activities"], list)
    first_act = data["activities"][0]
    assert "title" in first_act
    assert "activity_type" in first_act


def test_api_challenges(client):
    """Verifies the outdoor challenges catalog endpoint."""
    response = client.get("/api/challenges")
    assert response.status_code == 200
    data = response.get_json()
    assert data["count"] > 0
    assert isinstance(data["challenges"], list)
    first_chal = data["challenges"][0]
    assert "title" in first_chal
    assert "category" in first_chal
    assert "instructions" in first_chal


def test_manifest_serving(client):
    """Verifies that the PWA manifest is served with correct MIME type."""
    response = client.get("/manifest.json")
    assert response.status_code == 200
    assert "application/manifest+json" in response.headers["Content-Type"]
    manifest = response.get_json()
    assert manifest["short_name"] == "TrailBuddy"
    assert manifest["display"] == "standalone"


def test_service_worker_serving(client):
    """Verifies that service-worker.js has root scope allowed header."""
    response = client.get("/service-worker.js")
    assert response.status_code == 200
    assert response.headers.get("Service-Worker-Allowed") == "/"
    content = response.get_data(as_text=True)
    assert "trailbuddy" in content.lower()


def test_offline_page(client):
    """Verifies dedicated offline fallback page is served."""
    response = client.get("/offline.html")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Offline Mode Active" in html


def test_security_headers(client):
    """Verifies essential security headers are applied."""
    response = client.get("/")
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "SAMEORIGIN"
    assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert "Content-Security-Policy" in response.headers
