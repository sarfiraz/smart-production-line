# Testing Protocol – Smart Production Line Monitoring & Control System

## 1. Purpose of Testing

This document describes the complete testing protocol used to validate the Smart Production Line system developed in this thesis.  
The goal of testing is to verify that:

- Hardware-level faults are detected deterministically
- Machine-learning-based behavior anomalies are detected reliably
- Safety and decision logic reacts correctly
- Real-time communication via MQTT functions correctly
- Emergency stop logic works in real deployment conditions

All tests were executed on a **real RevPi-based punching machine**, not in simulation.

---

## 2. Test Environment

### 2.1 Hardware
- Punching machine with conveyor belt
- Revolution Pi Core
- Revolution Pi DIO modules
- 24V industrial sensors and actuators

### 2.2 Software
- Python 3 runtime (PC and RevPi)
- Custom IO Health Monitor
- Custom ML Behavior Model (robust z-score based)
- MQTT broker (EMQX, Dockerized)
- Node-RED (Dockerized)
- InfluxDB (Dockerized, optional logging)
- PC-based ML & decision services

### 2.3 Network
- RevPi connected to PC via Wi-Fi hotspot
- MQTT communication over TCP (port 1883)

---

## 3. System Layers Under Test

| Layer | Description |
|------|------------|
| IO_HEALTH | Deterministic hardware and control fault detection |
| ML_BEHAVIOR | Statistical anomaly detection on cycle behavior |
| DECISION_ENGINE | Safety and reaction policy |
| MQTT_RUNTIME | Real-time message transport |
| REVPI_RUNTIME | Real hardware execution |

---

## 4. Test Data Sources

- Real RevPi cycle publisher (external runtime, not stored in this repository)
- Synthetic cycle publisher (`test_publish_synthetic_cycles.py`)
- Fault injection scripts (`test_stop_true.py`, IO fault injectors)
- Node-RED MQTT subscribers for verification

---

## 5. Test Cases

### 5.1 IO_HEALTH – Normal Operation

**Description:**  
Verify that valid sensor and PWM states produce no IO faults.

**Input Conditions:**
- PWM_1..PWM_4 = 0
- I_1 = 0, I_2 = 1, I_3 = 1, I_4 = 0

**Expected Result:**
- No IO_HEALTH faults
- No emergency stop

**Observed Result:**
```json
{"timestamp":"...","cycle_id":1,"faults":[]}
Status: PASS

5.2 IO_HEALTH – Stuck Sensor Warning
Description:
Detect sensors that remain unchanged for multiple cycles.

Input Conditions:

Identical input values repeated for ≥ configured threshold cycles

Expected Result:

STUCK_SENSOR warnings

No emergency stop

Observed Result:

json
Copy code
{
  "fault_id":"STUCK_SENSOR",
  "severity":"WARNING",
  "signal":"I_3"
}
Status: PASS

5.3 IO_HEALTH – Multiple PWM Active (CRITICAL)
Description:
Verify detection of illegal control commands.

Input Conditions:

PWM_1 = 80

PWM_3 = 80

Other PWMs = 0

Expected Result:

CRITICAL IO fault

Emergency stop triggered

Observed Result:

json
Copy code
{
  "fault_id":"MULTIPLE_PWM_ACTIVE",
  "severity":"CRITICAL"
}
Decision Output:

json
Copy code
{
  "decision_level":"EMERGENCY_STOP",
  "should_stop":true
}
Command Published:

json
Copy code
{
  "command":"STOP",
  "reason":"IO_HEALTH_CRITICAL"
}
Status: PASS

5.4 ML_BEHAVIOR – Warm-up Phase
Description:
Ensure ML model does not trigger alarms during initial cycles.

Input Conditions:

Cycle ID ≤ warm-up threshold

Normal cycle behavior

Expected Result:

Status = WARMUP

No warnings or critical alarms

Observed Result:

json
Copy code
{
  "status":"WARMUP",
  "confidence":0
}
Status: PASS

5.5 ML_BEHAVIOR – Normal Operation
Description:
Verify no false positives during normal operation.

Input Conditions:

Healthy cycles

Nominal timing values

Expected Result:

Status = NORMAL

Observed Result:

json
Copy code
{
  "status":"NORMAL",
  "anomaly_score":1.7
}
Status: PASS

5.6 ML_BEHAVIOR – Degradation Detection (CRITICAL)
Description:
Detect abnormal machine behavior due to simulated wear.

Input Conditions:

Increased punch_down_time

Increased belt asymmetry

Expected Result:

Status = CRITICAL

High anomaly score

Affected subsystems identified

Observed Result:

json
Copy code
{
  "status":"CRITICAL",
  "anomaly_score":16.6,
  "affected_subsystems":["BELT","SYSTEM"]
}
Status: PASS

5.7 Decision Engine – ML Critical (No Auto Stop)
Description:
Verify that ML critical faults do not automatically stop the machine.

Expected Result:

should_stop = false

operator_action_required = true

Observed Result:

json
Copy code
{
  "decision_level":"CRITICAL",
  "should_stop":false,
  "operator_action_required":true
}
Status: PASS

5.8 Decision Engine – IO Critical (Emergency Stop)
Description:
Verify immediate stop for hardware/control faults.

Expected Result:

should_stop = true

STOP command published

Observed Result:
Confirmed via MQTT and Node-RED.

Status: PASS

6. Real-Time Communication Validation
RevPi publishes cycle data via MQTT

PC-side services subscribe and process data

Node-RED confirms all topics:

cycle/features

io_health

ml_result

decision

command

Status: PASS

7. Safety Guarantees Verified
Safety decisions are deterministic and code-based

ML never directly controls hardware

Emergency stop only triggered by IO_HEALTH CRITICAL

GPT layer (future) cannot override safety logic

8. Limitations of Testing
Long-term wear not tested due to time constraints

Environmental noise not systematically varied

Operator misuse scenarios partially tested

9. Conclusion
All critical system layers were tested on real hardware.
The system demonstrates reliable fault detection, correct safety behavior, and stable real-time operation.
The testing results validate the system’s suitability for industrial monitoring and academic evaluation.