from typing import Dict, List, Optional


class Fault:
    def __init__(
        self,
        fault_id: str,
        layer: str,
        severity: str,
        subsystem: str,
        signal: str,
        message: str,
        cycle: int,
        confidence: float = 1.0,
        active: bool = True,
    ):
        self.fault_id = fault_id
        self.layer = layer
        self.severity = severity
        self.subsystem = subsystem
        self.signal = signal
        self.message = message
        self.cycle = cycle
        self.confidence = confidence
        self.active = active

    def key(self) -> str:
        # Unique key for latching (fault type + signal)
        return f"{self.fault_id}:{self.signal}"

    def to_dict(self):
        return {
            "fault_id": self.fault_id,
            "layer": self.layer,
            "severity": self.severity,
            "subsystem": self.subsystem,
            "signal": self.signal,
            "message": self.message,
            "cycle": self.cycle,
            "confidence": self.confidence,
            "active": self.active,
        }


class IOHealthMonitor:
    """
    Rule-based deterministic diagnostics for IO and control signals.

    Faults are latched on detection and remain active until explicit clear
    conditions are met. Thresholds are calibrated for the ~7-8s cycle time
    of the fischertechnik punching machine.
    """

   # PWM thresholds — motor activates only at PWM >= 51)
    PWM_MIN_WORKING = 51  
    PWM_MAX = 100

    INPUTS = ["I_1", "I_2", "I_3", "I_4"]
    PWMS = ["PWM_1", "PWM_2", "PWM_3", "PWM_4"]

    PWM_SENSOR_MAP = {
        "PWM_1": ("I_2", "BELT", "Belt forward did not reach punch station (I_2)"),
        "PWM_2": ("I_1", "BELT", "Belt reverse did not return to start (I_1)"),
        "PWM_3": ("I_3", "PUNCH", "Punch did not reach UP limit (I_3)"),
        "PWM_4": ("I_4", "PUNCH", "Punch did not reach DOWN limit (I_4)"),
    }

    def __init__(
        self,
        response_timeout_cycles: int = 20,
        stuck_cycles: int = 10,
        all_same_cycles: int = 10,
    ):
        self.RESPONSE_TIMEOUT = int(response_timeout_cycles)
        self.STUCK_CYCLES = int(stuck_cycles)
        self.ALL_SAME_CYCLES = int(all_same_cycles)

        self.cycle = 0

        # For stuck detection
        self.last_inputs = {k: None for k in self.INPUTS}
        self.same_count = {k: 0 for k in self.INPUTS}

        # For global power-loss heuristic
        self.all_same_count = 0

        # For command-response timeout
        self.pwm_active_since = {k: None for k in self.PWMS}

        # Latching store: key -> Fault
        self.latched: Dict[str, Fault] = {}

    # Public API
    def update(
        self,
        inputs: Dict,
        pwms: Dict,
        run_stuck_checks: bool = True,
        run_command_response_checks: bool = True,
    ) -> List[Dict]:
        """
        inputs: {"I_1":0/1, ...}
        pwms:   {"PWM_1":0..100, ...}

        Returns list of active faults (latched + current).
        """
        self.cycle += 1

        # Normalize keys (strict)
        inputs = {k: int(inputs.get(k, 0)) for k in self.INPUTS}
        pwms = {k: int(pwms.get(k, 0)) for k in self.PWMS}

        # Track which faults are "seen" this update, for clearing rules
        seen_keys = set()

        # 1) Instant checks (control validity)
        for f in self._check_pwm_validity(pwms):
            self._latch(f)
            seen_keys.add(f.key())

        mode, mode_faults = self._detect_mode(pwms)
        for f in mode_faults:
            self._latch(f)
            seen_keys.add(f.key())

        # 2) PWM-driven consistency checks (based on real IO meanings)
        for f in self._check_mode_consistency(inputs, pwms, run_command_response_checks):
            self._latch(f)
            seen_keys.add(f.key())

        # 3) Power-loss heuristic
        f = self._check_global_power(inputs)
        if f:
            self._latch(f)
            seen_keys.add(f.key())

        # 4) Stuck sensors (latched)
        if run_stuck_checks:
            for f in self._check_stuck_inputs(inputs):
                self._latch(f)
                seen_keys.add(f.key())

        # 5) Command-response timeout (latched)
        if run_command_response_checks:
            for f in self._check_command_response(inputs, pwms):
                self._latch(f)
                seen_keys.add(f.key())

        # 6) Clear conditions for latched faults that are no longer true
        self._clear_resolved_faults(inputs, pwms)

        # Return ALL currently active (latched) faults
        return [fault.to_dict() for fault in self.latched.values() if fault.active]

    def reset(self) -> None:
        """Reset runtime-only monitor state (counters, timers, latches)."""
        self.cycle = 0
        self.last_inputs = {k: None for k in self.INPUTS}
        self.same_count = {k: 0 for k in self.INPUTS}
        self.all_same_count = 0
        self.pwm_active_since = {k: None for k in self.PWMS}
        self.latched = {}

    def reset_cycle_runtime_state(self) -> None:
        """Reset non-latched runtime counters between cycle feature events."""
        self.last_inputs = {k: None for k in self.INPUTS}
        self.same_count = {k: 0 for k in self.INPUTS}
        self.all_same_count = 0
        self.pwm_active_since = {k: None for k in self.PWMS}

    # Latching
    def _latch(self, fault: Fault):
        k = fault.key()
        if k not in self.latched:
            self.latched[k] = fault
        else:
            # Update message/cycle but keep latched state
            existing = self.latched[k]
            existing.message = fault.message
            existing.cycle = fault.cycle
            existing.severity = fault.severity
            existing.subsystem = fault.subsystem
            existing.confidence = fault.confidence
            existing.active = True

    def _clear_fault(self, fault_id: str, signal: str):
        k = f"{fault_id}:{signal}"
        if k in self.latched:
            self.latched[k].active = False
            # Optional: keep in dict but inactive, so you have history
            # If you prefer to fully remove, replace with: del self.latched[k]

    # PWM validity + mode detection
    def _check_pwm_validity(self, pwms: Dict) -> List[Fault]:
        faults = []
        for pwm, val in pwms.items():
            if val < 0:
                faults.append(
                    Fault(
                        "INVALID_PWM_VALUE",
                        "IO_HEALTH",
                        "CRITICAL",
                        "CONTROL",
                        pwm,
                        f"{pwm} = {val} invalid (negative not allowed)",
                        self.cycle,
                    )
                )
            elif val > self.PWM_MAX:
                faults.append(
                    Fault(
                        "INVALID_PWM_VALUE",
                        "IO_HEALTH",
                        "CRITICAL",
                        "CONTROL",
                        pwm,
                        f"{pwm} = {val} invalid (> {self.PWM_MAX})",
                        self.cycle,
                    )
                )
            elif 1 <= val <= (self.PWM_MIN_WORKING - 1):
                faults.append(
                    Fault(
                        "INVALID_PWM_VALUE",
                        "IO_HEALTH",
                        "CRITICAL",
                        "CONTROL",
                        pwm,
                        f"{pwm} = {val} invalid (allowed: 0 or >= {self.PWM_MIN_WORKING})",
                        self.cycle,
                    )
                )
        return faults

    def _detect_mode(self, pwms: Dict):
        active = [p for p in self.PWMS if pwms.get(p, 0) >= self.PWM_MIN_WORKING]

        if len(active) == 0:
            return "IDLE", []

        if len(active) > 1:
            return "INVALID", [
                Fault(
                    "MULTIPLE_PWM_ACTIVE",
                    "IO_HEALTH",
                    "CRITICAL",
                    "CONTROL",
                    ",".join(active),
                    "Multiple actuators commanded simultaneously",
                    self.cycle,
                )
            ]

        return {
            "PWM_1": "BELT_FORWARD",
            "PWM_2": "BELT_REVERSE",
            "PWM_3": "PUNCH_UP",
            "PWM_4": "PUNCH_DOWN",
        }[active[0]], []
    
    # Mode consistency rules for idle state
    def _check_mode_consistency(
        self,
        inputs: Dict,
        pwms: Dict,
        run_command_response_checks: bool = True,
    ) -> List[Fault]:
        I1, I2, I3, I4 = inputs["I_1"], inputs["I_2"], inputs["I_3"], inputs["I_4"]
        faults: List[Fault] = []
        pwm1_on = pwms.get("PWM_1", 0) >= self.PWM_MIN_WORKING
        pwm2_on = pwms.get("PWM_2", 0) >= self.PWM_MIN_WORKING
        pwm3_on = pwms.get("PWM_3", 0) >= self.PWM_MIN_WORKING
        pwm4_on = pwms.get("PWM_4", 0) >= self.PWM_MIN_WORKING
        idle = not (pwm1_on or pwm2_on or pwm3_on or pwm4_on)

        # In idle state, object sensors must match expected transport positions.
        if idle and (I1 != 0 or I2 != 1):
            faults.append(
                Fault(
                    "OBJECT_SENSOR_WIRE_ISSUE",
                    "IO_HEALTH",
                    "CRITICAL",
                    "SENSORS",
                    "I_1,I_2",
                    "Object sensors report identical values (possible wiring fault or sensor failure)",
                    self.cycle,
                )
            )

        # Punch sensors both high indicates impossible mechanical state.
        if I3 == 1 and I4 == 1:
            faults.append(
                Fault(
                    "PUNCH_WIRE_ISSUE",
                    "IO_HEALTH",
                    "CRITICAL",
                    "PUNCH",
                    "I_3,I_4",
                    "Punch sensors report identical values (possible wiring fault or sensor failure)",
                    self.cycle,
                )
            )

        # In idle state, punch must be up.
        if idle and (I3 != 1 or I4 != 0):
            faults.append(
                Fault(
                    "PUNCH_POSITION_INVALID_IDLE",
                    "IO_HEALTH",
                    "CRITICAL",
                    "PUNCH",
                    "I_3,I_4",
                    "Punch position invalid in idle state (expected I_3=1, I_4=0)",
                    self.cycle,
                )
            )

        # Impossible punch state
        if I3 == 1 and I4 == 1:
            faults.append(
                Fault(
                    "IMPOSSIBLE_PUNCH_STATE",
                    "IO_HEALTH",
                    "CRITICAL",
                    "PUNCH",
                    "I_3,I_4",
                    "Punch UP and DOWN sensors active simultaneously",
                    self.cycle,
                )
            )

        # Your REAL idle snapshot at cycle end:
        # I1=0 (object at start), I2=1 (no object at punch), I3=1 (punch up), I4=0
        if idle:
            if not (I1 == 0 and I2 == 1 and I3 == 1 and I4 == 0):
                faults.append(
                    Fault(
                        "INVALID_IDLE_STATE",
                        "IO_HEALTH",
                        "WARNING",
                        "CONTROL",
                        "I_1..I_4",
                        f"Idle invalid: expected I1=0,I2=1,I3=1,I4=0 but got {inputs}",
                        self.cycle,
                    )
                )

        if pwm1_on or pwm2_on:
            # Belt must only move when punch is up
            if I3 != 1 or I4 != 0:
                faults.append(
                    Fault(
                        "BELT_MOVING_WHILE_PUNCH_NOT_UP",
                        "IO_HEALTH",
                        "CRITICAL",
                        "PUNCH",
                        "I_3,I_4",
                        "Belt commanded while punch not in UP position",
                        self.cycle,
                    )
                )

        if pwm4_on:
            # Punching should only happen when object at station (I2 should be 0 when object blocks it)
            # I2 reads 0 when an object is blocking the phototransistor at the punch station.
            if I2 != 0:
                faults.append(
                    Fault(
                        "PUNCH_DOWN_NO_OBJECT_AT_STATION",
                        "IO_HEALTH",
                        "CRITICAL",
                        "PUNCH",
                        "I_2",
                        "Punch down commanded but no object detected at punch station",
                        self.cycle,
                    )
                )
            if run_command_response_checks and I3 != 0:
                faults.append(
                    Fault(
                        "PUNCH_DOWN_UP_LIMIT_ACTIVE",
                        "IO_HEALTH",
                        "CRITICAL",
                        "PUNCH",
                        "I_3",
                        "Punch down commanded while UP limit still active",
                        self.cycle,
                    )
                )

        if pwm3_on:
            if I2 != 0:
                faults.append(
                    Fault(
                        "PUNCH_UP_NO_OBJECT_AT_STATION",
                        "IO_HEALTH",
                        "CRITICAL",
                        "PUNCH",
                        "I_2",
                        "Punch up commanded but no object detected at punch station",
                        self.cycle,
                    )
                )
            if run_command_response_checks and I4 != 0:
                faults.append(
                    Fault(
                        "PUNCH_UP_DOWN_LIMIT_ACTIVE",
                        "IO_HEALTH",
                        "CRITICAL",
                        "PUNCH",
                        "I_4",
                        "Punch up commanded while DOWN limit still active",
                        self.cycle,
                    )
                )

        return faults

    # Power loss
    def _check_global_power(self, inputs: Dict) -> Optional[Fault]:
        vals = list(inputs.values())
        if all(v == vals[0] for v in vals):
            self.all_same_count += 1
            if self.all_same_count >= self.ALL_SAME_CYCLES:
                return Fault(
                    "SENSOR_POWER_LOSS",
                    "IO_HEALTH",
                    "CRITICAL",
                    "POWER",
                    "I_1..I_4",
                    "All inputs identical for long time (possible 24V sensor power loss)",
                    self.cycle,
                )
        else:
            self.all_same_count = 0
        return None

    # Stuck sensors (latched)
    def _check_stuck_inputs(self, inputs: Dict) -> List[Fault]:
        faults = []
        for k in self.INPUTS:
            if self.last_inputs[k] is None:
                self.last_inputs[k] = inputs[k]
                self.same_count[k] = 0
                continue

            if inputs[k] == self.last_inputs[k]:
                self.same_count[k] += 1
                if self.same_count[k] == self.STUCK_CYCLES:
                    faults.append(
                        Fault(
                            "STUCK_SENSOR",
                            "IO_HEALTH",
                            "WARNING",
                            "SENSORS",
                            k,
                            f"{k} unchanged for {self.STUCK_CYCLES} cycles",
                            self.cycle,
                        )
                    )
            else:
                # Sensor changed -> clear stuck latch if it exists
                self.last_inputs[k] = inputs[k]
                self.same_count[k] = 0
                self._clear_fault("STUCK_SENSOR", k)

        return faults

    # Command-response (latched)
    def _check_command_response(self, inputs: Dict, pwms: Dict) -> List[Fault]:
        faults = []
        for pwm, (sensor, subsystem, msg) in self.PWM_SENSOR_MAP.items():
            pwm_on = pwms[pwm] >= self.PWM_MIN_WORKING

            if pwm_on:
                if self.pwm_active_since[pwm] is None:
                    self.pwm_active_since[pwm] = self.cycle
                else:
                    if (self.cycle - self.pwm_active_since[pwm]) >= self.RESPONSE_TIMEOUT:
                        faults.append(
                            Fault(
                                "NO_SENSOR_RESPONSE",
                                "IO_HEALTH",
                                "CRITICAL",
                                subsystem,
                                sensor,
                                msg,
                                self.cycle,
                            )
                        )
            else:
                # PWM off -> reset timer and clear latch if exists
                self.pwm_active_since[pwm] = None
                self._clear_fault("NO_SENSOR_RESPONSE", sensor)

        return faults

    # Clearing rules for persistent faults
    def _clear_resolved_faults(self, inputs: Dict, pwms: Dict):
        """
        Clears faults that are no longer true.
        Some latches are cleared in their own checks (stuck, command_response).
        This covers mode faults and power loss.
        """

        # Clear power loss if inputs not identical anymore
        vals = list(inputs.values())
        if not all(v == vals[0] for v in vals):
            self._clear_fault("SENSOR_POWER_LOSS", "I_1..I_4")

        # Clear invalid idle if we are now idle-valid OR not idle
        mode, _ = self._detect_mode(pwms)
        if mode != "IDLE":
            self._clear_fault("INVALID_IDLE_STATE", "I_1..I_4")
        else:
            # If idle becomes valid, clear latch
            if (inputs["I_1"] == 0 and inputs["I_2"] == 1 and inputs["I_3"] == 1 and inputs["I_4"] == 0):
                self._clear_fault("INVALID_IDLE_STATE", "I_1..I_4")

        # Clear multiple PWM if now not multiple
        active = [p for p in self.PWMS if pwms.get(p, 0) >= self.PWM_MIN_WORKING]
        if len(active) <= 1:
            self._clear_fault("MULTIPLE_PWM_ACTIVE", ",".join(active) if active else "PWM_1,PWM_2,PWM_3,PWM_4")

        # Clear invalid PWM values when all are valid
        # (We can't clear per-signal unless we track which were invalid; easiest: clear all if all valid)
        all_valid = True
        for pwm, val in pwms.items():
            if val < 0 or val > self.PWM_MAX or (1 <= val <= (self.PWM_MIN_WORKING - 1)):
                all_valid = False
                break
        if all_valid:
            for pwm in self.PWMS:
                self._clear_fault("INVALID_PWM_VALUE", pwm)

        # Clear impossible punch state if no longer impossible
        if not (inputs["I_3"] == 1 and inputs["I_4"] == 1):
            self._clear_fault("IMPOSSIBLE_PUNCH_STATE", "I_3,I_4")

        # Clear belt moving while punch not up if punch is up now
        if inputs["I_3"] == 1 and inputs["I_4"] == 0:
            self._clear_fault("BELT_MOVING_WHILE_PUNCH_NOT_UP", "I_3,I_4")

        # Clear punch mode faults based on conditions
        if inputs["I_2"] == 0:
            self._clear_fault("PUNCH_DOWN_NO_OBJECT_AT_STATION", "I_2")
            self._clear_fault("PUNCH_UP_NO_OBJECT_AT_STATION", "I_2")
        if inputs["I_3"] == 0:
            self._clear_fault("PUNCH_DOWN_UP_LIMIT_ACTIVE", "I_3")
        if inputs["I_4"] == 0:
            self._clear_fault("PUNCH_UP_DOWN_LIMIT_ACTIVE", "I_4")
