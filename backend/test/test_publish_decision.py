#!/usr/bin/env python3
"""
Test script to publish a synthetic decision snapshot to the decision topic.
This can be used to test the ChatGPT stub service.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

# Add backend directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, TOPIC_DECISION
from app.mqtt.client import MqttBus


def create_test_decision_snapshot(decision_level: str = "NORMAL", cycle_id: int = 1) -> dict:
    """Create a minimal valid decision snapshot for testing."""
    snapshot = {
        "timestamp": datetime.now().isoformat(),
        "cycle_id": cycle_id,
        "decision_level": decision_level,
        "should_stop": decision_level == "EMERGENCY_STOP",
        "operator_action_required": decision_level in ["CRITICAL", "EMERGENCY_STOP"],
        "summary": f"Test decision snapshot with level: {decision_level}",
    }
    
    # Add IO health data
    if decision_level == "EMERGENCY_STOP":
        snapshot["io_health"] = {
            "faults": [
                {
                    "fault_id": "TEST_CRITICAL_FAULT",
                    "severity": "CRITICAL",
                    "subsystem": "test_subsystem",
                    "signal": "I_1",
                    "message": "Test critical fault for emergency stop",
                }
            ]
        }
    elif decision_level == "CRITICAL":
        snapshot["ml_result"] = {
            "status": "CRITICAL",
            "anomaly_score": 0.85,
            "affected_subsystems": ["belt", "punch"],
            "dominant_features": [
                {"name": "belt_symmetry", "z_score": 2.5, "subsystem": "belt"},
                {"name": "punch_symmetry", "z_score": 2.1, "subsystem": "punch"},
            ]
        }
    elif decision_level == "WARNING":
        snapshot["io_health"] = {
            "faults": [
                {
                    "fault_id": "TEST_WARNING",
                    "severity": "WARNING",
                    "subsystem": "test_subsystem",
                    "signal": "I_2",
                    "message": "Test warning fault",
                }
            ]
        }
    
    return snapshot


def main():
    """Publish a test decision snapshot and exit."""
    import time
    
    print(f"Connecting to MQTT broker: {MQTT_HOST}:{MQTT_PORT}")
    bus = MqttBus(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, client_id="test-publisher")
    
    try:
        bus.connect()
        time.sleep(1)  # Wait for connection
        
        # Create and publish test decision
        decision_level = sys.argv[1] if len(sys.argv) > 1 else "NORMAL"
        cycle_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        
        snapshot = create_test_decision_snapshot(decision_level=decision_level, cycle_id=cycle_id)
        
        print(f"Publishing decision snapshot to {TOPIC_DECISION}")
        print(f"Decision level: {decision_level}, Cycle ID: {cycle_id}")
        print(f"Snapshot: {json.dumps(snapshot, indent=2)}")
        
        bus.publish(TOPIC_DECISION, snapshot)
        print("✓ Published successfully")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        sys.exit(1)
    finally:
        bus.disconnect()
        print("Disconnected from MQTT broker")


if __name__ == "__main__":
    main()

