import paho.mqtt.client as mqtt
import json
import logging
import time
from typing import Callable, Optional

from app.config import (
    MQTT_HOST as MQTT_BROKER,
    MQTT_PORT,
    MQTT_KEEPALIVE,
    TOPIC_COMMAND,
    TOPIC_CYCLE_FEATURES,
    TOPIC_MACHINE_STATE,
    TOPIC_MACHINE_SPEED,
    TOPIC_SUPERVISOR_HEARTBEAT,
)
from app.services.system_event_logger import log_system_event

logger = logging.getLogger(__name__)

# Lazy import for InfluxDB (only needed by MQTTClient, not MqttBus)
try:
    from app.influx.influx_client import (
        write_sensor_data_to_influx,
        write_cycle_features_to_influx,
        write_machine_state_to_influx,
    )
    INFLUX_AVAILABLE = True
except ImportError:
    INFLUX_AVAILABLE = False
    write_sensor_data_to_influx = None
    write_cycle_features_to_influx = None
    write_machine_state_to_influx = None

MQTT_TOPICS = [
    "factory/line1/runtime/#",
]


class MQTTClient:
    def __init__(self, on_message_callback: Optional[Callable] = None):
        self.client = mqtt.Client()
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.client.reconnect_delay_set(min_delay=1, max_delay=10)
        self.on_message_callback = on_message_callback
        self.connected = False
        self.last_machine_state = None
        self.last_logged_machine_state = None
        self.last_machine_speed = None
        self.last_supervisor_heartbeat = None

    @staticmethod
    def _speed_mode_from_pwm(pwm: int) -> str:
        mapping = {
            60: "Slow",
            70: "Reduced",
            80: "Nominal",
            90: "High",
            100: "Maximum",
        }
        return mapping.get(int(pwm), f"Custom {pwm}")

    def _on_connect(self, client, userdata, flags, rc):
        """Callback when MQTT client connects."""
        logger.debug(f"on_connect rc={rc}")
        if rc == 0:
            self.connected = True
            logger.info("Connected to MQTT broker")
            # Subscribe to topics
            for topic in MQTT_TOPICS:
                client.subscribe(topic)
                logger.info(f"Subscribed to topic: {topic}")
        else:
            logger.error(f"Failed to connect to MQTT broker, return code {rc}")

    def _on_disconnect(self, client, userdata, rc):
        """Callback when MQTT client disconnects."""
        self.connected = False
        logger.debug(f"on_disconnect rc={rc}")

    def _on_message(self, client, userdata, msg):
        """Callback when MQTT message is received."""
        try:
            print(f"[MQTT DEBUG] Received topic: {msg.topic}")
            topic = msg.topic
            payload = msg.payload.decode("utf-8")
            data = json.loads(payload)
            
            logger.info(f"Received message on {topic}: {data}")
            
            if "factory/line1/runtime/cycle/features" in topic and INFLUX_AVAILABLE:
                try:
                    # Ensure cycle speed is present for analytics correlation.
                    # Some cycle payloads can carry PWM_1 as 0 at cycle end; fallback to
                    # latest runtime speed snapshot when available.
                    if topic == TOPIC_CYCLE_FEATURES and isinstance(data, dict):
                        pwms = data.get("pwms")
                        if not isinstance(pwms, dict):
                            pwms = {}
                            data["pwms"] = pwms

                        pwm1 = pwms.get("PWM_1")
                        pwm1_num = None
                        try:
                            pwm1_num = float(pwm1) if pwm1 is not None else None
                        except (TypeError, ValueError):
                            pwm1_num = None

                        if pwm1_num is None or pwm1_num <= 0:
                            last_speed = self.last_machine_speed.get("pwm") if isinstance(self.last_machine_speed, dict) else None
                            try:
                                last_speed_num = float(last_speed) if last_speed is not None else None
                            except (TypeError, ValueError):
                                last_speed_num = None
                            if last_speed_num is not None and last_speed_num > 0:
                                pwms["PWM_1"] = last_speed_num

                    write_sensor_data_to_influx(topic, data)
                    if topic == TOPIC_CYCLE_FEATURES:
                        write_cycle_features_to_influx(data)
                except Exception as e:
                    logger.warning(f"Failed to write sensor data to InfluxDB: {e}")

            if topic == TOPIC_MACHINE_STATE:
                self.last_machine_state = data
                state = data.get("state", "UNKNOWN") if isinstance(data, dict) else "UNKNOWN"
                if state != self.last_logged_machine_state:
                    log_system_event(
                        event_type=str(state),
                        description=f"Machine state changed to {state}",
                        source="runtime",
                        severity="info",
                    )
                    self.last_logged_machine_state = state
                if INFLUX_AVAILABLE:
                    try:
                        write_machine_state_to_influx(state)
                    except Exception as e:
                        logger.warning(f"Failed to write machine state to InfluxDB: {e}")

            if topic == TOPIC_SUPERVISOR_HEARTBEAT:
                self.last_supervisor_heartbeat = time.time()

            if topic == TOPIC_MACHINE_SPEED:
                self.last_machine_speed = data
                pwm_value = data.get("pwm") if isinstance(data, dict) else None
                if pwm_value is not None:
                    try:
                        mode = self._speed_mode_from_pwm(int(pwm_value))
                        logger.info(f"Speed changed → {mode} ({int(pwm_value)}%)")
                    except (TypeError, ValueError):
                        logger.info("Speed update received with non-numeric pwm value")

            if topic == "factory/line1/runtime/decision":
                decision_level = str(data.get("decision_level", "")).upper() if isinstance(data, dict) else ""
                if decision_level in ("WARNING", "CRITICAL"):
                    severity = "warning" if decision_level == "WARNING" else "critical"
                    log_system_event(
                        event_type=decision_level,
                        description="ML anomaly detected",
                        source="ml",
                        severity=severity,
                    )
            
            # Call custom callback if provided
            if self.on_message_callback:
                self.on_message_callback(topic, data)
        except Exception as e:
            logger.error(f"Error processing MQTT message: {e}")

    def connect(self):
        """Connect to MQTT broker."""
        logger.info(f"Connecting to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")
        self.client.connect_async(MQTT_BROKER, MQTT_PORT, MQTT_KEEPALIVE)
        self.client.loop_start()
       

    def disconnect(self):
        """Disconnect from MQTT broker."""
        self.client.loop_stop()
        self.client.disconnect()

    def publish(self, topic: str, payload: dict):
        """Publish a message to MQTT broker."""
        try:
            result = self.client.publish(topic, json.dumps(payload))
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.info(f"Published to {topic}: {payload}")
            else:
                logger.error(f"Failed to publish to {topic}")
        except Exception as e:
            logger.error(f"Error publishing to MQTT: {e}")

    def publish_speed_command(self, speed: int):
        """Publish SET_SPEED command to runtime command topic."""
        payload = {
            "command": "SET_SPEED",
            "value": int(speed),
        }
        self.publish(TOPIC_COMMAND, payload)


