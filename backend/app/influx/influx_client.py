from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
import os
import logging
from datetime import datetime, timezone
from app.services.cycle_processor import extract_cycle_speed

logger = logging.getLogger(__name__)

# InfluxDB Configuration
INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://influxdb:8086")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "admin-token")
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "my-org")
INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET", "revpi_data")

# Initialize InfluxDB client
client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
write_api = client.write_api(write_options=SYNCHRONOUS)


def write_sensor_data_to_influx(topic: str, data: dict):
    """Write sensor data to InfluxDB."""
    try:
        # Extract sensor name from topic (e.g., revpi/sensors/temperature -> temperature)
        sensor_name = topic.split("/")[-1] if "/" in topic else topic
        
        # Create a data point
        point = Point("sensor_data")
        point.tag("sensor_id", sensor_name)
        point.tag("topic", topic)
        
        # Add fields from data dictionary
        for key, value in data.items():
            if isinstance(value, (int, float)):
                point.field(key, value)
            elif isinstance(value, str):
                try:
                    # Try to convert string to float
                    point.field(key, float(value))
                except (ValueError, TypeError):
                    point.tag(key, value)
        
        # Set timestamp
        if "timestamp" in data:
            try:
                point.time(data["timestamp"])
            except:
                point.time(datetime.utcnow())
        else:
            point.time(datetime.utcnow())
        
        # Write to InfluxDB
        write_api.write(bucket=INFLUXDB_BUCKET, record=point)
        logger.debug(f"Written data to InfluxDB: {sensor_name}")
    except Exception as e:
        logger.error(f"Error writing to InfluxDB: {e}")


def write_cycle_features_to_influx(data: dict):
    """Write cycle feature metrics to dedicated cycle_features measurement."""
    try:
        features = data.get("features", {}) if isinstance(data, dict) else {}
        if not isinstance(features, dict):
            logger.warning("Cycle features payload missing features object")
            return

        required_fields = [
            "cycle_duration",
            "belt_move_time",
            "punch_down_time",
            "punch_up_time",
            "belt_reverse_duration",
        ]

        missing = [field for field in required_fields if field not in features]
        if missing:
            logger.warning(f"Cycle features payload missing required fields: {missing}")
            return

        point = Point("cycle_features").tag("source", "revpi")

        cycle_id = data.get("cycle_id")
        if cycle_id is not None:
            point.field("cycle_id", int(cycle_id))
        global_cycle_id = data.get("global_cycle_id")
        if global_cycle_id is not None:
            point.field("global_cycle_id", int(global_cycle_id))

        point.field("cycle_duration", float(features["cycle_duration"]))
        point.field("belt_move_time", float(features["belt_move_time"]))
        point.field("punch_down_time", float(features["punch_down_time"]))
        point.field("punch_up_time", float(features["punch_up_time"]))
        point.field("belt_reverse_duration", float(features["belt_reverse_duration"]))

        # Persist conveyor speed used in this cycle for analytics correlation.
        speed = extract_cycle_speed(data)
        if speed is not None:
            point.field("speed", float(speed))
        else:
            logger.warning("Cycle features payload missing valid PWM_1 speed")

        if "timestamp" in data:
            try:
                point.time(data["timestamp"])
            except Exception:
                point.time(datetime.utcnow())
        else:
            point.time(datetime.utcnow())

        write_api.write(bucket=INFLUXDB_BUCKET, record=point)
        logger.debug("Written cycle_features point to InfluxDB")
    except Exception as e:
        logger.error(f"Error writing cycle features to InfluxDB: {e}")


def write_ml_result_to_influx(cycle_id: int, anomaly_score: float, status: str, global_cycle_id: int | None = None):
    """Write ML behavior result to InfluxDB."""
    try:
        point = (
            Point("ml_behavior")
            .tag("status", status)
            .field("anomaly_score", float(anomaly_score))
            .field("cycle_id", int(cycle_id))
            .time(datetime.utcnow())
        )
        if global_cycle_id is not None:
            point.field("global_cycle_id", int(global_cycle_id))
        write_api.write(bucket=INFLUXDB_BUCKET, record=point)
        logger.debug(f"Written ML result to InfluxDB: cycle={cycle_id} status={status}")
    except Exception as e:
        logger.error(f"Error writing ML result to InfluxDB: {e}")


