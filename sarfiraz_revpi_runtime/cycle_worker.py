#!/usr/bin/env python3
import json
import time
from datetime import datetime
import paho.mqtt.client as mqtt
import revpimodio2
from config import (
   MQTT_HOST,
   MQTT_PORT,
   MQTT_KEEPALIVE,
   TOPIC_COMMAND,
   TOPIC_CYCLE_FEATURES,
   TOPIC_WORKER_CONTROL,
   TOPIC_IO_SNAPSHOT,
   TOPIC_RUNTIME_STATUS,
   PWM_NOMINAL,
   PWM_MIN_ON,
   TIMEOUT_BELT_TO_I2,
   TIMEOUT_PUNCH_DOWN_TO_I4,
   TIMEOUT_PUNCH_UP_TO_I3,
   TIMEOUT_BELT_BACK_TO_I1,
   SLEEP_BELT,
   SLEEP_PUNCH,
)
# runtime speed variable
pwm = None

# Worker Runtime Flags
running = True
graceful_stop_requested = False
emergency_stop_requested = False

# MQTT CALLBACKS
def on_connect(client, userdata, flags, rc):
   print("Worker connected to MQTT with result code:", rc)
   client.subscribe(TOPIC_WORKER_CONTROL)

def on_message(client, userdata, msg):
   global graceful_stop_requested
   global emergency_stop_requested
   global pwm
   try:
       payload = json.loads(msg.payload.decode())
       command = payload.get("command")
       if command == "GRACEFUL_STOP":
           print("Worker received GRACEFUL_STOP request.")
           graceful_stop_requested = True
       elif command == "EMERGENCY_STOP":
           print("Worker received EMERGENCY_STOP request.")
           emergency_stop_requested = True
       elif command == "SET_SPEED":
           value = payload.get("value")
           if isinstance(value, int) and value >= PWM_MIN_ON:
               pwm = value
               print(f"Worker speed updated → {pwm}")
   except Exception as e:
       print("Worker MQTT message error:", e)

# Safety
def safe_stop(rpi):
   rpi.io.PWM_1.value = 0
   rpi.io.PWM_2.value = 0
   rpi.io.PWM_3.value = 0
   rpi.io.PWM_4.value = 0

def handle_motion_timeout(client, rpi, fault_id, message):
   global emergency_stop_requested
   safe_stop(rpi)
   try:
       fault_payload = {
           "timestamp": datetime.now().isoformat(),
           "level": "CRITICAL",
           "fault_id": fault_id,
           "message": message,
           "source": "revpi_worker",
       }
       client.publish(
           TOPIC_RUNTIME_STATUS,
           json.dumps(fault_payload),
           qos=0,
           retain=False,
       )
   except Exception as e:
       print("Fault publish error:", e)
   try:
       emergency_payload = {
           "timestamp": datetime.now().isoformat(),
           "command": "EMERGENCY_STOP",
           "source": "revpi_worker",
           "reason": fault_id,
       }
       client.publish(
           TOPIC_COMMAND,
           json.dumps(emergency_payload),
           qos=0,
           retain=False,
       )
   except Exception as e:
       print("Emergency command publish error:", e)
   emergency_stop_requested = True

# IO READ HELPERS
def read_inputs(rpi):
   return {
       "I_1": int(rpi.io.I_1.value),
       "I_2": int(rpi.io.I_2.value),
       "I_3": int(rpi.io.I_3.value),
       "I_4": int(rpi.io.I_4.value),
   }

def read_pwms(rpi):
   return {
       "PWM_1": int(rpi.io.PWM_1.value),
       "PWM_2": int(rpi.io.PWM_2.value),
       "PWM_3": int(rpi.io.PWM_3.value),
       "PWM_4": int(rpi.io.PWM_4.value),
   }

# TELEMETRY SNAPSHOT
def publish_snapshot(client, rpi):
   try:
       payload = {
           "timestamp": datetime.now().isoformat(),
           "source": "revpi",
           "io": read_inputs(rpi),
           "pwms": read_pwms(rpi),
       }
       client.publish(
           TOPIC_IO_SNAPSHOT,
           json.dumps(payload),
           qos=0,
           retain=False,
       )
   except Exception as e:
       print("Snapshot publish error:", e)

# WAIT UTILITY
def wait_until(cond_fn, timeout_s, sleep_s, client, rpi):
   global emergency_stop_requested
   t0 = time.time()
   last_snapshot = 0
   while not cond_fn():
       if emergency_stop_requested:
           return None
       if time.time() - t0 > timeout_s:
           return False
       now = time.time()
       if now - last_snapshot > 0.1:
           publish_snapshot(client, rpi)
           last_snapshot = now
       time.sleep(sleep_s)
   return True

