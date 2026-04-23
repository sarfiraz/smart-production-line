
#RevPi Runtime Config

# IP address of the PC running the MQTT broker (Windows hotspot default)
# Change this to match your PC's IP address on the shared network
MQTT_HOST = "192.168.137.1" 
MQTT_PORT = 1883
MQTT_KEEPALIVE = 60

# External topics (backend communication)
TOPIC_COMMAND = "factory/line1/runtime/command"
TOPIC_STATE = "factory/line1/runtime/state"
TOPIC_CYCLE_FEATURES = "factory/line1/runtime/cycle/features"
TOPIC_SUPERVISOR_HEARTBEAT = "factory/line1/runtime/supervisor/heartbeat"
TOPIC_IO_SNAPSHOT = "factory/line1/runtime/io_snapshot"
TOPIC_RUNTIME_STATUS = "factory/line1/runtime/status"

# NEW — machine speed feedback
TOPIC_SPEED_STATUS = "factory/line1/runtime/speed"

# Internal supervisor → worker control
TOPIC_WORKER_CONTROL = "factory/line1/runtime/internal/worker_control"

# Machine parameters
PWM_NOMINAL = 80
PWM_MIN_ON = 51

# Safety timeouts (seconds)
TIMEOUT_BELT_TO_I2 = 10.0
TIMEOUT_PUNCH_DOWN_TO_I4 = 6.0
TIMEOUT_PUNCH_UP_TO_I3 = 6.0
TIMEOUT_BELT_BACK_TO_I1 = 10.0

# Loop sleeps
SLEEP_BELT = 0.01
SLEEP_PUNCH = 0.005