def write_decision_to_influx(cycle_id: int, decision_level: str, should_stop: bool, global_cycle_id: int | None = None):
    """Write decision engine output to InfluxDB."""
    try:
        point = (
            Point("decision")
            .tag("decision_level", decision_level)
            .field("should_stop", int(should_stop))
            .field("cycle_id", int(cycle_id))
            .time(datetime.utcnow())
        )
        if global_cycle_id is not None:
            point.field("global_cycle_id", int(global_cycle_id))
        write_api.write(bucket=INFLUXDB_BUCKET, record=point)
        logger.debug(f"Written decision to InfluxDB: cycle={cycle_id} level={decision_level}")
    except Exception as e:
        logger.error(f"Error writing decision to InfluxDB: {e}")


def write_machine_state_to_influx(state: str):
    """Write machine state transition to InfluxDB."""
    try:
        point = (
            Point("machine_state")
            .tag("state", state)
            .field("state_value", 1)
            .time(datetime.utcnow())
        )
        write_api.write(bucket=INFLUXDB_BUCKET, record=point)
        logger.debug(f"Written machine state to InfluxDB: {state}")
    except Exception as e:
        logger.error(f"Error writing machine state to InfluxDB: {e}")


def query_sensor_data(sensor_id: str, start_time: str = "-1h", limit: int = 100):
    """Query sensor data from InfluxDB."""
    try:
        query_api = client.query_api()
        query = f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: {start_time})
        |> filter(fn: (r) => r["_measurement"] == "sensor_data")
        |> filter(fn: (r) => r["sensor_id"] == "{sensor_id}")
        |> limit(n: {limit})
        '''
        result = query_api.query(org=INFLUXDB_ORG, query=query)
        
        data_points = []
        for table in result:
            for record in table.records:
                data_points.append({
                    "time": record.get_time().isoformat(),
                    "value": record.get_value(),
                    "field": record.get_field(),
                    "sensor_id": record.values.get("sensor_id")
                })
        return data_points
    except Exception as e:
        logger.error(f"Error querying InfluxDB: {e}")
        return []


def get_latest_sensor_data(sensor_id: str = None):
    """Get latest sensor data from InfluxDB."""
    try:
        query_api = client.query_api()
        if sensor_id:
            query = f'''
            from(bucket: "{INFLUXDB_BUCKET}")
            |> range(start: -1h)
            |> filter(fn: (r) => r["_measurement"] == "sensor_data")
            |> filter(fn: (r) => r["sensor_id"] == "{sensor_id}")
            |> last()
            '''
        else:
            query = f'''
            from(bucket: "{INFLUXDB_BUCKET}")
            |> range(start: -1h)
            |> filter(fn: (r) => r["_measurement"] == "sensor_data")
            |> group(columns: ["sensor_id"])
            |> last()
            '''
        result = query_api.query(org=INFLUXDB_ORG, query=query)
        
        latest_data = {}
        for table in result:
            for record in table.records:
                sensor_id_key = record.values.get("sensor_id", "unknown")
                if sensor_id_key not in latest_data:
                    latest_data[sensor_id_key] = {}
                latest_data[sensor_id_key][record.get_field()] = record.get_value()
                latest_data[sensor_id_key]["timestamp"] = record.get_time().isoformat()
        return latest_data
    except Exception as e:
        logger.error(f"Error getting latest sensor data: {e}")
        return {}


def delete_old_cycle_features():
    """Delete analytics measurements entirely for development reset."""
    try:
        start = datetime(1970, 1, 1, tzinfo=timezone.utc)
        stop = datetime(2100, 1, 1, tzinfo=timezone.utc)
        measurements = [
            "cycle_features",
            "anomaly_scores",
            "ml_decisions",
            "ml_results",
            # Current analytics measurements used by the app.
            "ml_behavior",
            "decision",
            "machine_state",
        ]
        delete_api = client.delete_api()
        for measurement in measurements:
            delete_api.delete(
                start=start,
                stop=stop,
                predicate=f'_measurement="{measurement}"',
                bucket=INFLUXDB_BUCKET,
                org=INFLUXDB_ORG,
            )
        logger.info("Deleted analytics measurements: %s", measurements)
        return {"measurements": measurements}
    except Exception as e:
        logger.error(f"Error deleting analytics measurements: {e}")
        raise



