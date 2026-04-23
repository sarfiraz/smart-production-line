from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional
from datetime import datetime



# Decision levels
LEVEL_NORMAL = "NORMAL"
LEVEL_WARNING = "WARNING"
LEVEL_CRITICAL = "CRITICAL"
LEVEL_EMERGENCY_STOP = "EMERGENCY_STOP"


@dataclass
class Decision:
    timestamp: str
    cycle_id: int

    decision_level: str
    should_stop: bool
    operator_action_required: bool

    summary: str
    reasons: List[Dict[str, Any]]

    #raw inputs attached for downstream traceability
    io_health: Optional[Dict[str, Any]] = None
    ml_result: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class DecisionEngine:
    """
    Strict reaction policy.

    Rules:
      1) Any IO_HEALTH CRITICAL -> EMERGENCY_STOP (automatic)
      2) ML CRITICAL -> CRITICAL (recommend stop, operator decides)
      3) ML WARNING -> WARNING (notify + log)
      4) Otherwise -> NORMAL

    Why this is correct:
      - IO critical faults are safety/hardware failures (wiring, power, impossible states)
      - ML critical is behavior anomaly: serious, but not guaranteed unsafe
    """

    def __init__(self):
        pass

    def decide(
        self,
        io_health_msg: Optional[Dict[str, Any]],
        ml_result_msg: Optional[Dict[str, Any]],
    ) -> Decision:

        cycle_id = self._extract_cycle_id(io_health_msg, ml_result_msg)

        # Extract faults
        faults = []
        if io_health_msg and isinstance(io_health_msg.get("faults", None), list):
            faults = io_health_msg["faults"]

        io_critical_faults = [f for f in faults if str(f.get("severity", "")).upper() == "CRITICAL"]
        io_warning_faults = [f for f in faults if str(f.get("severity", "")).upper() == "WARNING"]

        # Extract ML status
        ml_status = None
        ml_score = None
        if ml_result_msg:
            ml_status = str(ml_result_msg.get("status", "")).upper()
            ml_score = ml_result_msg.get("anomaly_score", None)

        # IO CRITICAL takes precedence — triggers immediate emergency stop
        if len(io_critical_faults) > 0:
            reasons = []
            for f in io_critical_faults:
                reasons.append({
                    "source": "IO_HEALTH",
                    "severity": "CRITICAL",
                    "fault_id": f.get("fault_id"),
                    "signal": f.get("signal"),
                    "subsystem": f.get("subsystem"),
                    "message": f.get("message"),
                })

            return Decision(
                timestamp=datetime.now().isoformat(),
                cycle_id=cycle_id,
                decision_level=LEVEL_EMERGENCY_STOP,
                should_stop=True,
                operator_action_required=True,  # require acknowledge/reset
                summary="Emergency stop: critical hardware/control fault detected.",
                reasons=reasons,
                io_health=io_health_msg,
                ml_result=ml_result_msg,
            )

        # RULE 2: ML critical -> recommend stop
        if ml_status == "CRITICAL":
            reasons = [{
                "source": "ML_BEHAVIOR",
                "severity": "CRITICAL",
                "status": ml_status,
                "anomaly_score": ml_score,
                "affected_subsystems": ml_result_msg.get("affected_subsystems", []),
                "dominant_features": ml_result_msg.get("dominant_features", []),
                "message": "Critical behavior anomaly detected by ML model.",
            }]

            # Optionally include IO warnings as context
            for f in io_warning_faults:
                reasons.append({
                    "source": "IO_HEALTH",
                    "severity": "WARNING",
                    "fault_id": f.get("fault_id"),
                    "signal": f.get("signal"),
                    "subsystem": f.get("subsystem"),
                    "message": f.get("message"),
                })

            return Decision(
                timestamp=datetime.now().isoformat(),
                cycle_id=cycle_id,
                decision_level=LEVEL_CRITICAL,
                should_stop=False,  # do not auto-stop on ML alone
                operator_action_required=True,
                summary="Critical ML anomaly: recommend controlled stop and inspection.",
                reasons=reasons,
                io_health=io_health_msg,
                ml_result=ml_result_msg,
            )

        # RULE 3: ML warning -> notify
        if ml_status == "WARNING":
            reasons = [{
                "source": "ML_BEHAVIOR",
                "severity": "WARNING",
                "status": ml_status,
                "anomaly_score": ml_score,
                "affected_subsystems": ml_result_msg.get("affected_subsystems", []),
                "dominant_features": ml_result_msg.get("dominant_features", []),
                "message": "Warning behavior deviation detected (predictive maintenance signal).",
            }]

            # Add IO warnings as context
            for f in io_warning_faults:
                reasons.append({
                    "source": "IO_HEALTH",
                    "severity": "WARNING",
                    "fault_id": f.get("fault_id"),
                    "signal": f.get("signal"),
                    "subsystem": f.get("subsystem"),
                    "message": f.get("message"),
                })

            return Decision(
                timestamp=datetime.now().isoformat(),
                cycle_id=cycle_id,
                decision_level=LEVEL_WARNING,
                should_stop=False,
                operator_action_required=False,
                summary="ML warning: log + notify operator (no stop).",
                reasons=reasons,
                io_health=io_health_msg,
                ml_result=ml_result_msg,
            )

        # RULE 4: Normal/Warmup -> normal
        # Warmup is treated as normal but should not trigger actions.
        return Decision(
            timestamp=datetime.now().isoformat(),
            cycle_id=cycle_id,
            decision_level=LEVEL_NORMAL,
            should_stop=False,
            operator_action_required=False,
            summary="System normal (or ML warm-up).",
            reasons=[],
            io_health=io_health_msg,
            ml_result=ml_result_msg,
        )

    @staticmethod
    def _extract_cycle_id(io_health_msg: Optional[Dict[str, Any]], ml_result_msg: Optional[Dict[str, Any]]) -> int:
        if io_health_msg and "cycle_id" in io_health_msg:
            return int(io_health_msg["cycle_id"])
        if ml_result_msg and "cycle_id" in ml_result_msg:
            return int(ml_result_msg["cycle_id"])
        return -1
