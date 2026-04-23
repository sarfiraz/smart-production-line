# MQTT Topic and Payload Contract

**Status:** FINAL — FROZEN  
**Date:** 2026-01-01  
**Version:** 1.0

This document defines the standardized MQTT topic names and payload structures for the industrial production line monitoring system. **These topics are frozen and must not be changed without explicit project-wide coordination.**

---

## Topic Naming Convention

All topics follow the pattern: `factory/line1/runtime/{message_type}`

- `factory` — Factory/plant identifier
- `line1` — Production line identifier
- `runtime` — Runtime/operational data namespace
- `{message_type}` — Specific message type (see below)

---

## Topic List (FINAL)

| Topic | Publisher | Subscriber(s) | Purpose |
|-------|-----------|---------------|---------|
| `factory/line1/runtime/cycle/features` | RevPi Runtime | ML Service, Backend | Raw cycle data (IO, PWM, features) |
| `factory/line1/runtime/io_health` | ML Service | Backend, Frontend | IO health monitoring results |
| `factory/line1/runtime/ml_behavior` | ML Service | Backend, Frontend | ML anomaly detection results |
| `factory/line1/runtime/decision` | ML Service | ChatGPT Service, Backend, Frontend | Decision engine output |
| `factory/line1/runtime/command` | ML Service (auto stop), Web App (operator commands) | RevPi Runtime | Control commands (frozen set) |
| `factory/line1/runtime/interpretation` | ChatGPT Service | Backend, Frontend | AI-generated interpretation of decisions |
| `factory/line1/runtime/status` | All Services | Backend, Frontend | Service status messages |

---

## Payload Structures

### 1. `factory/line1/runtime/cycle/features`

**Publisher:** RevPi Runtime  
**Payload:**

```json
{
  "timestamp": "2026-01-01T07:00:03.555799",
  "cycle_id": 1,
  "source": "revpi",
  "features": {
    "cycle_duration": 12.5,
    "belt_move_time": 8.2,
    "punch_down_time": 2.1,
    "punch_up_time": 2.2,
    "belt_symmetry": 0.02,
    "punch_symmetry": 0.01,
    "cycle_regularity": 0.95
  },
  "io": {
    "I_1": 0,
    "I_2": 1,
    "I_3": 1,
    "I_4": 0
  },
  "pwms": {
    "PWM_1": 80,
    "PWM_2": 0,
    "PWM_3": 80,
    "PWM_4": 0
  }
}
```

**Field Descriptions:**
- `timestamp`: ISO 8601 timestamp
- `cycle_id`: Integer cycle identifier
- `source`: Source identifier (e.g., "revpi", "test_publisher")
- `features`: Calculated cycle metrics (all floats)
- `io`: Digital inputs (0 or 1)
- `pwms`: PWM outputs (0-255)

---

### 2. `factory/line1/runtime/io_health`

**Publisher:** ML Service  
**Payload:**

```json
{
  "timestamp": "2026-01-01T07:00:03.559855",
  "cycle_id": 1,
  "faults": [
    {
      "fault_id": "I_1_STUCK_HIGH",
      "severity": "WARNING",
      "subsystem": "sensors",
      "signal": "I_1",
      "message": "I_1 stuck high for 5 cycles"
    }
  ]
}
```

**Field Descriptions:**
- `timestamp`: ISO 8601 timestamp
- `cycle_id`: Integer cycle identifier
- `faults`: Array of fault objects (empty array if no faults)
- `fault.severity`: "WARNING" or "CRITICAL"
- `fault.subsystem`: Subsystem identifier (e.g., "sensors", "belt", "punch")
- `fault.signal`: Signal name (e.g., "I_1", "PWM_1")
- `fault.message`: Human-readable fault description

---

### 3. `factory/line1/runtime/ml_behavior`

**Publisher:** ML Service  
**Payload:**

