"""
Control Router – Production Control Commands via MQTT

Exposes exactly FOUR high-level production commands:
  START_PRODUCTION  – begin automatic production cycle
  STOP_PRODUCTION   – controlled normal stop (no fault)
  EMERGENCY_STOP    – immediate safety stop (latched fault)
  RESET_SYSTEM      – clear latched faults, return to IDLE (does NOT start)

All commands are published to: factory/line1/runtime/command
No low-level actuator control is exposed through the web API.

SAFETY NOTES:
- All control routes require authenticated users
- The RevPi validates all commands locally before execution
- IO_HEALTH monitoring remains active regardless of web commands
- Physical emergency stop on the machine is always available
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime
import logging
from sqlalchemy.orm import Session

from app.auth.security import get_current_user
from app.database.database import get_db
from app.database.models import User, StopEvent
from app.database.schemas import StopReasonRequest, StopReasonResponse
from app.mqtt.client import get_mqtt_client
from app.config import TOPIC_COMMAND
from app.services.system_event_logger import log_system_event

router = APIRouter(prefix="/api/control", tags=["control"])
logger = logging.getLogger(__name__)


# Response Model

class CommandResponse(BaseModel):
    """Standard response for all control commands."""
    status: str
    message: str
    command: str
    timestamp: str
    source: str = "web_app"

class SpeedRequest(BaseModel):
    speed: int


# Helper

def _publish_command(command: str) -> dict:
    """
    Publish a control command to MQTT.

    Payload contract (STRICT):
    {
        "timestamp": ISO8601,
        "command": STRING,
        "source": "web_app",
        "user_role": "operator" | "admin"
    }
    """
    mqtt_client = get_mqtt_client()
    machine_state_payload = getattr(mqtt_client, "last_machine_state", None) or {}
    cycle_id = machine_state_payload.get("cycle_id") if isinstance(machine_state_payload, dict) else None
    global_cycle_id = machine_state_payload.get("global_cycle_id") if isinstance(machine_state_payload, dict) else None
    if global_cycle_id is None:
        global_cycle_id = cycle_id

    payload = {
        "timestamp": datetime.utcnow().isoformat(),
        "command": command,
        "source": "web_app",
        "user_role": "user",
        "global_cycle_id": global_cycle_id,
    }

    mqtt_client.publish(TOPIC_COMMAND, payload)
    return payload


# Production Control Endpoints

@router.post("/start", response_model=CommandResponse)
def start_production(current_user: User = Depends(get_current_user)):
    """
    START_PRODUCTION – Begin automatic production cycle.

    The RevPi will validate preconditions (IDLE state, no active faults)
    before starting production.
    """
    try:
        payload = _publish_command("START_PRODUCTION")
        log_system_event(
            "START_PRODUCTION",
            "Operator started production",
            source="operator",
            severity="info",
        )
        return CommandResponse(
            status="success",
            message="Start production command sent",
            command="START_PRODUCTION",
            timestamp=payload["timestamp"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send command: {str(e)}")


@router.post("/stop", response_model=CommandResponse)
def stop_production(current_user: User = Depends(get_current_user)):
    """
    STOP_PRODUCTION – Controlled normal stop.

    Gracefully stops production after the current cycle completes.
    Does NOT clear faults. Does NOT trigger an emergency condition.
    """
    try:
        payload = _publish_command("STOP_PRODUCTION")
        log_system_event(
            "STOP_PRODUCTION",
            "Operator requested production stop",
            source="operator",
            severity="info",
        )
        return CommandResponse(
            status="success",
            message="Stop production command sent",
            command="STOP_PRODUCTION",
            timestamp=payload["timestamp"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send command: {str(e)}")


@router.post("/emergency-stop", response_model=CommandResponse)
def emergency_stop(current_user: User = Depends(get_current_user)):
    """
    EMERGENCY_STOP – Immediate safety stop.

    Immediately halts all actuators. Latches a fault condition that
    requires RESET_SYSTEM to clear before production can resume.
    This is the highest priority command.
    """
    try:
        payload = _publish_command("EMERGENCY_STOP")
        log_system_event(
            "EMERGENCY_STOP",
            "Operator triggered emergency stop",
            source="operator",
            severity="critical",
        )
        return CommandResponse(
            status="success",
            message="EMERGENCY STOP executed – all actuators halted",
            command="EMERGENCY_STOP",
            timestamp=payload["timestamp"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send emergency stop: {str(e)}")


@router.post("/reset", response_model=CommandResponse)
def reset_system(current_user: User = Depends(get_current_user)):
    """
    RESET_SYSTEM – Clear latched faults, return to IDLE.

    Clears fault conditions (including latched EMERGENCY_STOP).
    Returns machine state to IDLE. Does NOT start production.
    Must be used after EMERGENCY_STOP before production can resume.
    """
    try:
        payload = _publish_command("RESET_SYSTEM")
        log_system_event(
            "RESET_SYSTEM",
            "Operator reset system",
            source="operator",
            severity="info",
        )
        return CommandResponse(
            status="success",
            message="System reset command sent – faults cleared",
            command="RESET_SYSTEM",
            timestamp=payload["timestamp"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send command: {str(e)}")


@router.post("/stop-reason", response_model=StopReasonResponse)
def store_stop_reason(
    payload: StopReasonRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Store operator stop reason metadata in SQL database.
    """
    try:
        mqtt_client = get_mqtt_client()
        machine_state_payload = getattr(mqtt_client, "last_machine_state", None) or {}
        machine_state = machine_state_payload.get("state") if isinstance(machine_state_payload, dict) else None
        cycle_id_raw = machine_state_payload.get("cycle_id") if isinstance(machine_state_payload, dict) else None
        global_cycle_id_raw = machine_state_payload.get("global_cycle_id") if isinstance(machine_state_payload, dict) else None

        cycle_id = None
        if cycle_id_raw is not None:
            try:
                cycle_id = int(cycle_id_raw)
            except (TypeError, ValueError):
                cycle_id = None
        global_cycle_id = None
        if global_cycle_id_raw is not None:
            try:
                global_cycle_id = int(global_cycle_id_raw)
            except (TypeError, ValueError):
                global_cycle_id = None
        if global_cycle_id is None:
            global_cycle_id = cycle_id

        event = StopEvent(
            timestamp=payload.timestamp,
            command=payload.command,
            reason=payload.reason,
            notes=payload.notes,
            machine_state=machine_state,
            cycle_id=cycle_id,
            global_cycle_id=global_cycle_id,
        )
        db.add(event)
        db.commit()

        return StopReasonResponse(
            status="success",
            message="Stop reason stored",
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to store stop reason: {e}")
        raise HTTPException(status_code=500, detail="Failed to store stop reason")


@router.post("/set-speed")
def set_speed(payload: SpeedRequest, current_user: User = Depends(get_current_user)):
    """
    Publish machine speed command (51-100%).
    """
    speed = int(payload.speed)
    if speed < 51 or speed > 100:
        raise HTTPException(status_code=400, detail="Speed must be between 51 and 100")

    try:
        mqtt_client = get_mqtt_client()
        state_payload = getattr(mqtt_client, "last_machine_state", None) or {}
        current_state = str(state_payload.get("state", "")).upper() if isinstance(state_payload, dict) else ""
        if current_state not in ("IDLE", "STOPPED"):
            raise HTTPException(
                status_code=400,
                detail="Speed changes are only allowed when machine is idle or stopped.",
            )
        mqtt_client.publish_speed_command(speed)
        log_system_event(
            "SET_SPEED",
            f"Speed changed to {speed} PWM",
            source="operator",
            severity="info",
        )
        return {
            "status": "success",
            "message": f"Speed updated to {speed} %",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set speed: {str(e)}")
