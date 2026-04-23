#!/usr/bin/env python3
"""
Test script to publish synthetic DECISION snapshots to test the ChatGPT Operator Assistant.

This script publishes decision scenarios to the decision topic for testing the AI assistant's
interpretation capabilities.

Usage:
    python backend/test/test_publish_decision_scenarios.py <scenario>

Scenarios:
    normal        - Normal operation scenario
    ml_critical   - ML-detected critical anomaly
    io_critical   - IO health emergency stop
    ambiguous     - Ambiguous warning scenario
"""

import json
import sys
import time
from datetime import datetime
from pathlib import Path

# Add backend directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, TOPIC_DECISION
from app.mqtt.client import MqttBus


def create_scenario_normal() -> dict:
    """Create a normal operation decision snapshot."""
    return {
        "timestamp": datetime.now().isoformat(),
        "cycle_id": 1,
        "decision_level": "NORMAL",
        "should_stop": False,
        "operator_action_required": False,
        "summary": "System operating normally.",
        "reasons": [],
        "io_health": None,
        "ml_result": None
    }


def create_scenario_ml_critical() -> dict:
    """Create an ML-critical decision snapshot."""
    return {
        "timestamp": datetime.now().isoformat(),
        "cycle_id": 2,
        "decision_level": "CRITICAL",
        "should_stop": False,
        "operator_action_required": True,
        "summary": "ML detected abnormal machine behavior.",
        "reasons": [
            {
                "source": "ML_BEHAVIOR",
                "severity": "CRITICAL",
                "affected_subsystems": ["BELT", "PUNCH"],
                "message": "Statistical anomaly detected."
            }
        ],
        "io_health": None,
        "ml_result": {
            "layer": "ML_BEHAVIOR",
            "cycle_id": 2,
            "status": "CRITICAL",
            "anomaly_score": 5.2,
            "thresholds": {
                "warning": 3.5,
                "critical": 4.5
            },
            "confidence": 1.0,
            "affected_subsystems": ["BELT", "PUNCH"],
            "dominant_features": [
                {"name": "belt_symmetry", "z_score": 4.8, "subsystem": "BELT"},
                {"name": "punch_symmetry", "z_score": 3.9, "subsystem": "PUNCH"}
            ],
            "timestamp": datetime.now().isoformat()
        }
    }


def create_scenario_io_critical() -> dict:
    """Create an IO-critical emergency stop decision snapshot."""
    return {
        "timestamp": datetime.now().isoformat(),
        "cycle_id": 3,
        "decision_level": "EMERGENCY_STOP",
        "should_stop": True,
        "operator_action_required": True,
        "summary": "Emergency stop due to hardware/control fault.",
        "reasons": [
            {
                "source": "IO_HEALTH",
                "severity": "CRITICAL",
                "fault_id": "MULTIPLE_PWM_ACTIVE",
                "signal": "PWM_1,PWM_3",
                "message": "Multiple actuators commanded simultaneously."
            }
        ],
        "io_health": {
            "timestamp": datetime.now().isoformat(),
            "cycle_id": 3,
            "faults": [
                {
                    "fault_id": "MULTIPLE_PWM_ACTIVE",
                    "layer": "IO_HEALTH",
                    "severity": "CRITICAL",
                    "subsystem": "CONTROL",
                    "signal": "PWM_1..PWM_3",
                    "message": "Multiple actuators commanded simultaneously.",
                    "cycle": 3,
                    "confidence": 1.0,
                    "active": True
                }
            ]
        },
        "ml_result": None
    }


def create_scenario_ambiguous() -> dict:
    """Create an ambiguous warning decision snapshot."""
    return {
        "timestamp": datetime.now().isoformat(),
        "cycle_id": 4,
        "decision_level": "WARNING",
        "should_stop": False,
        "operator_action_required": True,
        "summary": "Unclear behavior detected.",
        "reasons": [
            {
                "source": "ML_BEHAVIOR",
                "severity": "WARNING",
                "message": "Marginal deviation."
            }
        ],
        "io_health": None,
        "ml_result": {
            "layer": "ML_BEHAVIOR",
            "cycle_id": 4,
            "status": "WARNING",
            "anomaly_score": 3.8,
            "thresholds": {
                "warning": 3.5,
                "critical": 4.5
            },
            "confidence": 0.6,
            "affected_subsystems": ["SYSTEM"],
            "dominant_features": [
                {"name": "cycle_duration", "z_score": 2.1, "subsystem": "SYSTEM"}
            ],
            "timestamp": datetime.now().isoformat()
        }
    }


def get_scenario(scenario_name: str) -> dict:
    """Get decision snapshot for the specified scenario."""
    scenarios = {
        "normal": create_scenario_normal,
        "ml_critical": create_scenario_ml_critical,
        "io_critical": create_scenario_io_critical,
        "ambiguous": create_scenario_ambiguous,
    }
    
    if scenario_name not in scenarios:
        valid_scenarios = ", ".join(scenarios.keys())
        raise ValueError(f"Invalid scenario: '{scenario_name}'. Valid scenarios: {valid_scenarios}")
    
    return scenarios[scenario_name]()


def main():
    """Publish a test decision scenario and exit."""
    if len(sys.argv) < 2:
        print("Usage: python test_publish_decision_scenarios.py <scenario>")
        print("Scenarios: normal, ml_critical, io_critical, ambiguous")
        sys.exit(1)
    
    scenario_name = sys.argv[1].lower()
    
    # Validate and get scenario
    try:
        snapshot = get_scenario(scenario_name)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    
    print(f"Scenario: {scenario_name}")
    print(f"Connecting to MQTT broker: {MQTT_HOST}:{MQTT_PORT}")
    
    bus = MqttBus(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, client_id="test-decision-scenarios")
    
    try:
        bus.connect()
        time.sleep(1)  # Wait for connection
        
        print(f"Publishing decision snapshot to {TOPIC_DECISION}")
        print(f"Decision snapshot: {json.dumps(snapshot, indent=2)}")
        
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

