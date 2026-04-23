"""
Shared InfluxDB history query helpers.
Used by both the /api/history router and the ChatGPT interpreter service.
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

try:
    from app.influx.influx_client import (
        client as influx_client,
        INFLUXDB_ORG,
        INFLUXDB_BUCKET,
    )
    _INFLUX_OK = True
except ImportError:
    _INFLUX_OK = False


def influx_available() -> bool:
    return _INFLUX_OK


def get_recent_anomaly_scores(n: int = 20) -> list[dict]:
    """Return the last *n* anomaly score points (ascending by time)."""
    if not _INFLUX_OK:
        return []
    try:
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -24h)
        |> filter(fn: (r) => r["_measurement"] == "ml_behavior")
        |> filter(fn: (r) => r["_field"] == "anomaly_score")
        |> sort(columns: ["_time"], desc: true)
        |> limit(n: {n})
        '''
        tables = query_api.query(org=INFLUXDB_ORG, query=query)

        points = []
        for table in tables:
            for record in table.records:
                points.append({
                    "timestamp": record.get_time().isoformat(),
                    "anomaly_score": record.get_value(),
                    "status": record.values.get("status", "UNKNOWN"),
                })
        points.reverse()
        return points
    except Exception as e:
        logger.warning(f"get_recent_anomaly_scores failed: {e}")
        return []


def get_decision_distribution_24h() -> dict[str, int]:
    """Count decisions grouped by decision_level over the last 24 h."""
    if not _INFLUX_OK:
        return {}
    try:
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -24h)
        |> filter(fn: (r) => r["_measurement"] == "decision")
        |> filter(fn: (r) => r["_field"] == "should_stop")
        |> group(columns: ["decision_level"])
        |> count()
        '''
        tables = query_api.query(org=INFLUXDB_ORG, query=query)

        dist: dict[str, int] = {}
        for table in tables:
            for record in table.records:
                level = record.values.get("decision_level", "UNKNOWN")
                dist[level] = record.get_value()

        for key in ("NORMAL", "WARNING", "CRITICAL", "EMERGENCY_STOP"):
            dist.setdefault(key, 0)
        return dist
    except Exception as e:
        logger.warning(f"get_decision_distribution_24h failed: {e}")
        return {}


def get_production_uptime_24h() -> dict:
    """Compute PRODUCING time vs total window (last 24 h)."""
    if not _INFLUX_OK:
        return {}
    try:
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -24h)
        |> filter(fn: (r) => r["_measurement"] == "machine_state")
        |> filter(fn: (r) => r["_field"] == "state_value")
        |> sort(columns: ["_time"], desc: false)
        '''
        tables = query_api.query(org=INFLUXDB_ORG, query=query)

        transitions = []
        for table in tables:
            for record in table.records:
                transitions.append({
                    "time": record.get_time(),
                    "state": record.values.get("state", "UNKNOWN"),
                })

        total_seconds = 24 * 3600
        producing_seconds = 0.0

        if transitions:
            now = datetime.now(timezone.utc)
            for i, t in enumerate(transitions):
                if t["state"] == "PRODUCING":
                    start = t["time"]
                    end = transitions[i + 1]["time"] if i + 1 < len(transitions) else now
                    producing_seconds += (end - start).total_seconds()

        uptime_pct = round((producing_seconds / total_seconds) * 100, 2) if total_seconds else 0.0
        return {
            "producing_seconds": round(producing_seconds, 2),
            "total_seconds": total_seconds,
            "uptime_percentage": uptime_pct,
        }
    except Exception as e:
        logger.warning(f"get_production_uptime_24h failed: {e}")
        return {}


def get_emergency_stop_count_24h() -> int:
    """Count EMERGENCY_STOP decisions in the last 24 h."""
    if not _INFLUX_OK:
        return 0
    try:
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -24h)
        |> filter(fn: (r) => r["_measurement"] == "decision")
        |> filter(fn: (r) => r["_field"] == "should_stop")
        |> filter(fn: (r) => r["decision_level"] == "EMERGENCY_STOP")
        |> count()
        '''
        tables = query_api.query(org=INFLUXDB_ORG, query=query)

        total = 0
        for table in tables:
            for record in table.records:
                total += record.get_value()
        return total
    except Exception as e:
        logger.warning(f"get_emergency_stop_count_24h failed: {e}")
        return 0
