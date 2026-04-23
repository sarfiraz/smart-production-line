# punching_machine_full_technical_docs.md

## 1. System Overview

This document is the **authoritative technical knowledge source** for the punching machine system used in this thesis project.

The system consists of:
- A conveyor belt transporting workpieces
- A vertical punch mechanism
- A Revolution Pi (RevPi) industrial controller
- Digital input/output (DIO) modules
- A PC-based runtime system for monitoring, ML-based diagnostics, and decision logic

This document is designed to be:
- Human-readable for thesis evaluation
- Machine-readable for AI reasoning and interpretation
- Conservative: no undocumented assumptions are made

---

## 2. Mechanical Description

### 2.1 Conveyor Belt
- Transports one workpiece per cycle
- Supports forward and reverse motion
- Forward direction moves workpiece toward punch station
- Reverse direction returns workpiece to start position

### 2.2 Punch Mechanism
- Vertical motion only
- Two limit positions:
  - Upper limit (default idle position)
  - Lower limit (during punch operation)
- Punch must never move while belt is in motion

### 2.3 Mechanical Constraints (Rules)
- Exactly **one workpiece per cycle**
- Belt and punch must **never move simultaneously**
- Punch movement is only allowed when the workpiece is correctly positioned

---

## 3. Electrical Power System

### 3.1 Power Domains
- 24V DC: Sensors, actuators, RevPi I/O
- Logic-level power: Internal to RevPi

### 3.2 Power Assumptions
- All sensors share a common 24V supply
- Loss of 24V results in all digital inputs reading the same value

⚠ If power wiring differs, verification is required.

---

## 4. Sensors

### 4.1 Digital Sensors Overview

| Sensor | Meaning | Default State | Active State |
|------|--------|---------------|--------------|
| I_1 | Workpiece at start position | 1 | 0 |
| I_2 | Workpiece at punch station | 1 | 0 |
| I_3 | Punch at upper limit | 0 | 1 |
| I_4 | Punch at lower limit | 0 | 1 |

### 4.2 Sensor Semantics

- I_1 and I_2 are **active-low**
- I_3 and I_4 are **active-high**
- I_3 and I_4 must **never be active simultaneously**

---

## 5. Actuators

### 5.1 PWM Outputs

| Output | Function |
|------|---------|
| PWM_1 | Belt forward |
| PWM_2 | Belt reverse |
| PWM_3 | Punch up |
| PWM_4 | Punch down |

### 5.2 PWM Rules
- Valid values: `0` or `>= 51`
- Values `1–50` are invalid
- Only **one PWM** may be active at any time

---

## 6. I/O Mapping (RevPi)

### 6.1 Logical Mapping

| Logical Signal | RevPi Channel | Module | Notes |
|---------------|--------------|--------|-------|
| I_1 | Digital Input | DIO | Exact terminal to be verified |
| I_2 | Digital Input | DIO | Active-low |
| I_3 | Digital Input | DIO | Active-high |
| I_4 | Digital Input | DIO | Active-high |
| PWM_1 | PWM Output | DIO | Belt forward |
| PWM_2 | PWM Output | DIO | Belt reverse |
| PWM_3 | PWM Output | DIO | Punch up |
| PWM_4 | PWM Output | DIO | Punch down |

⚠ Exact terminal numbers depend on physical wiring and must be verified on the RevPi hardware.

---

## 7. Cycle Definition and Timing Semantics

### 7.1 Cycle Definition
A **cycle** is defined as:
1. Workpiece detected at I_1 (cycle start)
2. Belt forward until I_2 becomes active
3. Punch down until I_4 becomes active
4. Punch up until I_3 becomes active
5. Belt reverse until I_1 becomes active again (cycle end)

### 7.2 Data Capture Timing
- Features are computed over the full cycle
- IO snapshot is taken at **end of cycle**
- ML inference is executed **after cycle completion**

---

## 8. Control Logic / State Machine

### 8.1 States
- IDLE
- BELT_FORWARD
- PUNCH_DOWN
- PUNCH_UP
- BELT_REVERSE

### 8.2 Idle State Definition
Idle is defined as:
- I_1 = 0
- I_2 = 1
- I_3 = 1
- I_4 = 0
- All PWMs = 0

---

## 9. Safety Rules and Interlocks

### 9.1 Deterministic IO Health Rules (Non-ML)

| Rule | Severity | Description |
|----|---------|-------------|
| MULTIPLE_PWM_ACTIVE | CRITICAL | More than one PWM >= 51 |
| INVALID_PWM_RANGE | CRITICAL | PWM between 1–50 |
| IMPOSSIBLE_PUNCH_STATE | CRITICAL | I_3 and I_4 both active |
| BELT_WHILE_PUNCH_DOWN | CRITICAL | Belt motion with punch down |
| SENSOR_POWER_LOSS | CRITICAL | All inputs identical |
| STUCK_SENSOR | WARNING | Input unchanged for N cycles |

### 9.2 Rule Consequences

| Severity | Action |
|--------|-------|
| CRITICAL | Immediate emergency stop |
| WARNING | Operator attention required |
| NORMAL | No action |

---

## 10. Fault Scenarios and Diagnostics

### 10.1 Example Faults
- Multiple PWM active → wiring or software error
- Punch not reaching limit → mechanical jam
- Stuck sensor → failed sensor or blocked actuator

### 10.2 Fault Persistence
- Faults remain **active** until condition clears
- Faults are reported every cycle while active

---

## 11. ML Behavior Model (Thesis Implementation)

### 11.1 Purpose
Detect **behavioral anomalies** not covered by deterministic rules.

### 11.2 Inputs
- cycle_duration
- belt_move_time
- punch_down_time
- punch_up_time
- belt_forward_duration
- belt_reverse_duration
- machine_load
- derived ratios

### 11.3 Outputs
- NORMAL
- WARNING
- CRITICAL
- Dominant contributing features

### 11.4 Warm-up Phase
- First N (5 for now) cycles are marked as `WARMUP`
- No decisions taken during warm-up

---

## 12. Decision & Safety Policy

### 12.1 Decision Hierarchy
1. IO_HEALTH CRITICAL → EMERGENCY_STOP
2. ML CRITICAL → Recommended controlled stop
3. WARNING → Operator attention

### 12.2 Automation Rules
- Only IO_HEALTH CRITICAL may automatically trigger STOP
- ML never directly stops the machine

---

## 13. Differences Between Reference Model and Thesis Implementation

| Aspect | Reference (PDF) | Thesis Implementation |
|------|-----------------|-----------------------|
| Controller | Generic PLC | RevPi Core |
| Logic | PLC ladder | Python + MQTT |
| Diagnostics | Manual | ML + IO health |
| AI | None | Planned ChatGPT layer |

---

## 14. Assumptions and Limitations

- One workpiece per cycle
- No overlapping cycles
- No redundancy sensors
- PWM speed changes affect timing but not logic
- AI explanations do not control safety

---

## 15. Intended Educational / Thesis Usage

This system demonstrates:
- Industrial monitoring
- Deterministic safety enforcement
- ML-based condition monitoring
- AI-assisted explanation (future layer)

The architecture explicitly separates:
- **Safety (code-based)**
- **Diagnostics (ML-based)**
- **Explanation (AI-based)**

This separation is intentional and fundamental.

---

END OF DOCUMENT

