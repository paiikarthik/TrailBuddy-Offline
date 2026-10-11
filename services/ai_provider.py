"""
services/ai_provider.py - Open-Source AI Provider Integration for TrailBuddy Offline.

Integrates local open-weight language models via Ollama or remote open-weight endpoints
(e.g., vLLM, HuggingFace TGI, or LocalAI) with robust timeouts, JSON extraction,
schema validation, and an automatic fallback to the rule-based planner.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv

from services.planner import generate_rule_based_plan

load_dotenv()
logger = logging.getLogger(__name__)

# Required fields in any valid outdoor plan
REQUIRED_PLAN_FIELDS = [
    "title",
    "estimated_duration",
    "step_by_step_instructions",
    "required_equipment",
    "estimated_budget",
    "nature_observation_task",
    "screen_free_recommendation",
    "safety_checklist",
    "reflection_question",
]

DISCLAIMER_TEXT = (
    "Independent verification required: Weather conditions, trail accessibility, "
    "and park opening hours vary. Always independently verify local safety rules and "
    "environmental conditions before departing."
)


class AIPlannerService:
    """Manages open-weight AI inference with fallback to rule-based generation."""

    def __init__(self) -> None:
        # Provider selection: 'ollama', 'hosted', or 'disabled'
        self.provider = os.getenv("AI_PROVIDER", "ollama").strip().lower()
        self.ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "mistral").strip()

        # Hosted open-source model endpoint (OpenAI-compatible chat completions)
        self.hosted_endpoint = os.getenv("HOSTED_AI_ENDPOINT", "").strip()
        self.hosted_model = os.getenv("HOSTED_AI_MODEL", "mistralai/Mistral-7B-Instruct-v0.3").strip()
        self.hosted_key = os.getenv("HOSTED_AI_KEY", "").strip()

        # Timeout settings (short timeout ensures snappy user experience even if AI is slow)
        try:
            self.timeout = float(os.getenv("AI_TIMEOUT_SECONDS", "8.0"))
        except ValueError:
            self.timeout = 8.0

    def is_configured(self) -> bool:
        """Returns True if an AI provider is configured (not disabled)."""
        if self.provider == "disabled":
            return False
        if self.provider == "hosted":
            return bool(self.hosted_endpoint)
        if self.provider == "ollama":
            return bool(self.ollama_base_url)
        return False

    def get_public_status(self) -> Dict[str, Any]:
        """Returns safe status dictionary for frontend / health check without secrets."""
        reachable = False
        status_note = ""

        if self.provider == "disabled":
            status_note = "AI inference is disabled; running in 100% offline rule-based mode."
        elif self.provider == "ollama":
            try:
                # Fast check to Ollama version endpoint
                resp = requests.get(f"{self.ollama_base_url}/api/version", timeout=1.5)
                if resp.status_code == 200:
                    reachable = True
                    status_note = f"Ollama is reachable locally ({self.ollama_model})."
                else:
                    status_note = f"Ollama returned HTTP {resp.status_code}."
            except Exception as e:
                status_note = f"Ollama not running at {self.ollama_base_url} (will use rule-based fallback)."
        elif self.provider == "hosted":
            status_note = f"Hosted open-weight model configured ({self.hosted_model})."
            reachable = True

        return {
            "provider": self.provider,
            "model_configured": (
                self.hosted_model if self.provider == "hosted" else self.ollama_model
            ),
            "is_reachable": reachable,
            "status_note": status_note,
            "timeout_seconds": self.timeout,
            "rule_based_fallback_available": True,
        }

    def _build_prompt(self, user_input: Dict[str, Any]) -> Tuple[str, str]:
        """Constructs system and user prompts enforcing strict schema and safety guardrails."""
        system_prompt = (
            "You are TrailBuddy, an expert outdoor naturalist guide promoting the 'Touch Grass' "
            "mindfulness movement. Your purpose is to inspire people to step away from screens and connect "
            "with nature. You create thoughtful, realistic, sensory-rich outdoor plans.\n\n"
            "SAFETY AND HONESTY RULES:\n"
            "1. Do NOT invent live weather forecasts, current trail closures, opening hours, or GPS coordinates.\n"
            "2. State that users must check local weather and trail conditions independently.\n"
            "3. You MUST respond with ONLY a valid, raw JSON object matching the requested schema.\n"
            "4. Do not include markdown formatting or commentary outside the JSON object."
        )

        accessibility_notes = []
        acc_dict = user_input.get("accessibility", {})
        if isinstance(acc_dict, dict):
            for k, v in acc_dict.items():
                if v:
                    accessibility_notes.append(k.replace("_", " "))
        elif isinstance(acc_dict, list):
            accessibility_notes = [str(item) for item in acc_dict]

        acc_str = ", ".join(accessibility_notes) if accessibility_notes else "Standard mobility"

        user_prompt = f"""Generate a personalized outdoor activity plan for the following user preferences:

- Available Time: {user_input.get('time_available', '30 minutes')}
- Activity Preference: {user_input.get('activity_type', 'walking')}
- Energy Level: {user_input.get('energy_level', 'moderate')}
- Budget: {user_input.get('budget', 'free')}
- Environment: {user_input.get('environment', 'park')}
- Accessibility / Mobility considerations: {acc_str}