# CYCLE EXECUTION
def run_one_cycle(rpi, client):
   global pwm
   if rpi.io.I_1.value != 0:
       raise RuntimeError("Precondition failed: Object not at I1 at cycle start.")
   cycle_start = time.time()
   # BELT FORWARD
   t0 = time.time()
   rpi.io.PWM_1.value = pwm
   ok = wait_until(
       lambda: rpi.io.I_2.value == 0,
       TIMEOUT_BELT_TO_I2,
       SLEEP_BELT,
       client,
       rpi,
   )
   rpi.io.PWM_1.value = 0
   if ok is None:
       return None
   if ok is False:
       handle_motion_timeout(
           client,
           rpi,
           "BELT_FORWARD_TIMEOUT_NO_SENSOR_RESPONSE",
           "Belt forward motion timeout or no sensor response: I2 not reached",
       )
       return None
   belt_move_time = time.time() - t0
   # PUNCH DOWN
   t1 = time.time()
   rpi.io.PWM_4.value = pwm
   ok = wait_until(
       lambda: rpi.io.I_4.value == 1,
       TIMEOUT_PUNCH_DOWN_TO_I4,
       SLEEP_PUNCH,
       client,
       rpi,
   )
   rpi.io.PWM_4.value = 0
   if ok is None:
       return None
   if ok is False:
       handle_motion_timeout(
           client,
           rpi,
           "PUNCH_DOWN_TIMEOUT_NO_SENSOR_RESPONSE",
           "Punch down motion timeout or no sensor response: I4 not reached",
       )
       return None
   punch_down_time = time.time() - t1
   # PUNCH UP
   t2 = time.time()
   rpi.io.PWM_3.value = pwm
   ok = wait_until(
       lambda: rpi.io.I_3.value == 1,
       TIMEOUT_PUNCH_UP_TO_I3,
       SLEEP_PUNCH,
       client,
       rpi,
   )
   rpi.io.PWM_3.value = 0
   if ok is None:
       return None
   if ok is False:
       handle_motion_timeout(
           client,
           rpi,
           "PUNCH_UP_TIMEOUT_NO_SENSOR_RESPONSE",
           "Punch up motion timeout or no sensor response: I3 not reached",
       )
       return None
   punch_up_time = time.time() - t2
   # BELT REVERSE
   t3 = time.time()
   rpi.io.PWM_2.value = pwm
   ok = wait_until(
       lambda: rpi.io.I_1.value == 0,
       TIMEOUT_BELT_BACK_TO_I1,
       SLEEP_BELT,
       client,
       rpi,
   )
   rpi.io.PWM_2.value = 0
   if ok is None:
       return None
   if ok is False:
       handle_motion_timeout(
           client,
           rpi,
           "BELT_REVERSE_TIMEOUT_NO_SENSOR_RESPONSE",
           "Belt reverse motion timeout or no sensor response: I1 not reached",
       )
       return None
   belt_reverse_time = time.time() - t3
   cycle_duration = time.time() - cycle_start
   return {
       "cycle_duration": cycle_duration,
       "belt_move_time": belt_move_time,
       "punch_down_time": punch_down_time,
       "punch_up_time": punch_up_time,
       # ML-required keys
       "belt_forward_duration": belt_move_time,
       "belt_reverse_duration": belt_reverse_time,
       "punch_motor_down_duration": punch_down_time,
       "punch_motor_up_duration": punch_up_time,
       # engineered features
       "cpu_temp_avg": None,
       "punch_speed": 1.0 / (punch_down_time + 1e-9),
       "belt_efficiency": belt_move_time / (cycle_duration + 1e-9),
       "machine_load": punch_down_time + punch_up_time,
   }

# MAIN
def main():
   global running
   global graceful_stop_requested
   global emergency_stop_requested
   global pwm
   pwm = PWM_NOMINAL
   if pwm != 0 and pwm < PWM_MIN_ON:
       raise RuntimeError(
           f"PWM_NOMINAL invalid. Must be 0 or >= {PWM_MIN_ON}."
       )
   client = mqtt.Client(client_id="revpi-cycle-worker")
   client.on_connect = on_connect
   client.on_message = on_message
   client.connect(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE)
   client.loop_start()
   rpi = revpimodio2.RevPiModIO(autorefresh=True)
   cycle_id = 0
   print("=== RevPi cycle worker started ===")
   print("Publishing to:", TOPIC_CYCLE_FEATURES)
   print("Snapshot topic:", TOPIC_IO_SNAPSHOT)
   print("Listening to:", TOPIC_WORKER_CONTROL)
   print("PWM:", pwm)
   try:
       while running:
           publish_snapshot(client, rpi)
           features = run_one_cycle(rpi, client)
           if features is None:
               print("Emergency stop during cycle.")
               break
           cycle_id += 1
           payload = {
               "timestamp": datetime.now().isoformat(),
               "cycle_id": cycle_id,
               "source": "revpi",
               "features": features,
               "io": read_inputs(rpi),
               "pwms": read_pwms(rpi),
           }
           client.publish(
               TOPIC_CYCLE_FEATURES,
               json.dumps(payload),
               qos=0,
               retain=False,
           )
           print(f"[OK] Published cycle {cycle_id}")
           if graceful_stop_requested:
               print("Graceful stop after cycle completion.")
               break
           if emergency_stop_requested:
               print("Emergency stop triggered.")
               break
   except Exception as e:
       print("ERROR:", e)
   finally:
       safe_stop(rpi)
       rpi.cleanup()
       client.loop_stop()
       client.disconnect()
       print("Worker exited safely")

if __name__ == "__main__":
   main()