import logging
import re
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.database.models import SystemEvent
from app.services.dev_data_reset import reset_analytics_sql

logger = logging.getLogger(__name__)

try:
    from app.influx.influx_client import (
        client as influx_client,
        delete_old_cycle_features,
        INFLUXDB_ORG,
        INFLUXDB_BUCKET,
    )
    INFLUX_AVAILABLE = True
except ImportError:
    INFLUX_AVAILABLE = False

router = APIRouter(prefix="/api/history", tags=["history"])
dev_router = APIRouter(prefix="/api/dev", tags=["dev"])


def _require_influx():
    if not INFLUX_AVAILABLE:
        raise HTTPException(status_code=503, detail="InfluxDB not available")


def _flux_time(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def get_time_range(range: str):
    now = datetime.now(timezone.utc)
    key = (range or "24h").lower()
    if key == "today":
        start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif key == "7d":
        start_time = now - timedelta(days=7)
    elif key == "30d":
        start_time = now - timedelta(days=30)
    else:
        start_time = now - timedelta(hours=24)
    return start_time, now


@router.get("/system-events")
def system_events(limit: int = 200, db: Session = Depends(get_db)):
    """Return latest persisted system events ordered by timestamp desc."""
    safe_limit = max(1, min(int(limit or 200), 1000))
    events = (
        db.query(SystemEvent)
        .order_by(SystemEvent.timestamp.desc())
        .limit(safe_limit)
        .all()
    )
    return [
        {
            "id": event.id,
            "timestamp": event.timestamp.isoformat() if event.timestamp else None,
            "event_type": event.event_type,
            "source": event.source,
            "description": event.description,
            "details": event.description,
            "severity": event.severity,
        }
        for event in events
    ]


@router.get("/anomaly-trend")
def anomaly_trend(range: str = Query("24h")):
    """Last 1000 ML behavior data points sorted by time ascending."""
    _require_influx()
    try:
        start_time, end_time = get_time_range(range)
        start_iso = _flux_time(start_time)
        end_iso = _flux_time(end_time)
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: time(v: "{start_iso}"), stop: time(v: "{end_iso}"))
        |> filter(fn: (r) => r["_measurement"] == "ml_behavior")
        |> filter(fn: (r) => r["_field"] == "anomaly_score")
        |> sort(columns: ["_time"], desc: false)
        |> limit(n: 1000)
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
        return points
    except Exception as e:
        logger.error(f"anomaly-trend query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/decision-distribution")
def decision_distribution(range: str = Query("24h")):
    """Count of decisions grouped by decision_level."""
    _require_influx()
    try:
        start_time, end_time = get_time_range(range)
        start_iso = _flux_time(start_time)
        end_iso = _flux_time(end_time)
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: time(v: "{start_iso}"), stop: time(v: "{end_iso}"))
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
        logger.error(f"decision-distribution query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/incidents")
