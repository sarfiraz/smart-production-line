# config.py 
# MQTT topics, host, thresholds, etc.

import os

# ---------------- MQTT ----------------
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_KEEPALIVE = int(os.getenv("MQTT_KEEPALIVE", 60))

# Topics - FINAL STANDARDIZED TOPICS (DO NOT CHANGE)
TOPIC_CYCLE_FEATURES = "factory/line1/runtime/cycle/features"
TOPIC_IO_SNAPSHOT    = "factory/line1/runtime/io_snapshot"
TOPIC_IO_HEALTH      = "factory/line1/runtime/io_health"
TOPIC_ML_RESULT      = "factory/line1/runtime/ml_behavior"
TOPIC_STATUS         = "factory/line1/runtime/status"
TOPIC_COMMAND        = "factory/line1/runtime/command"
TOPIC_INTERPRETATION = "factory/line1/runtime/interpretation"
TOPIC_DECISION       = "factory/line1/runtime/decision"
TOPIC_MACHINE_STATE  = "factory/line1/runtime/state"
TOPIC_MACHINE_SPEED  = "factory/line1/runtime/speed"
TOPIC_SUPERVISOR_HEARTBEAT = "factory/line1/runtime/supervisor/heartbeat"
TOPIC_SUPERVISOR_STATUS = "factory/line1/runtime/supervisor/status"


# ---------------- ML MODEL ----------------
MODEL_PATH = "ml_behavior_model.joblib"
