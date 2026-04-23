# Control and Safety Policy – Smart Production Line (RevPi + DIO)

## 1. Purpose

This document defines the **deterministic safety and control policy** for the Smart Production Line system (punching machine + conveyor belt), implemented on a Revolution Pi (RevPi Core + DIO) with MQTT-based monitoring and remote control.

**Core principle:**  
Safety decisions are **code-based and deterministic**. Machine Learning (ML) and ChatGPT are **advisory only** and can never override safety logic.

---

## 2. Roles of System Layers

### 2.1 IO_HEALTH (Deterministic Hardware & Control Diagnostics)
- Detects unsafe or impossible IO states.
- Detects invalid PWM commands.
- Detects missing sensor responses to actuator commands.
- Detects stuck sensors / suspected power loss patterns.
- Output: structured faults list with severities `WARNING` or `CRITICAL`.

### 2.2 ML_BEHAVIOR (Statistical Behavior Monitoring)
- Detects behavioral anomalies in cycle timing relationships.
- Uses a speed-invariant feature set (ratios/shares) and robust z-score aggregation.
- Output: `status ∈ {WARMUP, NORMAL, WARNING, CRITICAL}`, `anomaly_score`, dominant features, affected subsystems.

**Important:** ML cannot directly stop the machine.

### 2.3 DECISION_ENGINE (Safety Policy)
- Combines IO_HEALTH + ML_BEHAVIOR results into a system-level decision.
- Outputs a deterministic decision contract:
  - `decision_level ∈ {NORMAL, WARNING, CRITICAL, EMERGENCY_STOP}`
  - `should_stop ∈ {true,false}`
  - `operator_action_required ∈ {true,false}`
- Publishes decision results over MQTT.

### 2.4 CHATGPT Interpretation (Advisory)
- Generates human-readable explanations from the *already-decided* snapshot.
- Must never:
  - issue commands
  - override stop decisions
  - claim unsafe restart is acceptable

---

## 3. Safety-Critical Hardware Rules

### 3.1 PWM Rules (Actuator Commands)
PWM outputs represent motor duty cycle.

- `PWM = 0` → motor OFF
- `PWM >= 51` → motor ON (valid operating region)
- `PWM ∈ [1..50]` → **invalid / not allowed** (treated as CRITICAL control fault)
- Negative PWM values are **not allowed**.

### 3.2 Allowed Actuation Concurrency
Only **one actuator PWM** may be active at a time (for this thesis implementation).

- If multiple `PWM_x >= 51` simultaneously:
  - Fault: `MULTIPLE_PWM_ACTIVE`
  - Severity: **CRITICAL**
  - System decision: **EMERGENCY_STOP**

---

## 4. Deterministic Safety Stop Policy

### 4.1 Emergency Stop Conditions (Only from IO_HEALTH CRITICAL)
The system may publish a STOP command automatically **only if**:

- At least one IO_HEALTH fault has `severity = CRITICAL`

Examples of IO_HEALTH CRITICAL triggers:
- `MULTIPLE_PWM_ACTIVE`
- `INVALID_PWM_VALUE`
- `IMPOSSIBLE_PUNCH_STATE` (e.g., punch UP and DOWN limits active simultaneously)
- `NO_SENSOR_RESPONSE` (actuator commanded but expected sensor did not respond within timeout)
- `SENSOR_POWER_LOSS` (pattern suggesting supply loss / wiring issue)

### 4.2 ML Critical Does NOT Auto-Stop
If ML reports `status = CRITICAL` but IO_HEALTH has no CRITICAL faults:
- Decision level: `CRITICAL`
- `should_stop = false`
- `operator_action_required = true`

Rationale:
- ML anomalies are probabilistic and may be caused by non-dangerous process variation.
- Stopping machinery must remain deterministic and sensor-grounded.

---

## 5. Decision Level Mapping

The following mapping is used by the Decision Engine:

### 5.1 EMERGENCY_STOP
- Condition: Any IO_HEALTH fault severity = CRITICAL
- Output:
  - `decision_level = EMERGENCY_STOP`
  - `should_stop = true`
  - `operator_action_required = true`

### 5.2 CRITICAL (No auto-stop)
- Condition: IO_HEALTH has no CRITICAL, but ML_BEHAVIOR status = CRITICAL
- Output:
  - `decision_level = CRITICAL`
  - `should_stop = false`
  - `operator_action_required = true`

### 5.3 WARNING
- Condition: IO_HEALTH warnings and/or ML_BEHAVIOR warning, no criticals
- Output:
  - `decision_level = WARNING`
  - `should_stop = false`
  - `operator_action_required = true` (or false if configured as informational-only)

