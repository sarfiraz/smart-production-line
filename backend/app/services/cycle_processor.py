from typing import Any


def extract_cycle_speed(payload: dict[str, Any] | None) -> float | None:
    """
    Extract cycle speed from cycle/features payload.

    Expected shape:
    {
      "features": {...},
      "pwms": {"PWM_1": 80}
    }
    """
    if not isinstance(payload, dict):
        return None

    # Primary structure from worker payload
    pwms = payload.get("pwms")
    if isinstance(pwms, dict) and pwms.get("PWM_1") is not None:
        try:
            return float(pwms.get("PWM_1"))
        except (TypeError, ValueError):
            return None

    # Fallback for wrapped structures
    nested = payload.get("data")
    if isinstance(nested, dict):
        nested_pwms = nested.get("pwms")
        if isinstance(nested_pwms, dict) and nested_pwms.get("PWM_1") is not None:
            try:
                return float(nested_pwms.get("PWM_1"))
            except (TypeError, ValueError):
                return None

    return None

