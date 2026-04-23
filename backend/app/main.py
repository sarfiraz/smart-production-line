from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import logging
import asyncio
import time
import os
from datetime import datetime
from typing import List
from app.database.database import init_db
from app.auth.auth_router import router as auth_router
from app.routers.monitoring import router as monitoring_router
from app.routers.control import router as control_router
from app.routers.predictions import router as predictions_router
from app.routers.users import router as users_router
from app.routers.assistant import router as assistant_router
from app.routers.history import router as history_router, dev_router
from app.config import (
    TOPIC_MACHINE_STATE,
    TOPIC_MACHINE_SPEED,
    TOPIC_SUPERVISOR_STATUS,
)
from app.influx.influx_client import get_latest_sensor_data
from app.mqtt.client import get_mqtt_client
from app.services.event_cleanup import delete_old_events

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Industrial IoT Monitoring & Control API",
    description="API for monitoring and controlling industrial production line",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients."""
        disconnected = []
        # Create a copy of the list to avoid modification during iteration
        connections = list(self.active_connections)
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                # Connection is likely closed, remove it silently
                # Don't log as error - this is normal when clients disconnect
                disconnected.append(connection)
        
        # Remove disconnected connections
        for connection in disconnected:
            if connection in self.active_connections:
                self.disconnect(connection)


manager = ConnectionManager()

# Store event loop for MQTT callback
_event_loop = None
_supervisor_monitor_task = None


# MQTT message callback for WebSocket broadcasting
def build_mqtt_ws_message(topic: str, data: dict) -> dict:
    return {
        "topic": topic,
        "data": data,
        "type": "sensor_data"
    }


async def mqtt_message_broadcast(topic: str, data: dict):
    """Callback function for MQTT messages to broadcast via WebSocket."""
    message = build_mqtt_ws_message(topic, data)
    await manager.broadcast(message)


async def supervisor_heartbeat_monitor():
    """Broadcast supervisor online/offline status derived from heartbeat freshness."""
    while True:
        try:
            mqtt_client = get_mqtt_client()
            last_hb = mqtt_client.last_supervisor_heartbeat
            now = time.time()
            online = bool(last_hb is not None and (now - last_hb) <= 5.0)
            payload = {
                "timestamp": datetime.utcnow().isoformat(),
                "online": online,
            }
            await mqtt_message_broadcast(TOPIC_SUPERVISOR_STATUS, payload)
        except Exception as e:
            logger.error(f"Supervisor heartbeat monitor error: {e}")
        await asyncio.sleep(2)


# Initialize database
@app.on_event("startup")
async def startup_event():
    """Initialize database and MQTT client on startup."""
    global _event_loop, _supervisor_monitor_task

    print("MODEL:", os.getenv("MODEL"))
    print("GITHUB_TOKEN loaded:", bool(os.getenv("GITHUB_TOKEN")))

    init_db()
    logger.info("Database initialized")
    delete_old_events()
    
    # Store the event loop for MQTT callback
    _event_loop = asyncio.get_running_loop()
    
    # Initialize MQTT client with callback
    try:
        # Create a wrapper function that can be called from MQTT thread
        def mqtt_callback(topic: str, data: dict):
            """MQTT callback that schedules WebSocket broadcast."""
            global _event_loop
            try:
                if _event_loop is not None:
                    # Schedule the coroutine to run in the event loop
                    asyncio.run_coroutine_threadsafe(mqtt_message_broadcast(topic, data), _event_loop)
                else:
                    logger.warning("No event loop available for MQTT callback")
            except Exception as e:
                logger.error(f"Error in MQTT callback: {e}")
        
        # Set up MQTT client with callback using the get_mqtt_client function
        mqtt_client = get_mqtt_client(on_message_callback=mqtt_callback)
        logger.info("MQTT client initialized")
    except Exception as e:
        logger.error(f"Error initializing MQTT client: {e}")

    if _supervisor_monitor_task is None or _supervisor_monitor_task.done():
        _supervisor_monitor_task = asyncio.create_task(supervisor_heartbeat_monitor())

    # Start ML and ChatGPT services in background threads
    from app.services.service_runner import start_ml_service, start_chatgpt_service
    start_ml_service()
    start_chatgpt_service()
    logger.info("All background services started")

# Include routers
app.include_router(auth_router)
app.include_router(monitoring_router)
app.include_router(control_router)
app.include_router(predictions_router)
app.include_router(users_router)
app.include_router(assistant_router)
app.include_router(history_router)
app.include_router(dev_router)


@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for live sensor data."""
    try:
        await manager.connect(websocket)

        # Replay cached machine state to newly connected client (if available)
        mqtt_client = get_mqtt_client()
        if mqtt_client is not None and mqtt_client.last_machine_state is not None:
            await websocket.send_json(build_mqtt_ws_message(TOPIC_MACHINE_STATE, mqtt_client.last_machine_state))
        if mqtt_client is not None and mqtt_client.last_machine_speed is not None:
            await websocket.send_json(build_mqtt_ws_message(TOPIC_MACHINE_SPEED, mqtt_client.last_machine_speed))

        # Send initial latest data
        latest_data = get_latest_sensor_data()
        await websocket.send_json({
            "type": "initial_data",
            "data": latest_data
        })
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for any message from client (ping/pong)
                data = await websocket.receive_text()
                # Echo back or handle client messages
                await websocket.send_json({"type": "pong", "message": "alive"})
            except WebSocketDisconnect:
                manager.disconnect(websocket)
                break
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)


@app.get("/")
def root():
    """Root endpoint."""
    return {
        "message": "Industrial IoT Monitoring & Control API",
        "docs": "/docs",
        "version": "1.0.0"
    }


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}

