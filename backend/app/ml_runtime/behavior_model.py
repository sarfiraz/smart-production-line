# ml_behavior_model_runtime.py
# ML inference logic helper (if ml_service imports it)
import joblib
import pandas as pd

EPS = 1e-9

class MLBehaviorModel:
    def __init__(self, model_path: str):
        self.model = joblib.load(model_path)

    def features_from_cycle(self, cycle: dict) -> pd.Series:
        cd   = float(cycle["cycle_duration"])
        belt = float(cycle["belt_move_time"])
        down = float(cycle["punch_down_time"])
        up   = float(cycle["punch_up_time"])
        fwd  = float(cycle["belt_forward_duration"])
        rev  = float(cycle["belt_reverse_duration"])
        load = float(cycle["machine_load"])

        x = {
            "belt_time_ratio": belt / (cd + EPS),
            "load_ratio": load / (cd + EPS),
            "punch_symmetry": down / (up + EPS),
            "belt_symmetry": fwd / (rev + EPS),
            "punch_down_share": down / (down + up + EPS),
            "overhead_ratio": 1.0 - ((belt + down + up) / (cd + EPS)),
        }
        return pd.Series(x)

    def predict(self, cycle_id: int, x_row: pd.Series) -> dict:
        med = pd.Series(self.model["train_median"])
        mad = pd.Series(self.model["train_mad"]).replace(0, EPS)
        top_k = int(self.model["top_k"])

        z = (x_row - med) / mad
        score = float(z.abs().sort_values(ascending=False).head(top_k).mean())

        warn = float(self.model["threshold_warning"])
        crit = float(self.model["threshold_critical"])

        if score > crit:
            status = "CRITICAL"
        elif score > warn:
            status = "WARNING"
        else:
            status = "NORMAL"

        if score <= warn:
            confidence = max(0.0, 1.0 - score / (warn + EPS))
        elif score >= crit:
            confidence = 1.0
        else:
            confidence = (score - warn) / (crit - warn + EPS)

        feature_subsystem = self.model.get("feature_subsystem", {})
        top = z.reindex(z.abs().sort_values(ascending=False).index).head(3)

        dominant = []
        subsystems = set()
        for name, zval in top.items():
            subsys = feature_subsystem.get(name, "SYSTEM")
            dominant.append({"name": name, "z_score": float(zval), "subsystem": subsys})
            subsystems.add(subsys)

        return {
            "layer": "ML_BEHAVIOR",
            "cycle_id": int(cycle_id),
            "status": status,
            "anomaly_score": float(score),
            "thresholds": {"warning": warn, "critical": crit},
            "confidence": float(confidence),
            "affected_subsystems": sorted(list(subsystems)),
            "dominant_features": dominant,
        }