### 5.4 NORMAL
- Condition: No faults and ML normal (or warmup)
- Output:
  - `decision_level = NORMAL`
  - `should_stop = false`
  - `operator_action_required = false`

### 5.5 WARMUP Handling
During early cycles after service start:
- ML status is forced to `WARMUP` for `N` cycles (configured, e.g., 5).
- Decision remains `NORMAL` unless IO_HEALTH faults exist.

---

## 6. Remote Control – Command Contract (FROZEN)

### 6.1 Allowed Commands

The web application exposes exactly **four** production-level commands. No low-level actuator control (belt, punch, PWM) is exposed.

| Command | Semantics | Requires |
|---------|-----------|----------|
| `START_PRODUCTION` | Begin automatic production cycle | Admin |
| `STOP_PRODUCTION` | Controlled normal stop (no fault) | Admin |
| `EMERGENCY_STOP` | Immediate safety stop (latched fault) | Admin |
| `RESET_SYSTEM` | Clear latched faults, return to IDLE (does NOT start) | Admin |

### 6.2 Command Semantics

**START_PRODUCTION:**
- Transitions system from IDLE → RUNNING.
- RevPi validates preconditions (no active faults, system in IDLE).
- If preconditions fail, the command is rejected locally by RevPi.

**STOP_PRODUCTION:**
- Graceful stop after current cycle completes.
- Transitions system from RUNNING → IDLE.
- Does NOT clear faults.
- Does NOT latch a fault condition.

**EMERGENCY_STOP:**
- Immediately halts all actuators (all PWM → 0).
- Latches a fault condition.
- Transitions system to FAULT state.
- Requires `RESET_SYSTEM` before production can resume.
- Bypasses all other logic — highest priority.

**RESET_SYSTEM:**
- Clears latched faults (including EMERGENCY_STOP latch).
- Returns system to IDLE state.
- Does NOT start production.
- Must be issued after EMERGENCY_STOP before START_PRODUCTION can work.

### 6.3 MQTT Command Topic

All commands are published to: `factory/line1/runtime/command`

Payload format (STRICT):
```json
{
  "timestamp": "ISO-8601",
  "command": "START_PRODUCTION | STOP_PRODUCTION | EMERGENCY_STOP | RESET_SYSTEM",
  "source": "web_app",
  "user_role": "operator | admin"
}
```

No PWM values. No actuator names. No parameters.

### 6.4 Command Safety Rules

- `EMERGENCY_STOP` bypasses all logic — immediate halt.
- `RESET_SYSTEM` is required after `EMERGENCY_STOP`.
- `STOP_PRODUCTION` must NOT clear faults.
- `START_PRODUCTION` must NOT work while faults are active.
- RevPi validates all commands locally before execution.
- IO_HEALTH monitoring remains active regardless of web commands.
- Physical emergency stop on the machine is always available.

### 6.5 STOP vs EMERGENCY_STOP

| Aspect | STOP_PRODUCTION | EMERGENCY_STOP |
|--------|----------------|----------------|
| Behavior | Graceful stop after cycle | Immediate halt |
| Fault latch | No | Yes |
| Requires RESET | No | Yes |
| PWM state | Stopped after cycle | All PWM → 0 immediately |
| Use case | Normal end of production | Safety hazard detected |

---

## 7. Automatic STOP (Decision Engine)

The Decision Engine may also publish a STOP command automatically when:
- `decision_level = EMERGENCY_STOP` AND `should_stop = true`

This is independent of the web app and uses:
```json
{
  "timestamp": "ISO-8601",
  "cycle_id": 999,
  "command": "STOP",
  "source": "pc_decision_engine",
  "reason": "IO_HEALTH_CRITICAL",
  "decision_level": "EMERGENCY_STOP"
}
```

---

## 8. Operator Guidance Principles

- CRITICAL / EMERGENCY_STOP: prioritize safety, inspection, controlled restart only after verification.
- ML anomalies: recommend inspection and trend monitoring; do not claim certainty.
- Always log decisions and reasons to allow audit and thesis evaluation.

---

## 9. Assumptions and Limitations

- This policy is designed for the thesis lab setup and may require modification for industrial certification.
- The system assumes valid sensor wiring and stable network connectivity for monitoring, but safety logic is local to the PC decision engine and RevPi physical behavior.
- ChatGPT interpretation is not a safety component and cannot be relied upon for control decisions.
- RevPi execution logic (how commands translate to PWM signals) is implemented on the RevPi side and is outside the scope of this web application.