def incidents(range: str = Query("24h")):
    """Raw incident events (WARNING/CRITICAL/EMERGENCY_STOP) with cycle info."""
    _require_influx()
    try:
        start_time, end_time = get_time_range(range)
        start_iso = _flux_time(start_time)
        end_iso = _flux_time(end_time)
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: time(v: "{start_iso}"), stop: time(v: "{end_iso}"))
        |> filter(fn: (r) => r["_measurement"] == "decision")
        |> filter(fn: (r) => r["_field"] == "should_stop" or r["_field"] == "cycle_id" or r["_field"] == "global_cycle_id")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> keep(columns: ["_time", "cycle_id", "global_cycle_id", "decision_level"])
        |> sort(columns: ["_time"], desc: false)
        '''
        tables = query_api.query(org=INFLUXDB_ORG, query=query)

        records = []
        for table in tables:
            for record in table.records:
                values = record.values or {}
                decision = str(values.get("decision_level", "UNKNOWN")).upper()
                if decision not in ("WARNING", "CRITICAL", "EMERGENCY_STOP"):
                    continue
                cycle_id_val = values.get("cycle_id")
                cycle_id = int(cycle_id_val) if cycle_id_val is not None else None
                global_cycle_id_val = values.get("global_cycle_id")
                global_cycle_id = int(global_cycle_id_val) if global_cycle_id_val is not None else None
                if global_cycle_id is None:
                    global_cycle_id = cycle_id
                reason = (
                    "Immediate stop triggered by safety logic"
                    if decision == "EMERGENCY_STOP"
                    else "ML anomaly detected"
                )
                records.append({
                    "timestamp": record.get_time().isoformat(),
                    "cycle_id": cycle_id,
                    "global_cycle_id": global_cycle_id,
                    "decision": decision,
                    "reason": reason,
                })
        return records
    except Exception as e:
        logger.error(f"incidents query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/state-transitions")
def state_transitions(range: str = Query("24h"), db: Session = Depends(get_db)):
    """Raw machine state transitions for selected range, sorted by time ascending."""
    _require_influx()
    try:
        start_time, end_time = get_time_range(range)
        start_iso = _flux_time(start_time)
        end_iso = _flux_time(end_time)
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: time(v: "{start_iso}"), stop: time(v: "{end_iso}"))
        |> filter(fn: (r) => r["_measurement"] == "machine_state")
        |> filter(fn: (r) => r["_field"] == "state_value")
        |> keep(columns: ["_time", "state"])
        |> sort(columns: ["_time"], desc: false)
        '''
        tables = query_api.query(org=INFLUXDB_ORG, query=query)

        transitions = []
        for table in tables:
            for record in table.records:
                state = record.values.get("state", "UNKNOWN")
                transitions.append({
                    "timestamp": record.get_time(),
                    "state": str(state).upper(),
                })

        # Determine state immediately before window start from SQL history.
        prior_state = None
        try:
            row = db.execute(
                text(
                    """
                    SELECT state
                    FROM state_transitions
                    WHERE timestamp < :window_start
                    ORDER BY timestamp DESC
                    LIMIT 1
                    """
                ),
                {"window_start": start_time},
            ).fetchone()
            if row and row[0]:
                prior_state = str(row[0]).upper()
        except Exception:
            prior_state = None

        synthetic_state = prior_state if prior_state is not None else "IDLE"
        normalized = [{"timestamp": start_time, "state": synthetic_state}] + sorted(
            transitions,
            key=lambda t: t["timestamp"],
        )

        # Normalize outgoing shape as ISO strings expected by frontend.
        return [
            {
                "timestamp": item["timestamp"].isoformat(),
                "state": item["state"],
            }
            for item in normalized
        ]
    except Exception as e:
        logger.error(f"state-transitions query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/production-uptime")
def production_uptime(range: str = Query("24h"), db: Session = Depends(get_db)):
    """Compute time spent in PRODUCING state vs total selected window."""
    _require_influx()
    try:
        start_time, end_time = get_time_range(range)
        start_iso = _flux_time(start_time)
        end_iso = _flux_time(end_time)
        query_api = influx_client.query_api()
        window_start = start_time
        now = end_time

        # Retrieve all machine_state points in selected window, ordered by time
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: time(v: "{start_iso}"), stop: time(v: "{end_iso}"))
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

        # Determine state immediately before window start from SQL history.
        prior_state = None
        try:
            row = db.execute(
                text(
                    """
                    SELECT state
                    FROM state_transitions
                    WHERE timestamp < :window_start
                    ORDER BY timestamp DESC
                    LIMIT 1
                    """
                ),
                {"window_start": window_start},
            ).fetchone()
            if row and row[0]:
                prior_state = str(row[0]).upper()
        except Exception:
            # Table may not exist in some dev snapshots; default handled below.
            prior_state = None

        normalized = sorted(transitions, key=lambda t: t["time"])
        synthetic_state = prior_state if prior_state is not None else "IDLE"
        normalized = [{"time": window_start, "state": synthetic_state}] + normalized

        total_seconds = max(1.0, (now - window_start).total_seconds())
        producing_seconds = 0.0

        for i, current in enumerate(normalized):
            segment_start = max(current["time"], window_start)
            next_time = normalized[i + 1]["time"] if i + 1 < len(normalized) else now
            segment_end = min(next_time, now)
            if segment_end <= segment_start:
                continue
            if current["state"] == "PRODUCING":
                producing_seconds += (segment_end - segment_start).total_seconds()

        uptime_pct = round((producing_seconds / total_seconds) * 100, 2)

        return {
            "producing_seconds": round(producing_seconds, 2),
            "total_seconds": round(total_seconds, 2),
            "uptime_percentage": uptime_pct,
        }
    except Exception as e:
        logger.error(f"production-uptime query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cycle-duration-trend")
