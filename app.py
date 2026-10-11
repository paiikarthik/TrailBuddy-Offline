"""
app.py - TrailBuddy Offline Web Application.

A privacy-first, open-source AI outdoor companion for Hacktoberfest 2026 'Touch Grass'.
Provides responsive PWA frontend, offline fallback engine, local nature journal,
and open-weight model integration via Ollama or hosted endpoints.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    send_from_directory,
)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from services.ai_provider import ai_service
from services.planner import generate_rule_based_plan, load_activities

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("trailbuddy")

BASE_DIR = Path(__file__).resolve().parent
START_TIME = time.time()

# Allowed choices for input validation
VALID_DURATIONS = {"15 minutes", "30 minutes", "1 hour", "2 hours", "half a day"}
VALID_ACTIVITIES = {
    "walking",
    "hiking",
    "birdwatching",
    "gardening",
    "photography",
    "cycling",
    "stargazing",
    "relaxation",
}
VALID_ENERGIES = {"low", "moderate", "high"}
VALID_BUDGETS = {"free", "low-cost", "flexible"}
VALID_ENVIRONMENTS = {
    "garden",
    "park",
    "forest",
    "beach",
    "countryside",
    "indoor nature",
}
VALID_ACCESSIBILITY_KEYS = {
    "wheelchair_accessible",
    "seated_option",
    "low_impact",
    "paved_trail",
    "sensory_friendly",
}

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static",
)

# Request size limits (prevent excessive payload abuse)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024  # 64 KB limit

# Rate limiter setup
rate_limit_expr = os.getenv("RATE_LIMIT_PER_MINUTE", "60 per minute")
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["120 per minute"],
    storage_uri="memory://",
)


@app.after_request
def apply_security_headers(response: Response) -> Response:
    """Applies modern security and privacy headers to every response."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    # CSP permitting local assets and inline styles/scripts needed for standalone PWA
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: blob:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; "
        "font-src 'self' data:; "
        "manifest-src 'self';"
    )
    return response


# ==============================================================================
# Web Routes
# ==============================================================================


@app.route("/")
def index() -> str:
    """Renders the main TrailBuddy Offline application dashboard."""
    ai_status = ai_service.get_public_status()
    return render_template("index.html", ai_status=ai_status)


@app.route("/offline.html")
def offline_fallback() -> str:
    """Dedicated offline fallback page cached by service worker."""
    return render_template("offline.html")


@app.route("/manifest.json")
def serve_manifest() -> Response:
    """Serves PWA manifest with standard JSON MIME type."""
    return send_from_directory(
        app.static_folder,
        "manifest.json",
        mimetype="application/manifest+json",
    )


@app.route("/service-worker.js")
def serve_service_worker() -> Response:
    """Serves the service worker with root scope permissions."""
    response = send_from_directory(
        app.static_folder,
        "service-worker.js",
        mimetype="application/javascript",
    )
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


# ==============================================================================
# API Routes
# ==============================================================================


@app.route("/health", methods=["GET"])
def health_check() -> Response:
    """Public health-check endpoint for Render and monitoring."""
    uptime = round(time.time() - START_TIME, 2)
    ai_status = ai_service.get_public_status()

    return jsonify(
        {
            "status": "healthy",
            "app": "TrailBuddy Offline",
            "version": "1.0.0",
            "uptime_seconds": uptime,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "ai_provider": ai_status["provider"],
            "ai_configured": ai_service.is_configured(),
            "ai_reachable": ai_status["is_reachable"],
            "pwa_ready": True,
        }
    )


@app.route("/api/status", methods=["GET"])
def api_status() -> Response:
    """Returns safe runtime and AI configuration details."""
    return jsonify(
        {
            "service": "TrailBuddy Offline API",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "ai_status": ai_service.get_public_status(),
            "offline_engine_ready": True,
        }
    )


@app.route("/api/activities", methods=["GET"])
def get_activities() -> Response:
    """Returns the bundled outdoor activities catalog."""
    activities = load_activities()
    return jsonify({"count": len(activities), "activities": activities})


@app.route("/api/challenges", methods=["GET"])
def get_challenges() -> Response:
    """Returns the bundled Touch Grass challenges dataset."""
    challenges_path = BASE_DIR / "data" / "challenges.json"
    if challenges_path.exists():
        try:
            with open(challenges_path, "r", encoding="utf-8") as f:
                challenges = json.load(f)
                return jsonify({"count": len(challenges), "challenges": challenges})
        except Exception as e:
            logger.error("Error reading challenges: %s", e)

    return jsonify({"count": 0, "challenges": []})


