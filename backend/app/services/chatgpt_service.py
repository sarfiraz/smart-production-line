#!/usr/bin/env python3
"""
ChatGPT Interpreter Service.
- Subscribes to DECISION snapshots via MQTT
- Delegates reasoning to assistant_engine.generate_assistant_response
- Emits structured interpretation payload
- Does NOT control anything (interpretation-only)
"""

import sys
import time
from datetime import datetime
from pathlib import Path

from app.config import (
    MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE,
    TOPIC_DECISION, TOPIC_INTERPRETATION, TOPIC_STATUS
)
from app.mqtt.client import MqttBus
from app.services.assistant_engine import generate_assistant_response


def _confidence_to_numeric(confidence_level: str) -> float:
    level = (confidence_level or "MEDIUM").upper()
    if level == "HIGH":
        return 0.9
    if level == "LOW":
        return 0.5
    return 0.7


def _build_interpretation_payload(snapshot: dict, interpretation: dict) -> dict:
    cycle_id = snapshot.get("cycle_id")
    global_cycle_id = snapshot.get("global_cycle_id", cycle_id)
    confidence_level = interpretation.get("confidence_level", "MEDIUM")
    confidence = _confidence_to_numeric(confidence_level)
    return {
        "cycle_id": cycle_id,
        "global_cycle_id": global_cycle_id,
        "timestamp": snapshot.get("timestamp") or datetime.now().isoformat(),
        "interpretation": interpretation,
        "confidence": confidence,
        "authoritative_summary": interpretation.get("authoritative_summary"),
        "technical_explanation": interpretation.get("technical_explanation"),
        "recommended_actions": interpretation.get("recommended_operator_actions", []),
        "source": "assistant_engine",
    }


def main():
    bus = MqttBus(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, client_id="pc-chatgpt-service")

    def on_decision(topic, snapshot):
        try:
            interpretation = generate_assistant_response(
                "Explain the machine condition for this decision event.",
                snapshot
            )
            payload = _build_interpretation_payload(snapshot, interpretation)
            bus.publish(TOPIC_INTERPRETATION, payload)
        except Exception as e:
            bus.publish(TOPIC_STATUS, {
                "timestamp": datetime.now().isoformat(),
                "level": "ERROR",
                "message": f"chatgpt_service error: {e}"
            })

    bus.subscribe(TOPIC_DECISION, on_decision)
    bus.connect()
    bus.publish(TOPIC_STATUS, {
        "timestamp": datetime.now().isoformat(),
        "level": "INFO",
        "message": "ChatGPT interpreter service started (assistant_engine)."
    })

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        bus.publish(TOPIC_STATUS, {
            "timestamp": datetime.now().isoformat(),
            "level": "INFO",
            "message": "ChatGPT interpreter service stopped."
        })
        bus.disconnect()


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    main()