The JSON response MUST include exactly these fields:
{{
  "title": "Inspiring and descriptive activity title",
  "estimated_duration": "{user_input.get('time_available', '30 minutes')}",
  "step_by_step_instructions": ["Step 1...", "Step 2...", "Step 3...", "Step 4..."],
  "required_equipment": ["Item 1", "Item 2"],
  "estimated_budget": "Estimated cost description (e.g., Free, $5 for parking)",
  "nature_observation_task": "A mindful task observing flora, fauna, sounds, or weather",
  "screen_free_recommendation": "A practical tip to avoid checking screens or phones",
  "safety_checklist": ["Safety item 1", "Safety item 2", "Safety item 3"],
  "reflection_question": "A meaningful question to ponder after the outdoor experience"
}}"""

        return system_prompt, user_prompt

    def _call_ollama(self, system_prompt: str, user_prompt: str) -> str:
        """Invokes a local Ollama instance with JSON format request."""
        endpoint = f"{self.ollama_base_url}/api/chat"
        payload = {
            "model": self.ollama_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.6, "top_p": 0.9},
        }

        resp = requests.post(endpoint, json=payload, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {}).get("content", "")

    def _call_hosted(self, system_prompt: str, user_prompt: str) -> str:
        """Invokes a hosted open-weight model via OpenAI-compatible endpoint."""
        headers = {"Content-Type": "application/json"}
        if self.hosted_key:
            headers["Authorization"] = f"Bearer {self.hosted_key}"

        payload = {
            "model": self.hosted_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.6,
            "response_format": {"type": "json_object"},
        }

        resp = requests.post(self.hosted_endpoint, headers=headers, json=payload, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "")

    def _extract_and_validate_json(self, raw_text: str) -> Dict[str, Any]:
        """Extracts JSON from model output, cleans markers, and validates required schema."""
        cleaned = raw_text.strip()

        # Handle ```json ... ``` code fence if present
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
        if json_match:
            cleaned = json_match.group(1)
        else:
            # Fallback to finding outermost { and }
            first_brace = cleaned.find("{")
            last_brace = cleaned.rfind("}")
            if first_brace != -1 and last_brace != -1:
                cleaned = cleaned[first_brace : last_brace + 1]

        data = json.loads(cleaned)

        # Validate required fields
        for field in REQUIRED_PLAN_FIELDS:
            if field not in data:
                raise ValueError(f"AI response missing required field: {field}")

        # Ensure lists are lists
        for list_field in ["step_by_step_instructions", "required_equipment", "safety_checklist"]:
            if isinstance(data[list_field], str):
                data[list_field] = [data[list_field]]
            elif not isinstance(data[list_field], list):
                data[list_field] = [str(data[list_field])]

        # Ensure strings are strings
        for str_field in [
            "title",
            "estimated_duration",
            "estimated_budget",
            "nature_observation_task",
            "screen_free_recommendation",
            "reflection_question",
        ]:
            data[str_field] = str(data.get(str_field, ""))

        return data

    def generate_plan(self, user_input: Dict[str, Any]) -> Dict[str, Any]:
        """
        Attempts AI generation using configured open-weight model.
        Smoothly falls back to rule-based engine if AI is unavailable, disabled, or fails.
        """
        # If disabled, directly use rule-based
        if self.provider == "disabled":
            plan = generate_rule_based_plan(
                time_available=user_input.get("time_available", "30 minutes"),
                activity_type=user_input.get("activity_type", "walking"),
                energy_level=user_input.get("energy_level", "moderate"),
                budget=user_input.get("budget", "free"),
                environment=user_input.get("environment", "park"),
                accessibility=user_input.get("accessibility"),
            )
            plan["source"] = "rule_based"
            plan["fallback_reason"] = "AI provider is set to disabled (offline mode active)."
            return plan

        system_prompt, user_prompt = self._build_prompt(user_input)
        raw_output = ""
        fallback_reason = ""

        try:
            if self.provider == "ollama":
                raw_output = self._call_ollama(system_prompt, user_prompt)
                model_used = f"Ollama ({self.ollama_model})"
            elif self.provider == "hosted":
                raw_output = self._call_hosted(system_prompt, user_prompt)
                model_used = f"Hosted ({self.hosted_model})"
            else:
                raise ValueError(f"Unknown AI provider '{self.provider}'.")

            plan = self._extract_and_validate_json(raw_output)

            # Successfully generated via AI
            plan["source"] = "ai"
            plan["model"] = model_used
            plan["generated_at"] = datetime.now(timezone.utc).isoformat()
            plan["disclaimer"] = DISCLAIMER_TEXT
            return plan

        except requests.exceptions.Timeout:
            fallback_reason = f"AI service request timed out after {self.timeout}s."
            logger.warning("AI request timed out, falling back to rule-based planner.")
        except requests.exceptions.ConnectionError:
            fallback_reason = (
                f"Could not connect to {self.provider} service. "
                "Ensure local Ollama or hosted inference server is running."
            )
            logger.warning("AI connection refused, falling back to rule-based planner.")
        except (json.JSONDecodeError, ValueError) as err:
            fallback_reason = f"AI produced non-standard format: {err}."
            logger.warning("AI parsing error (%s), falling back to rule-based planner.", err)
        except Exception as err:
            fallback_reason = f"AI service error: {type(err).__name__}."
            logger.warning("AI unexpected error (%s), falling back to rule-based planner.", err)

        # Fallback to rule-based planner
        plan = generate_rule_based_plan(
            time_available=user_input.get("time_available", "30 minutes"),
            activity_type=user_input.get("activity_type", "walking"),
            energy_level=user_input.get("energy_level", "moderate"),
            budget=user_input.get("budget", "free"),
            environment=user_input.get("environment", "park"),
            accessibility=user_input.get("accessibility"),
        )
        plan["source"] = "rule_based"
        plan["fallback_reason"] = fallback_reason
        return plan


# Global singleton instance
ai_service = AIPlannerService()
