# Smart Production Line — Fault Detection System

Master's thesis project. Full-stack IIoT monitoring platform for a fischertechnik
Punching Machine with real-time MQTT communication, ML-based cycle anomaly detection,
and a ChatGPT-powered fault interpretation assistant.

**Author:** Bc. Mohibullah Sarfiraz  
**Institution:** FEI STU Bratislava, Institute of Automotive Mechatronics  
**Year:** 2026

---

## System Overview

The system has two sides that communicate over MQTT:

- **RevPi Runtime** (`sarfiraz_revpi_runtime/`) — runs directly on the Revolution Pi PLC
  attached to the machine. Reads sensors and actuators, executes production cycles,
  and publishes cycle timing data over MQTT.
- **PC Side** (`backend/`, `frontend/`) — runs on a connected PC via Docker Compose.
  Processes cycle data through an ML anomaly detection pipeline, generates ChatGPT
  fault interpretations, and serves the live monitoring dashboard.

Communication between the two sides goes through an EMQX MQTT broker that runs
as part of the Docker stack on the PC.

---

## Hardware You Need

Before starting, make sure you have all of this:

- fischertechnik Punching Machine with Conveyor Belt (model 96785)
- Revolution Pi Core 3+ PLC
- Revolution Pi DIO expansion module
- Siemens SIMATIC PM1207 24V power supply
- A PC running Windows or Linux with Docker installed
- A WiFi adapter on the PC (to create a hotspot) or a router connecting both devices

---

## Hardware Setup

### 1. Power supply

Connect the Siemens SIMATIC PM1207 power supply to 230V mains. The output is 24V DC.
Connect the 24V DC output to the fischertechnik machine's power input terminals.
Connect the same 24V DC to the Revolution Pi DIO module power input.

### 2. Wiring the machine to the RevPi DIO

Connect the four sensors and four motor outputs between the machine and the DIO module
according to this mapping:

| DIO Pin | Machine Connection        | Signal type |
|---------|---------------------------|-------------|
| I_1     | Entry phototransistor     | Digital input |
| I_2     | Punch station phototransistor | Digital input |
| I_3     | Punch upper limit switch  | Digital input |
| I_4     | Punch lower limit switch  | Digital input |
| PWM_1   | Belt motor forward        | PWM output |
| PWM_2   | Belt motor reverse        | PWM output |
| PWM_3   | Punch motor up            | PWM output |
| PWM_4   | Punch motor down          | PWM output |

### 3. Network connection

The RevPi and the PC must be on the same network so they can reach the MQTT broker.
The simplest setup is a Windows WiFi hotspot on the PC:

- On your PC: Settings → Mobile hotspot → turn it on
- Connect the RevPi to this hotspot via its Ethernet port through a router,
  or via WiFi if you have a WiFi dongle on the RevPi
- The PC's hotspot IP is typically `192.168.137.1` — this is the address
  the RevPi will use to reach the MQTT broker

### 4. PiCtory configuration on the RevPi

PiCtory is the web tool on the RevPi that defines the IO layout. Open it at
`http://<REVPI_IP>` in your browser while connected to the same network.
Add the DIO module to the configuration and assign it the IO names exactly as
listed in the wiring table above (I_1, I_2, I_3, I_4, PWM_1, PWM_2, PWM_3, PWM_4).
Save and apply the configuration. The RevPi runtime will not start correctly
without a valid PiCtory configuration.

---

## PC Side Setup

### Prerequisites

- Docker Desktop (Windows) or Docker + Docker Compose (Linux) installed
- An OpenAI API key — get one at https://platform.openai.com/api-keys
- Git installed

### Step 1 — Clone the repository
- git clone https://github.com/YOUR_USERNAME/smart-production-line.git
- cd smart-production-line
### Step 2 — Create your environment file
- cp docker/.env.example docker/.env
- Open `docker/.env` in any text editor and fill in your values:
   - SECRET_KEY=pick-any-long-random-string-here
   - INFLUXDB_TOKEN=pick-any-long-random-string-here
   - INFLUXDB_PASSWORD=pick-any-password-here
   - OPENAI_API_KEY=your-openai-api-key-here
Leave everything else in the file exactly as it is. The values you pick for
`SECRET_KEY`, `INFLUXDB_TOKEN`, and `INFLUXDB_PASSWORD` do not need to match
anything external — just choose something and be consistent.

### Step 3 — Start the full stack
- cd docker
- docker compose up -d
This starts five containers: the FastAPI backend, the React frontend, InfluxDB,
EMQX MQTT broker, and SQLite. Wait about 30 seconds for everything to initialise.