# Global MQTT client instance
mqtt_client: Optional[MQTTClient] = None


def get_mqtt_client(on_message_callback: Optional[Callable] = None) -> MQTTClient:
    """Get or create MQTT client instance."""
    global mqtt_client
    if mqtt_client is None:
        mqtt_client = MQTTClient(on_message_callback=on_message_callback)
        mqtt_client.connect()
    elif on_message_callback is not None and mqtt_client.on_message_callback != on_message_callback:
        # Update callback if provided and different
        mqtt_client.on_message_callback = on_message_callback
    return mqtt_client


class MqttBus:
    """
    MQTT Bus wrapper for services (ml_service, chatgpt_service).
    Provides a simple interface: connect, disconnect, publish, subscribe.
    """
    def __init__(self, host: str, port: int, keepalive: int, client_id: str = "mqtt-bus"):
        self.host = host
        self.port = port
        self.keepalive = keepalive
        self.client_id = client_id
        self.client = mqtt.Client(client_id=client_id)
        self.client.reconnect_delay_set(min_delay=1, max_delay=10)
        self.subscriptions = {}  # topic -> callback
        self.connected = False
        
        # Set up callbacks
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        
    def _on_connect(self, client, userdata, flags, rc):
        """Callback when MQTT client connects."""
        if rc == 0:
            self.connected = True
            logger.info(f"MqttBus connected to {self.host}:{self.port} (client_id: {self.client_id})")
            # Resubscribe to all topics
            for topic in self.subscriptions.keys():
                client.subscribe(topic)
                logger.info(f"MqttBus subscribed to: {topic}")
        else:
            logger.error(f"MqttBus failed to connect, return code {rc}")
            
    def _on_message(self, client, userdata, msg):
        """Callback when MQTT message is received."""
        try:
            topic = msg.topic
            payload = msg.payload.decode("utf-8")
            data = json.loads(payload)
            
            # Find callback for this topic (exact match or wildcard)
            callback = None
            if topic in self.subscriptions:
                callback = self.subscriptions[topic]
            else:
                # Check for wildcard subscriptions
                for sub_topic, cb in self.subscriptions.items():
                    if self._topic_matches(sub_topic, topic):
                        callback = cb
                        break
            
            if callback:
                callback(topic, data)
            else:
                logger.warning(f"MqttBus received message on {topic} but no callback registered")
                
        except Exception as e:
            logger.error(f"MqttBus error processing message: {e}")
    
    def _topic_matches(self, pattern: str, topic: str) -> bool:
        """Check if topic matches pattern (supports # and + wildcards)."""
        if pattern == topic:
            return True
        # Simple wildcard matching
        if pattern.endswith('/#'):
            prefix = pattern[:-2]
            return topic.startswith(prefix + '/') or topic == prefix
        return False
    
    def connect(self):
        """Connect to MQTT broker."""
        self.client.connect_async(self.host, self.port, self.keepalive)
        self.client.loop_start()
    
    def disconnect(self):
        """Disconnect from MQTT broker."""
        try:
            self.client.loop_stop()
            self.client.disconnect()
            self.connected = False
            logger.info(f"MqttBus disconnected (client_id: {self.client_id})")
        except Exception as e:
            logger.error(f"MqttBus error disconnecting: {e}")
    
    def publish(self, topic: str, payload: dict):
        """Publish a message to MQTT broker."""
        try:
            result = self.client.publish(topic, json.dumps(payload))
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.debug(f"MqttBus published to {topic}")
            else:
                logger.error(f"MqttBus failed to publish to {topic}, return code {result.rc}")
        except Exception as e:
            logger.error(f"MqttBus error publishing to {topic}: {e}")
            raise
    
    def subscribe(self, topic: str, callback: Callable):
        """
        Subscribe to a topic with a callback.
        Callback signature: callback(topic: str, msg: dict)
        """
        self.subscriptions[topic] = callback
        if self.connected:
            self.client.subscribe(topic)
            logger.info(f"MqttBus subscribed to: {topic}")

