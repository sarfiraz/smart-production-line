#!/usr/bin/env python3
import json
import time
import subprocess
from datetime import datetime
import paho.mqtt.client as mqtt
import revpimodio2
import config
from config import (
   MQTT_HOST,
   MQTT_PORT,
   MQTT_KEEPALIVE,
   TOPIC_COMMAND,
   TOPIC_STATE,
   TOPIC_SUPERVISOR_HEARTBEAT,
   TOPIC_SPEED_STATUS,
   TOPIC_WORKER_CONTROL,
   TIMEOUT_BELT_BACK_TO_I1,
   TIMEOUT_PUNCH_UP_TO_I3,
   SLEEP_BELT,
   SLEEP_PUNCH,
)
WORKER_PATH = "/home/pi/sarfiraz_revpi_runtime/cycle_worker.py"
 
# STATES
 
STATE_BOOTING = "BOOTING"
STATE_IDLE = "IDLE"
STATE_PRODUCING = "PRODUCING"
STATE_STOPPING = "STOPPING"
STATE_STOPPED = "STOPPED"
STATE_EMERGENCY = "EMERGENCY_STOP"
current_state = STATE_BOOTING
worker_process = None
waiting_for_worker_exit = False
rpi = None

 
# STATE PUBLISHING
 
def publish_state(client):
   payload = {
       "timestamp": datetime.now().isoformat(),
       "state": current_state
   }
   client.publish(TOPIC_STATE, json.dumps(payload), qos=0, retain=True)

def publish_speed(client):
   payload = {
       "timestamp": datetime.now().isoformat(),
       "pwm": config.PWM_NOMINAL
   }
   client.publish(
       TOPIC_SPEED_STATUS,
       json.dumps(payload),
       qos=0,
       retain=True
   )

 
# IO HELPERS
 
def refresh_inputs():
   rpi.readprocimg()

def is_machine_in_idle_position():
   refresh_inputs()
   return (rpi.io.I_1.value == 0) and (rpi.io.I_3.value == 1)

def wait_until(cond_fn, timeout_s, sleep_s):
   t0 = time.time()
   while not cond_fn():
       if time.time() - t0 > timeout_s:
           return False
       time.sleep(sleep_s)
       refresh_inputs()
   return True

def perform_homing():
   print("Starting homing procedure...")
   refresh_inputs()
   # Punch up
   if rpi.io.I_3.value != 1:
       print("Homing: Moving punch up...")
       rpi.io.PWM_3.value = config.PWM_NOMINAL
       rpi.writeprocimg()
       wait_until(
           lambda: rpi.io.I_3.value == 1,
           TIMEOUT_PUNCH_UP_TO_I3,
           SLEEP_PUNCH
       )
       rpi.io.PWM_3.value = 0
       rpi.writeprocimg()
   refresh_inputs()
   # Belt back
   if rpi.io.I_1.value != 0:
       print("Homing: Moving belt to I1...")
       rpi.io.PWM_2.value = config.PWM_NOMINAL
       rpi.writeprocimg()
       wait_until(
           lambda: rpi.io.I_1.value == 0,
           TIMEOUT_BELT_BACK_TO_I1,
           SLEEP_BELT
       )
       rpi.io.PWM_2.value = 0
       rpi.writeprocimg()
   print("Homing complete.")

 
# MQTT CALLBACKS
 
def on_connect(client, userdata, flags, rc):
   global current_state
   if rc == 0:
       print("Supervisor MQTT connected.")
       client.subscribe(TOPIC_COMMAND)
       publish_state(client)
       publish_speed(client)
   else:
       print("Supervisor MQTT connection failed:", rc)