```json
{
  "layer": "ML_BEHAVIOR",
  "cycle_id": 1,
  "status": "NORMAL",
  "anomaly_score": 0.15,
  "thresholds": {
    "warning": 0.5,
    "critical": 0.75
  },
  "prediction": "normal",
  "confidence": 0.92,
  "affected_subsystems": [],
  "dominant_features": []
}
```

**Field Descriptions:**
- `layer`: Always "ML_BEHAVIOR"
- `cycle_id`: Integer cycle identifier
- `status`: "WARMUP", "NORMAL", "WARNING", or "CRITICAL"
- `anomaly_score`: Float between 0.0 and 1.0
- `thresholds`: Warning and critical thresholds
- `prediction`: "normal" or "anomalous"
- `confidence`: Float between 0.0 and 1.0
- `affected_subsystems`: Array of subsystem identifiers (empty if normal)
- `dominant_features`: Array of feature objects (empty if normal)

---

### 4. `factory/line1/runtime/decision`

**Publisher:** ML Service  
**Payload:**

```json
{
  "timestamp": "2026-01-01T07:00:03.565851",
  "cycle_id": 1,
  "decision_level": "NORMAL",
  "should_stop": false,
  "operator_action_required": false,
  "io_health": {
    "status": "ok",
    "faults": []
  },
  "ml_result": {
    "status": "NORMAL",
    "anomaly_score": 0.15,
    "prediction": "normal"
  }
}
```

**Field Descriptions:**
- `timestamp`: ISO 8601 timestamp
- `cycle_id`: Integer cycle identifier
- `decision_level`: "NORMAL", "WARNING", "CRITICAL", or "EMERGENCY_STOP"
- `should_stop`: Boolean (true only for EMERGENCY_STOP)
- `operator_action_required`: Boolean
- `io_health`: IO health snapshot (may be omitted if not available)
- `ml_result`: ML behavior snapshot (may be omitted if not available)

---

### 5. `factory/line1/runtime/command`

**Publishers:** ML Service (automatic emergency stop), Web App (operator commands)

This topic carries **all** control commands to the RevPi. Two publishers share this topic:

#### 5a. Automatic Emergency Stop (from Decision Engine)

**Publisher:** ML Service  
**Payload:**

```json
{
  "timestamp": "2026-01-01T07:00:03.570000",
  "cycle_id": 1,
  "command": "STOP",
  "source": "pc_decision_engine",
  "reason": "IO_HEALTH_CRITICAL",
  "decision_level": "EMERGENCY_STOP"
}
```

**Field Descriptions:**
- `timestamp`: ISO 8601 timestamp
- `cycle_id`: Integer cycle identifier
- `command`: Always "STOP"
- `source`: Always "pc_decision_engine"
- `reason`: Reason for stop command
- `decision_level`: Always "EMERGENCY_STOP"

#### 5b. Operator Commands (from Web App)

**Publisher:** Web App Backend  
**Frozen Command Set:**

| Command | Semantics |
|---------|-----------|
| `START_PRODUCTION` | Begin automatic production cycle |
| `STOP_PRODUCTION` | Controlled normal stop (no fault) |
| `EMERGENCY_STOP` | Immediate safety stop (latched fault) |
| `RESET_SYSTEM` | Clear latched faults, return to IDLE (does NOT start) |

**Payload (STRICT):**

```json
{
  "timestamp": "2026-01-01T07:00:03.570000",
  "command": "START_PRODUCTION",
  "source": "web_app",
  "user_role": "admin"
}
```

**Field Descriptions:**
- `timestamp`: ISO 8601 timestamp
- `command`: One of: `START_PRODUCTION`, `STOP_PRODUCTION`, `EMERGENCY_STOP`, `RESET_SYSTEM`
- `source`: Always "web_app"
- `user_role`: Role of the authenticated user ("operator" or "admin")

**No other fields are permitted.** No PWM values, no actuator names, no parameters.

