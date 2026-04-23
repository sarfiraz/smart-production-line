#!/usr/bin/env python3
"""
Simple test to verify MQTT flow for interpretation messages.
Publishes a test interpretation message directly to verify the full pipeline.
"""
import json
import time
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, TOPIC_INTERPRETATION
from app.mqtt.client import MqttBus

def test_interpretation_publish():
    """Publish a test interpretation message directly."""
    bus = MqttBus(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, client_id="test-interpretation-publisher")
    
    test_interpretation = {
        "cycle_id": 999,
        "timestamp": datetime.now().isoformat(),
        "interpretation": {
            "authoritative_summary": "TEST: This is a direct interpretation test message.",
            "technical_explanation": "This message was published directly to test the MQTT/WebSocket pipeline.",
            "recommended_operator_actions": ["Verify this message appears in the UI"],
            "confidence_level": "HIGH"
        },
        "confidence": 0.9,
        "authoritative_summary": "TEST: This is a direct interpretation test message.",
        "technical_explanation": "This message was published directly to test the MQTT/WebSocket pipeline.",
        "recommended_actions": ["Verify this message appears in the UI"],
        "source": "test_script"
    }
    
    bus.connect()
    time.sleep(1)  # Wait for connection
    
    print(f"Publishing test interpretation to {TOPIC_INTERPRETATION}...")
    bus.publish(TOPIC_INTERPRETATION, test_interpretation)
    print(f"✓ Published test interpretation (cycle_id: 999)")
    
    time.sleep(1)
    bus.disconnect()
    print("Disconnected from MQTT broker")

if __name__ == "__main__":
    test_interpretation_publish()

