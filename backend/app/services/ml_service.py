# ML pipeline service: subscribes to cycle features, runs IO health and
# ML behavior checks, publishes decision output, and issues emergency stop
# commands on IO_HEALTH CRITICAL events.

import time
from datetime import datetime
from pathlib import Path

from app.config import (
    MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE,
    TOPIC_CYCLE_FEATURES,
    TOPIC_IO_SNAPSHOT,
    TOPIC_MACHINE_STATE,
    TOPIC_IO_HEALTH,
    TOPIC_ML_RESULT,
    TOPIC_STATUS,
    TOPIC_DECISION,
    TOPIC_COMMAND,
    MODEL_PATH,
)

from app.mqtt.client import MqttBus
from app.ml_runtime.io_health_monitor import IOHealthMonitor
from app.ml_runtime.behavior_model import MLBehaviorModel
from app.ml_runtime.decision_policy import DecisionEngine

try:
    from app.influx.influx_client import (
        write_cycle_features_to_influx,
        write_ml_result_to_influx,
        write_decision_to_influx,
    )
    INFLUX_AVAILABLE = True
except ImportError:
    INFLUX_AVAILABLE = False

import logging
_logger = logging.getLogger(__name__)

WARMUP_CYCLES = 5
last_fault_signature = None
global_cycle_counter = 0


