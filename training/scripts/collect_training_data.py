import revpimodio2
import time
import csv
from datetime import datetime
from collections import deque

TARGET_CYCLES = 1000
CSV_FILE = "cycle_data.csv"

last_10_cycles = deque(maxlen=10)

# ---------------- CSV SETUP ----------------
with open(CSV_FILE, "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow([
        "timestamp",
        "cycle_id",
        "cycle_duration",
        "belt_move_time",
        "punch_down_time",
        "punch_up_time",
        "belt_forward_duration",
        "belt_reverse_duration",
        "punch_motor_down_duration",
        "punch_motor_up_duration",
        "cpu_temp_avg",
        "punch_speed",
        "belt_efficiency",
        "machine_load",
        "cycle_variance_10",
        "cycle_trend_10"
    ])

rpi = revpimodio2.RevPiModIO(autorefresh=True)

def safe_stop():
    rpi.io.PWM_1.value = 0
    rpi.io.PWM_2.value = 0
    rpi.io.PWM_3.value = 0
    rpi.io.PWM_4.value = 0

try:
    print("=== DATA COLLECTION MODE ===")
    print("Place object at I1 before starting.")
    time.sleep(2)

    if rpi.io.I_1.value != 0:
        raise RuntimeError("Object NOT at I1. Fix position and restart.")

    for cycle_id in range(1, TARGET_CYCLES + 1):

        cycle_start = time.time()
        cpu_samples = []

        # -------- BELT FORWARD --------
        t0 = time.time()
        rpi.io.PWM_1.value = 80
        while rpi.io.I_2.value != 0:
            cpu_samples.append(rpi.io.Core_Temperature.value)
            time.sleep(0.01)
        rpi.io.PWM_1.value = 0
        belt_move_time = time.time() - t0
        belt_forward_duration = belt_move_time

        # -------- PUNCH DOWN --------
        t1 = time.time()
        rpi.io.PWM_4.value = 80
        while rpi.io.I_4.value != 1:
            cpu_samples.append(rpi.io.Core_Temperature.value)
            time.sleep(0.005)
        rpi.io.PWM_4.value = 0
        punch_down_time = time.time() - t1
        punch_motor_down_duration = punch_down_time

        # -------- PUNCH UP --------
        t2 = time.time()
        rpi.io.PWM_3.value = 80
        while rpi.io.I_3.value != 1:
            cpu_samples.append(rpi.io.Core_Temperature.value)
            time.sleep(0.005)
        rpi.io.PWM_3.value = 0
        punch_up_time = time.time() - t2
        punch_motor_up_duration = punch_up_time

        # -------- BELT REVERSE --------
        t3 = time.time()
        rpi.io.PWM_2.value = 80
        while rpi.io.I_1.value != 0:
            cpu_samples.append(rpi.io.Core_Temperature.value)
            time.sleep(0.01)
        rpi.io.PWM_2.value = 0
        belt_reverse_duration = time.time() - t3

        # -------- END CYCLE --------
        cycle_duration = time.time() - cycle_start
        cpu_temp_avg = sum(cpu_samples) / len(cpu_samples)

        punch_speed = 1.0 / punch_down_time
        belt_efficiency = belt_move_time / cycle_duration
        machine_load = punch_down_time + punch_up_time

        last_10_cycles.append(cycle_duration)
        if len(last_10_cycles) > 1:
            mean = sum(last_10_cycles) / len(last_10_cycles)
            cycle_variance_10 = sum((x - mean) ** 2 for x in last_10_cycles)
            cycle_trend_10 = last_10_cycles[-1] - last_10_cycles[0]
        else:
            cycle_variance_10 = 0
            cycle_trend_10 = 0

        with open(CSV_FILE, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([
                datetime.now().isoformat(),
                cycle_id,
                cycle_duration,
                belt_move_time,
                punch_down_time,
                punch_up_time,
                belt_forward_duration,
                belt_reverse_duration,
                punch_motor_down_duration,
                punch_motor_up_duration,
                cpu_temp_avg,
                punch_speed,
                belt_efficiency,
                machine_load,
                cycle_variance_10,
                cycle_trend_10
            ])

        print(f"Cycle {cycle_id}/{TARGET_CYCLES} OK")

    print("=== DATA COLLECTION COMPLETE ===")

except KeyboardInterrupt:
    print("Interrupted by user.")

finally:
    safe_stop()
    rpi.cleanup()
    print("Machine stopped safely.")