def on_message(client, userdata, msg):
   global current_state
   global worker_process
   global waiting_for_worker_exit
   try:
       payload = json.loads(msg.payload.decode())
       command = payload.get("command")
       print("Command received:", command)
        
       # START PRODUCTION
        
       if command == "START_PRODUCTION":
           if current_state in [STATE_IDLE, STATE_STOPPED]:
               if not is_machine_in_idle_position():
                   print("START rejected: Machine not in idle position.")
                   return
               print(f"Launching worker with PWM {config.PWM_NOMINAL}")
               worker_process = subprocess.Popen(
                   ["python3", WORKER_PATH]
               )
               # send speed to worker immediately
               time.sleep(0.5)
               client.publish(
                   TOPIC_WORKER_CONTROL,
                   json.dumps({
                       "command": "SET_SPEED",
                       "value": config.PWM_NOMINAL
                   }),
                   qos=0
               )
               current_state = STATE_PRODUCING
               publish_state(client)
        
       # STOP PRODUCTION
        
       elif command == "STOP_PRODUCTION":
           if current_state == STATE_PRODUCING:
               print("Sending GRACEFUL_STOP...")
               client.publish(
                   TOPIC_WORKER_CONTROL,
                   json.dumps({"command": "GRACEFUL_STOP"}),
                   qos=0
               )
               current_state = STATE_STOPPING
               waiting_for_worker_exit = True
               publish_state(client)
        
       # EMERGENCY STOP
        
       elif command == "EMERGENCY_STOP":
           print("Sending EMERGENCY_STOP...")
           client.publish(
               TOPIC_WORKER_CONTROL,
               json.dumps({"command": "EMERGENCY_STOP"}),
               qos=0
           )
           current_state = STATE_EMERGENCY
           publish_state(client)
        
       # RESET SYSTEM
        
       elif command == "RESET_SYSTEM":
           if current_state in [STATE_IDLE, STATE_STOPPED, STATE_EMERGENCY]:
               perform_homing()
               if is_machine_in_idle_position():
                   current_state = STATE_IDLE
                   publish_state(client)
        
       # SET SPEED
        
       elif command == "SET_SPEED":
           new_speed = payload.get("value")
           if not isinstance(new_speed, int):
               print("Invalid speed payload")
               return
           if new_speed < config.PWM_MIN_ON or new_speed > 100:
               print("Speed out of range")
               return
           if current_state == STATE_EMERGENCY:
               print("Speed change rejected during emergency stop")
               return
           config.PWM_NOMINAL = new_speed
           print(f"Machine speed updated → PWM_NOMINAL = {new_speed}")
           publish_speed(client)
           # forward to worker if running
           if worker_process is not None:
               client.publish(
                   TOPIC_WORKER_CONTROL,
                   json.dumps({
                       "command": "SET_SPEED",
                       "value": new_speed
                   }),
                   qos=0
               )
   except Exception as e:
       print("Supervisor MQTT error:", e)

 
# WAIT FOR PICTORY
 
def wait_for_io():
   global rpi
   while True:
       try:
           temp_rpi = revpimodio2.RevPiModIO(autorefresh=False)
           temp_rpi.readprocimg()
           _ = temp_rpi.io.I_1.value
           _ = temp_rpi.io.I_3.value
           _ = temp_rpi.io.PWM_1.value
           rpi = temp_rpi
           print("Valid PiCtory configuration detected.")
           return
       except Exception:
           print("Waiting for valid PiCtory IO configuration...")
           time.sleep(2)

 
# MAIN
 
def main():
   global current_state
   global worker_process
   global waiting_for_worker_exit
   global rpi
   print("Starting supervisor...")
   current_state = STATE_BOOTING
   client = mqtt.Client("revpi-supervisor")
   client.on_connect = on_connect
   client.on_message = on_message
   client.connect(MQTT_HOST, MQTT_PORT, MQTT_KEEPALIVE)
   client.loop_start()
   print("STATE → BOOTING")
   wait_for_io()
   current_state = STATE_IDLE
   publish_state(client)
   print("STATE → IDLE")
   last_heartbeat = 0
   while True:
       now = time.time()
       if now - last_heartbeat >= 2:
           client.publish(
               TOPIC_SUPERVISOR_HEARTBEAT,
               json.dumps({
                   "timestamp": datetime.now().isoformat()
               }),
               qos=0,
               retain=False
           )
           last_heartbeat = now
       if waiting_for_worker_exit and worker_process is not None:
           if worker_process.poll() is not None:
               print("Worker exited gracefully.")
               current_state = STATE_STOPPED
               publish_state(client)
               waiting_for_worker_exit = False
               worker_process = None
       time.sleep(0.5)

if __name__ == "__main__":
   main()