def cycle_duration_trend(range: str = Query("24h")):
    """Cycle duration points with timestamp and cycle_id in selected range."""
    _require_influx()
    try:
        start_time, end_time = get_time_range(range)
        start_iso = _flux_time(start_time)
        end_iso = _flux_time(end_time)
        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: time(v: "{start_iso}"), stop: time(v: "{end_iso}"))
        |> filter(fn: (r) => r["_measurement"] == "cycle_features")
        |> filter(fn: (r) => r["_field"] == "cycle_duration" or r["_field"] == "cycle_id" or r["_field"] == "global_cycle_id")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> keep(columns: ["_time", "cycle_id", "global_cycle_id", "cycle_duration"])
        |> sort(columns: ["_time"], desc: false)
        '''
        tables = query_api.query(org=INFLUXDB_ORG, query=query)

        points = []
        for table in tables:
            for record in table.records:
                values = record.values or {}
                cycle_duration = values.get("cycle_duration")
                if cycle_duration is None:
                    continue
                cycle_id_value = values.get("cycle_id")
                cycle_id = int(cycle_id_value) if cycle_id_value is not None else None
                global_cycle_id_value = values.get("global_cycle_id")
                global_cycle_id = int(global_cycle_id_value) if global_cycle_id_value is not None else None
                if global_cycle_id is None:
                    global_cycle_id = cycle_id
                points.append({
                    "timestamp": record.get_time().isoformat(),
                    "cycle_id": cycle_id,
                    "global_cycle_id": global_cycle_id,
                    "cycle_duration": float(cycle_duration),
                })

        return points
    except Exception as e:
        logger.error(f"cycle-duration-trend query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cycles")
def cycles(range: str = Query("24h"), db: Session = Depends(get_db)):
    """Cycle records with duration and machine speed (PWM_1)."""
    _require_influx()
    try:
        start_time, end_time = get_time_range(range)
        start_iso = _flux_time(start_time)
        end_iso = _flux_time(end_time)
        # Load SET_SPEED events to backfill historical cycles where speed was missing/zero.
        set_speed_events = (
            db.query(SystemEvent)
            .filter(SystemEvent.event_type == "SET_SPEED")
            .order_by(SystemEvent.timestamp.asc())
            .all()
        )

        speed_timeline = []
        for event in set_speed_events:
            speed_match = re.search(r"(\d{2,3})", event.description or "")
            if not speed_match or event.timestamp is None:
                continue
            speed_value = float(speed_match.group(1))
            if speed_value > 0:
                speed_timeline.append((event.timestamp.timestamp(), speed_value))

        def _fallback_speed_for(ts_seconds: float):
            fallback = None
            for event_ts, value in speed_timeline:
                if event_ts <= ts_seconds:
                    fallback = value
                else:
                    break
            return fallback

        query_api = influx_client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: time(v: "{start_iso}"), stop: time(v: "{end_iso}"))
        |> filter(fn: (r) => r["_measurement"] == "cycle_features")
        |> filter(fn: (r) => r["_field"] == "cycle_duration" or r["_field"] == "cycle_id" or r["_field"] == "global_cycle_id" or r["_field"] == "speed")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> keep(columns: ["_time", "cycle_id", "global_cycle_id", "cycle_duration", "speed"])
        |> sort(columns: ["_time"], desc: false)
        '''
        tables = query_api.query(org=INFLUXDB_ORG, query=query)

        records = []
        for table in tables:
            for record in table.records:
                values = record.values or {}
                cycle_duration = values.get("cycle_duration")
                speed = values.get("speed")
                if cycle_duration is None:
                    continue

                speed_num = float(speed) if speed is not None else 0.0
                cycle_ts_seconds = record.get_time().timestamp()
                if speed_num <= 0:
                    fallback_speed = _fallback_speed_for(cycle_ts_seconds)
                    if fallback_speed is not None:
                        speed_num = fallback_speed
                if speed_num <= 0:
                    continue
                cycle_id_value = values.get("cycle_id")
                cycle_id = int(cycle_id_value) if cycle_id_value is not None else None
                global_cycle_id_value = values.get("global_cycle_id")
                global_cycle_id = int(global_cycle_id_value) if global_cycle_id_value is not None else None
                if global_cycle_id is None:
                    global_cycle_id = cycle_id
                records.append({
                    "cycle_id": cycle_id,
                    "global_cycle_id": global_cycle_id,
                    "timestamp": record.get_time().isoformat(),
                    "cycle_duration": float(cycle_duration),
                    "speed": int(speed_num),
                })

        return records
    except Exception as e:
        logger.error(f"cycles query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@dev_router.post("/reset-analytics")
def reset_analytics():
    """Dev-only reset: keep only today's analytics data."""
    _require_influx()
    try:
        reset_analytics_sql()
        delete_old_cycle_features()
        return {
            "status": "ok",
            "message": "Analytics data reset. Only today's data will remain.",
        }
    except Exception as e:
        logger.error(f"reset-analytics failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