**STOP_PRODUCTION vs EMERGENCY_STOP:**
- `STOP_PRODUCTION`: Graceful stop after current cycle. Does not latch a fault.
- `EMERGENCY_STOP`: Immediate halt. Latches a fault requiring `RESET_SYSTEM`.

---

### 6. `factory/line1/runtime/interpretation`

**Publisher:** ChatGPT Service  
**Payload:**

```json
{
  "cycle_id": 1,
  "timestamp": "2026-01-01T07:00:04.000000",
  "confidence": "high",
  "authoritative_summary": "Short, factual summary of the decision and machine state.",
  "technical_explanation": "Detailed technical explanation of the decision context.",
  "recommended_actions": [
    "Action 1: Description",
    "Action 2: Description"
  ]
}
```

**Field Descriptions:**
- `cycle_id`: Integer cycle identifier
- `timestamp`: ISO 8601 timestamp
- `confidence`: "high", "medium", or "low"
- `authoritative_summary`: Short summary (1-2 sentences)
- `technical_explanation`: Detailed technical explanation
- `recommended_actions`: Array of recommended action strings (may be empty)

---

### 7. `factory/line1/runtime/status`

**Publisher:** All Services  
**Payload:**

```json
{
  "timestamp": "2026-01-01T07:00:00.000000",
  "level": "INFO",
  "message": "ML service started (IO + ML + Decision + STOP command enabled)"
}
```

**Field Descriptions:**
- `timestamp`: ISO 8601 timestamp
- `level`: "INFO", "WARNING", or "ERROR"
- `message`: Human-readable status message

---

## Data Flow

```
RevPi Runtime
  └─> factory/line1/runtime/cycle/features
        └─> ML Service
              ├─> factory/line1/runtime/io_health
              ├─> factory/line1/runtime/ml_behavior
              └─> factory/line1/runtime/decision
                    └─> ChatGPT Service
                          └─> factory/line1/runtime/interpretation

ML Service (emergency only)
  └─> factory/line1/runtime/command
        └─> RevPi Runtime

Web App Backend (operator commands)
  └─> factory/line1/runtime/command
        └─> RevPi Runtime

All Services
  └─> factory/line1/runtime/status
```

---

## Backend WebSocket Forwarding

The backend MQTT client subscribes to `factory/line1/runtime/#` and forwards all messages to connected WebSocket clients with the following format:

```json
{
  "topic": "factory/line1/runtime/decision",
  "data": { /* original payload */ },
  "type": "sensor_data"
}
```

The frontend uses the `topic` field to route messages to the appropriate handlers.

---

## Compatibility Notes

- **Payload structures are frozen** — Do not add, remove, or rename fields without coordination
- **Topic names are frozen** — Use exact topic strings as defined above
- **No breaking changes** — All changes must maintain backward compatibility or be coordinated project-wide
- **QoS Level:** All topics use QoS 0 (at most once delivery)
- **Retain Flag:** All topics use retain=false (no retained messages)

---

## Implementation Files

**Backend Configuration:**
- `backend/app/config.py` — Topic constants

**Backend MQTT Client:**
- `backend/app/mqtt/client.py` — MQTT subscription and forwarding

**Services:**
- `backend/app/services/ml_service.py` — Subscribes to cycle/features, publishes io_health, ml_behavior, decision, command
- `backend/app/services/chatgpt_service.py` — Subscribes to decision, publishes interpretation
- `backend/app/services/chatgpt_stub_service.py` — Subscribes to decision, publishes interpretation (offline stub)

**Frontend:**
- `frontend/src/hooks/useWebSocket.js` — WebSocket message routing
- `frontend/src/store/systemStatusStore.js` — Topic activity tracking

**Edge Publisher Runtime (external to this repository):**
- Publishes cycle/features payloads to `factory/line1/runtime/cycle/features`

---

## Testing

Test scripts use the same topic constants from `backend/app/config.py`:
- `backend/test/test_publish_cycle_features.py` — Publishes test cycle features
- `backend/test/test_publish_decision.py` — Publishes test decisions

---

**END OF CONTRACT**