def validate_plan_input(data: Any) -> Tuple[bool, str, Dict[str, Any]]:
    """Validates user plan generation request parameters strictly."""
    if not isinstance(data, dict):
        return False, "Payload must be a JSON object.", {}

    time_available = str(data.get("time_available", "30 minutes")).strip().lower()
    activity_type = str(data.get("activity_type", "walking")).strip().lower()
    energy_level = str(data.get("energy_level", "moderate")).strip().lower()
    budget = str(data.get("budget", "free")).strip().lower()
    environment = str(data.get("environment", "park")).strip().lower()

    if time_available not in VALID_DURATIONS:
        return (
            False,
            f"Invalid time_available '{time_available}'. Allowed: {sorted(VALID_DURATIONS)}",
            {},
        )

    if activity_type not in VALID_ACTIVITIES:
        return (
            False,
            f"Invalid activity_type '{activity_type}'. Allowed: {sorted(VALID_ACTIVITIES)}",
            {},
        )

    if energy_level not in VALID_ENERGIES:
        return (
            False,
            f"Invalid energy_level '{energy_level}'. Allowed: {sorted(VALID_ENERGIES)}",
            {},
        )

    if budget not in VALID_BUDGETS:
        return (
            False,
            f"Invalid budget '{budget}'. Allowed: {sorted(VALID_BUDGETS)}",
            {},
        )

    if environment not in VALID_ENVIRONMENTS:
        return (
            False,
            f"Invalid environment '{environment}'. Allowed: {sorted(VALID_ENVIRONMENTS)}",
            {},
        )

    # Process accessibility flags
    raw_acc = data.get("accessibility", {})
    cleaned_acc: Dict[str, bool] = {}
    if isinstance(raw_acc, dict):
        for k, v in raw_acc.items():
            if k in VALID_ACCESSIBILITY_KEYS:
                cleaned_acc[k] = bool(v)
    elif isinstance(raw_acc, list):
        for item in raw_acc:
            if isinstance(item, str) and item in VALID_ACCESSIBILITY_KEYS:
                cleaned_acc[item] = True

    validated_input = {
        "time_available": time_available,
        "activity_type": activity_type,
        "energy_level": energy_level,
        "budget": budget,
        "environment": environment,
        "accessibility": cleaned_acc,
    }

    return True, "", validated_input


@app.route("/api/plan", methods=["POST"])
@limiter.limit(rate_limit_expr)
def generate_plan_endpoint() -> Response:
    """
    Generates a personalized outdoor plan.
    Uses open-source AI if configured and reachable; otherwise falls back gracefully
    to the rule-based planner. Never crashes on AI timeout or failure.
    """
    if not request.is_json:
        return (
            jsonify({"error": "Content-Type must be application/json"}),
            400,
        )

    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"error": "Malformed JSON payload"}), 400

    is_valid, err_msg, validated_input = validate_plan_input(payload)
    if not is_valid:
        return jsonify({"error": err_msg}), 400

    # Generate plan via service (handles AI + rule-based fallback automatically)
    plan = ai_service.generate_plan(validated_input)
    return jsonify({"success": True, "plan": plan}), 200


@app.route("/api/plan/rule-based", methods=["POST"])
@limiter.limit("60 per minute")
def generate_explicit_rule_based_plan() -> Response:
    """Directly invokes the rule-based planner, bypassing any AI call."""
    if not request.is_json:
        return (
            jsonify({"error": "Content-Type must be application/json"}),
            400,
        )

    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"error": "Malformed JSON payload"}), 400

    is_valid, err_msg, validated_input = validate_plan_input(payload)
    if not is_valid:
        return jsonify({"error": err_msg}), 400

    plan = generate_rule_based_plan(
        time_available=validated_input["time_available"],
        activity_type=validated_input["activity_type"],
        energy_level=validated_input["energy_level"],
        budget=validated_input["budget"],
        environment=validated_input["environment"],
        accessibility=validated_input["accessibility"],
    )
    plan["source"] = "rule_based"
    plan["fallback_reason"] = "Direct rule-based execution requested."
    return jsonify({"success": True, "plan": plan}), 200


# ==============================================================================
# Error Handlers
# ==============================================================================


@app.errorhandler(400)
def bad_request(error: Any) -> Response:
    if request.path.startswith("/api/"):
        return jsonify({"error": "Bad request", "details": str(error)}), 400
    return render_template("offline.html", error="Bad request"), 400


@app.errorhandler(404)
def not_found(error: Any) -> Response:
    if request.path.startswith("/api/"):
        return jsonify({"error": "Resource not found"}), 404
    return render_template("offline.html", error="Page not found"), 404


@app.errorhandler(429)
def ratelimit_handler(error: Any) -> Response:
    return (
        jsonify(
            {
                "error": "Rate limit exceeded. Please wait a moment before generating another plan.",
            }
        ),
        429,
    )


@app.errorhandler(500)
def server_error(error: Any) -> Response:
    logger.error("Unhandled internal server error: %s", error)
    if request.path.startswith("/api/"):
        return jsonify({"error": "Internal server error"}), 500
    return render_template("offline.html", error="An internal error occurred"), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    logger.info("Starting TrailBuddy Offline server on port %d...", port)
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