def restore_global_cycle_counter():
    """
    Restore global_cycle_counter from InfluxDB so IDs persist across restarts.
    """
    global global_cycle_counter
    try:
        from app.influx.influx_client import client as influx_client, INFLUXDB_ORG, INFLUXDB_BUCKET

        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -3650d)
        |> filter(fn: (r) => r["_measurement"] == "decision")
        |> filter(fn: (r) => r["_field"] == "global_cycle_id")
        |> max()
        '''
        tables = influx_client.query_api().query(org=INFLUXDB_ORG, query=query)

        max_id = None
        for table in tables:
            for record in table.records:
                value = record.get_value()
                if value is None:
                    continue
                try:
                    current = int(value)
                except (TypeError, ValueError):
                    continue
                if max_id is None or current > max_id:
                    max_id = current

        if max_id is not None:
            global_cycle_counter = max_id
        else:
            global_cycle_counter = 0
    except Exception as e:
        print("Failed to restore global_cycle_counter:", e)
        global_cycle_counter = 0


def _flatten_revpi_cycle_message(cycle: dict) -> dict:
    features = cycle.get("features", {})
    io = cycle.get("io", {})
    pwms = cycle.get("pwms", {})

    flat = {
        "timestamp": cycle.get("timestamp"),
        "cycle_id": cycle.get("cycle_id"),
        "source": cycle.get("source", "unknown"),
    }

    flat.update(features)
    flat.update(io)
    flat.update(pwms)
    return flat


def main():
    restore_global_cycle_counter()
    # Resolve model path relative to ml_runtime directory
    model_path = Path(__file__).resolve().parents[1] / "ml_runtime" / "models" / "behavior_model.joblib"
    if not model_path.exists():
        # Fallback to config MODEL_PATH if relative path doesn't work
        model_path = Path(MODEL_PATH)
    
    io_monitor = IOHealthMonitor(response_timeout_cycles=20, stuck_cycles=5, all_same_cycles=10)
    ml_model = MLBehaviorModel(str(model_path))
    decision_engine = DecisionEngine()
    last_cycle_features_cycle_id = None
    last_snapshot_cycle_id_processed = None
    reset_pending = False

    bus = MqttBus(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE, client_id="pc-ml-service")

    def reset_runtime_state():
        nonlocal last_cycle_features_cycle_id, last_snapshot_cycle_id_processed
        global last_fault_signature
        last_fault_signature = None
        last_snapshot_cycle_id_processed = None
        last_cycle_features_cycle_id = None
        io_monitor.reset()

    def on_cycle_features(topic, cycle_msg):
        nonlocal last_cycle_features_cycle_id
        global global_cycle_counter
        try:
            cycle = _flatten_revpi_cycle_message(cycle_msg)

            if cycle.get("cycle_id") is None:
                raise ValueError("Missing cycle_id")
            cycle_id = int(cycle["cycle_id"])
            global_cycle_counter += 1
            global_cycle_id = int(global_cycle_counter)
            cycle["global_cycle_id"] = global_cycle_id
            last_cycle_features_cycle_id = cycle_id
            if isinstance(cycle_msg, dict):
                cycle_msg["global_cycle_id"] = global_cycle_id

            # Validate IO keys
            for k in ["I_1", "I_2", "I_3", "I_4", "PWM_1", "PWM_2", "PWM_3", "PWM_4"]:
                if k not in cycle:
                    raise ValueError(f"Missing key: {k}")

            inputs = {k: int(cycle[k]) for k in ["I_1", "I_2", "I_3", "I_4"]}
            pwms = {k: int(cycle[k]) for k in ["PWM_1", "PWM_2", "PWM_3", "PWM_4"]}
            io_monitor.reset_cycle_runtime_state()
            if INFLUX_AVAILABLE and isinstance(cycle_msg, dict):
                try:
                    write_cycle_features_to_influx(cycle_msg)
                except Exception as influx_err:
                    _logger.warning(f"InfluxDB cycle_features write failed: {influx_err}")

            # LAYER 1 — IO HEALTH
            faults = io_monitor.update(
                inputs,
                pwms,
                run_stuck_checks=True,
                run_command_response_checks=True,
            )
            io_payload = {
                "timestamp": datetime.now().isoformat(),
                "cycle_id": cycle_id,
                "global_cycle_id": global_cycle_id,
                "faults": faults,
            }
            bus.publish(TOPIC_IO_HEALTH, io_payload)

            # LAYER 2 — ML BEHAVIOR (only if no IO critical)
            ml_payload = None
            if not any(f.get("severity") == "CRITICAL" for f in faults):
                for k in [
                    "cycle_duration",
                    "belt_move_time",
                    "punch_down_time",
                    "punch_up_time",
                    "belt_forward_duration",
                    "belt_reverse_duration",
                    "machine_load",
                ]:
                    if k not in cycle:
                        raise ValueError(f"Missing ML key: {k}")

                x = ml_model.features_from_cycle(cycle)
                ml_payload = ml_model.predict(cycle_id, x)
                ml_payload["timestamp"] = datetime.now().isoformat()
                ml_payload["global_cycle_id"] = global_cycle_id

                if cycle_id <= WARMUP_CYCLES:
                    ml_payload["status"] = "WARMUP"
                    ml_payload["note"] = f"ML warm-up phase ({cycle_id}/{WARMUP_CYCLES})"
                    ml_payload["confidence"] = 0.0

                bus.publish(TOPIC_ML_RESULT, ml_payload)

                if INFLUX_AVAILABLE:
                    try:
                        write_ml_result_to_influx(
                            cycle_id=cycle_id,
                            anomaly_score=ml_payload.get("anomaly_score", 0.0),
                            status=ml_payload.get("status", "UNKNOWN"),
                            global_cycle_id=global_cycle_id,
                        )
                    except Exception as influx_err:
                        _logger.warning(f"InfluxDB ML write failed: {influx_err}")

            # LAYER 3 — DECISION ENGINE
            decision = decision_engine.decide(io_health_msg=io_payload, ml_result_msg=ml_payload)
            decision_dict = decision.to_dict()
            decision_dict["global_cycle_id"] = global_cycle_id
            bus.publish(TOPIC_DECISION, decision_dict)

            if INFLUX_AVAILABLE:
                try:
                    write_decision_to_influx(
                        cycle_id=cycle_id,
                        decision_level=decision_dict.get("decision_level", "UNKNOWN"),
                        should_stop=decision_dict.get("should_stop", False),
                        global_cycle_id=global_cycle_id,
                    )
                except Exception as influx_err:
                    _logger.warning(f"InfluxDB decision write failed: {influx_err}")

            # REACTION — EMERGENCY STOP COMMAND
            decision_level = str(decision_dict.get("decision_level", "")).upper()
            should_stop = bool(decision_dict.get("should_stop", False))
            if decision_level == "EMERGENCY_STOP" or should_stop:
                cmd = {
                    "timestamp": datetime.now().isoformat(),
                    "cycle_id": cycle_id,
                    "global_cycle_id": global_cycle_id,
                    "command": "EMERGENCY_STOP",
                    "source": "decision_engine",
                    "reason": "IO_HEALTH_CRITICAL",
                    "decision_level": decision_level,
                }
                bus.publish(TOPIC_COMMAND, cmd)
                print("Emergency stop command sent due to critical IO fault")

        except Exception as e:
            bus.publish(TOPIC_STATUS, {
                "timestamp": datetime.now().isoformat(),
                "level": "ERROR",
                "message": f"ml_service error processing cycle: {e}"
            })

    def on_command(topic, command_msg):
        nonlocal reset_pending
        try:
            if not isinstance(command_msg, dict):
                return
            command = str(command_msg.get("command", "")).upper().strip()
            if command == "RESET_SYSTEM":
                reset_pending = True
        except Exception as e:
            bus.publish(TOPIC_STATUS, {
                "timestamp": datetime.now().isoformat(),
                "level": "ERROR",
                "message": f"ml_service error processing command: {e}"
            })

    def on_machine_state(topic, state_msg):
        nonlocal reset_pending
        try:
            if not reset_pending or not isinstance(state_msg, dict):
                return
            state = str(state_msg.get("state", "")).upper().strip()
            if state != "IDLE":
                return

            reset_runtime_state()
            reset_pending = False

            io_payload = {
                "timestamp": datetime.now().isoformat(),
                "cycle_id": None,
                "global_cycle_id": None,
                "faults": [],
            }
            bus.publish(TOPIC_IO_HEALTH, io_payload)

            decision = decision_engine.decide(io_health_msg=io_payload, ml_result_msg=None)
            decision_dict = decision.to_dict()
            decision_dict["global_cycle_id"] = None
            bus.publish(TOPIC_DECISION, decision_dict)
        except Exception as e:
            bus.publish(TOPIC_STATUS, {
                "timestamp": datetime.now().isoformat(),
                "level": "ERROR",
                "message": f"ml_service error processing machine state: {e}"
            })

    def on_runtime_status(topic, status_msg):
        try:
            if not isinstance(status_msg, dict):
                return
            severity = str(status_msg.get("severity", status_msg.get("level", ""))).upper().strip()
            if severity != "CRITICAL":
                return

            decision_dict = {
                "timestamp": datetime.now().isoformat(),
                "cycle_id": status_msg.get("cycle_id"),
                "global_cycle_id": status_msg.get("global_cycle_id", status_msg.get("cycle_id")),
                "decision_level": "EMERGENCY_STOP",
                "should_stop": True,
                "operator_action_required": True,
                "summary": "Emergency stop: critical runtime/worker event detected.",
                "reasons": [{
                    "source": "RUNTIME_STATUS",
                    "severity": "CRITICAL",
                    "message": str(status_msg.get("message", "Critical runtime status event")),
                }],
                "io_health": None,
                "ml_result": None,
            }
            bus.publish(TOPIC_DECISION, decision_dict)
        except Exception as e:
            bus.publish(TOPIC_STATUS, {
                "timestamp": datetime.now().isoformat(),
                "level": "ERROR",
                "message": f"ml_service error processing runtime status: {e}"
            })

    def on_io_snapshot(topic, snapshot_msg):
        global last_fault_signature
        nonlocal last_snapshot_cycle_id_processed
        try:
            if not isinstance(snapshot_msg, dict):
                raise ValueError("Snapshot payload must be a JSON object")

            io_data = snapshot_msg.get("io")
            pwm_data = snapshot_msg.get("pwms")
            if not isinstance(io_data, dict) or not isinstance(pwm_data, dict):
                raise ValueError("Snapshot payload must contain 'io' and 'pwms' objects")

            snapshot_cycle_id_raw = snapshot_msg.get("cycle_id")
            snapshot_cycle_id = None
            if snapshot_cycle_id_raw is not None:
                snapshot_cycle_id = int(snapshot_cycle_id_raw)

            # Avoid duplicate io_health publishing for the same cycle id.
            if snapshot_cycle_id is not None:
                if snapshot_cycle_id == last_cycle_features_cycle_id:
                    return
                if snapshot_cycle_id == last_snapshot_cycle_id_processed:
                    return

            inputs = {k: int(io_data[k]) for k in ["I_1", "I_2", "I_3", "I_4"]}
            pwms = {k: int(pwm_data[k]) for k in ["PWM_1", "PWM_2", "PWM_3", "PWM_4"]}

            faults = io_monitor.update(
                inputs,
                pwms,
                run_stuck_checks=False,
                run_command_response_checks=False,
            )
            fault_signature = tuple(sorted(
                (f["fault_id"], f["severity"], f.get("component"))
                for f in faults
            ))
            if fault_signature == last_fault_signature:
                return
            last_fault_signature = fault_signature

            # Snapshot path is safety-only: never publish telemetry topics.
            if not any(str(f.get("severity", "")).upper() == "CRITICAL" for f in faults):
                return

            critical_faults = [
                f for f in faults if str(f.get("severity", "")).upper() == "CRITICAL"
            ]
            reasons = [
                {
                    "source": "IO_HEALTH_SNAPSHOT",
                    "fault_id": fault.get("fault_id"),
                    "signal": fault.get("signal"),
                    "subsystem": fault.get("subsystem"),
                    "severity": fault.get("severity"),
                }
                for fault in critical_faults
            ]

            decision_dict = {
                "timestamp": datetime.now().isoformat(),
                "cycle_id": snapshot_cycle_id,
                "global_cycle_id": snapshot_msg.get("global_cycle_id", snapshot_cycle_id),
                "decision_level": "EMERGENCY_STOP",
                "should_stop": True,
                "operator_action_required": True,
                "summary": "Emergency stop: critical IO fault detected from live snapshot.",
                "reasons": reasons,
                "io_health": None,
                "ml_result": None,
            }
            bus.publish(TOPIC_DECISION, decision_dict)

            cmd = {
                "timestamp": datetime.now().isoformat(),
                "cycle_id": snapshot_cycle_id,
                "global_cycle_id": snapshot_msg.get("global_cycle_id", snapshot_cycle_id),
                "command": "EMERGENCY_STOP",
                "source": "decision_engine",
                "reason": "IO_HEALTH_CRITICAL",
                "decision_level": "EMERGENCY_STOP",
            }
            bus.publish(TOPIC_COMMAND, cmd)

            last_snapshot_cycle_id_processed = snapshot_cycle_id
            print("IO snapshot processed for live fault detection")

        except Exception as e:
            bus.publish(TOPIC_STATUS, {
                "timestamp": datetime.now().isoformat(),
                "level": "ERROR",
                "message": f"ml_service error processing io_snapshot: {e}"
            })

    bus.subscribe(TOPIC_CYCLE_FEATURES, on_cycle_features)
    bus.subscribe(TOPIC_IO_SNAPSHOT, on_io_snapshot)
    bus.subscribe(TOPIC_COMMAND, on_command)
    bus.subscribe(TOPIC_MACHINE_STATE, on_machine_state)
    bus.subscribe(TOPIC_STATUS, on_runtime_status)
    bus.connect()

    bus.publish(TOPIC_STATUS, {
        "timestamp": datetime.now().isoformat(),
        "level": "INFO",
        "message": "ML service started (IO + ML + Decision + STOP command enabled)"
    })

    print("ML service running. Listening to:", TOPIC_CYCLE_FEATURES, "and", TOPIC_IO_SNAPSHOT)
    print("Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        bus.publish(TOPIC_STATUS, {
            "timestamp": datetime.now().isoformat(),
            "level": "INFO",
            "message": "ML service stopped"
        })
        bus.disconnect()


# Standalone entry point (runs service directly, bypassing FastAPI)
if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    main()