### Step 4 — Open the dashboard

Go to **http://localhost:3000** in your browser.

You will see a login page. Click Register and create an account.

---

## RevPi Side Setup

This runs directly on the Revolution Pi — not in Docker. Do this after the PC
side is already running.

### Prerequisites on the RevPi

SSH into the RevPi:
- ssh pi@<REVPI_IP>
- Install the required Python libraries: pip3 install paho-mqtt revpimodio2

### Step 1 — Copy the runtime files to the RevPi

From your PC, inside the cloned repository folder, run: 
- scp -r sarfiraz_revpi_runtime/ pi@<REVPI_IP>:/home/pi/sarfiraz_revpi_runtime

Replace `<REVPI_IP>` with the actual IP address of your RevPi on the network.

### Step 2 — Set the MQTT broker address

On the RevPi, open the config file: nano /home/pi/sarfiraz_revpi_runtime/config.py
Find this line:
```python
MQTT_HOST = "192.168.137.1"
```

Change the IP address to match your PC's IP on the shared network.
If you are using a Windows hotspot this is `192.168.137.1` and you do not
need to change anything. If you are using a router, check your PC's IP address
on that network and put it here.

Save and exit (`Ctrl+X`, then `Y`, then `Enter`).

### Step 3 — Install the systemd service

The systemd service makes the supervisor start automatically every time the
RevPi powers on.

Create the service file:
 - sudo nano /etc/systemd/system/sarfiraz-revpi-production-supervisor.service
 Paste this content:
 ```[Unit]
Description=Sarfiraz RevPi Production Supervisor
After=network.target
StartLimitIntervalSec=0
[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/sarfiraz_revpi_runtime
ExecStart=/usr/bin/python3 /home/pi/sarfiraz_revpi_runtime/revpi_supervisor.py
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target```

Save and exit.

### Step 4 — Enable and start the service
   sudo systemctl daemon-reload
   sudo systemctl enable sarfiraz-revpi-production-supervisor.service
   sudo systemctl start sarfiraz-revpi-production-supervisor.service
### Step 5 — Verify it is running
   sudo systemctl status sarfiraz-revpi-production-supervisor.service

You should see `Active: active (running)`. To watch live logs:
   journalctl -u sarfiraz-revpi-production-supervisor.service -f
   You should see output like:
      Valid PiCtory configuration detected.
      STATE → IDLE
      Supervisor MQTT connected.
If you see `Waiting for valid PiCtory IO configuration...` repeating, the
PiCtory configuration on the RevPi is not set up correctly — go back to the
hardware setup section.

---

## Verifying the Full System

Once both sides are running, do this to confirm everything is connected:

1. Open the dashboard at http://localhost:5173 and log in
2. Go to the **Status** page — all services should show as healthy
3. Go to the **Dashboard** page — the machine diagram should show the current
   sensor states updating in real time
4. Go to the **Controls** page (admin account required) and click **Start Production**
5. The machine should begin running cycles. After each cycle you will see:
   - The Dashboard updating with new cycle data
   - The ML anomaly score appearing
   - After a fault is detected, a ChatGPT interpretation appearing on the
     AI Interpretations page

---

## Simulating a Fault

To test the fault detection without physically damaging the machine:

1. While the machine is running, block one of the phototransistors (I_1 or I_2)
   with your finger or a piece of tape
2. The machine will detect a sensor timeout and trigger an emergency stop
3. The dashboard will show EMERGENCY STOP state
4. A ChatGPT interpretation will appear explaining the fault and recommending
   operator actions
5. To recover: remove the obstruction and click **Reset System** on the Controls page

---

## Running the Validation Tests

With the PC side running, from the repository root:
   cd backend
   pip install httpx
   python -m pytest tests/test_assistant_validation.py -v
---

## Documentation

| File | Contents |
|------|----------|
| `docs/mqtt_contract.md` | All MQTT topics, payload formats, and QoS levels |
| `docs/control_and_safety_policy.md` | Machine safety rules and control logic |
| `docs/punching_machine_full_technical_docs.md` | Hardware wiring and sensor documentation |
| `docs/testing_protocol.md` | Testing methodology and test cases |

---

## Repository Structure
smart-production-line/
├── sarfiraz_revpi_runtime/   Revolution Pi runtime (supervisor, worker, config)
├── backend/                  FastAPI backend — ML pipeline, ChatGPT service, API
├── frontend/                 React monitoring dashboard
├── training/                 ML model training data and notebooks
├── docker/                   Docker Compose stack and environment template
├── docs/                     System documentation
└── README.md