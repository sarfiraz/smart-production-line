#!/usr/bin/env python3
"""
Test script to publish synthetic cycle features to test the ML service.
This simulates what the RevPi would publish.
"""

import json
import sys
import time
from datetime import datetime
from pathlib import Path

# Add backend directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, TOPIC_CYCLE_FEATURES
from app.mqtt.client import MqttBus


def create_test_cycle_features(cycle_id: int = 1, has_faults: bool = False) -> dict:
    """Create a minimal valid cycle features message for testing."""
    cycle = {
        "timestamp": datetime.now().isoformat(),
        "cycle_id": cycle_id,
        "source": "test_publisher",
        "features": {
            "cycle_duration": 5.2,
            "belt_move_time": 2.1,
            "punch_down_time": 0.8,
            "punch_up_time": 0.7,
            "belt_forward_duration": 1.0,
            "belt_reverse_duration": 1.1,
            "machine_load": 0.75,
        },
        "io": {
            "I_1": 0,  # Input 1
            "I_2": 1,  # Input 2
            "I_3": 0,  # Input 3
            "I_4": 1,  # Input 4
        },
        "pwms": {
            "PWM_1": 0,   # PWM 1
            "PWM_2": 0,   # PWM 2
            "PWM_3": 0,   # PWM 3
            "PWM_4": 0,   # PWM 4
        }
    }
    
    # Add faults if requested
    if has_faults:
        # Simulate a critical fault: multiple PWM active
        cycle["pwms"]["PWM_1"] = 100
        cycle["pwms"]["PWM_2"] = 100  # This should trigger a fault
    
    return cycle


def main():
    """Publish test cycle features."""
    print(f"Connecting to MQTT broker: {MQTT_HOST}:{MQTT_PORT}")
    bus = MqttBus(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, client_id="test-cycle-publisher")
    
    try:
        bus.connect()
        time.sleep(1)  # Wait for connection
        
        # Get cycle count from command line or default to 1
        cycle_count = int(sys.argv[1]) if len(sys.argv) > 1 else 1
        has_faults = "--faults" in sys.argv
        
        print(f"Publishing {cycle_count} cycle(s) to {TOPIC_CYCLE_FEATURES}")
        if has_faults:
            print("⚠️  Including fault conditions (multiple PWM active)")
        
        for i in range(cycle_count):
            cycle_id = i + 1
            cycle = create_test_cycle_features(cycle_id=cycle_id, has_faults=has_faults)
            
            print(f"\nCycle {cycle_id}:")
            print(f"  Features: {json.dumps(cycle['features'], indent=4)}")
            print(f"  IO: {cycle['io']}")
            print(f"  PWM: {cycle['pwms']}")
            
            bus.publish(TOPIC_CYCLE_FEATURES, cycle)
            print(f"  ✓ Published")
            
            if cycle_count > 1 and i < cycle_count - 1:
                time.sleep(0.5)  # Small delay between cycles
        
        print(f"\n✓ Published {cycle_count} cycle(s) successfully")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        bus.disconnect()
        print("Disconnected from MQTT broker")


if __name__ == "__main__":
    main()

