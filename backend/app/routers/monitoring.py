from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from app.auth.security import get_current_user
from app.database.models import User
from app.influx.influx_client import get_latest_sensor_data, query_sensor_data

router = APIRouter(prefix="/api/sensors", tags=["monitoring"])


@router.get("/latest")
def get_latest_sensors(
    sensor_id: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get latest sensor data. Available for all authenticated users."""
    try:
        latest_data = get_latest_sensor_data(sensor_id)
        return {"sensors": latest_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
def get_sensor_history(
    sensor_id: Optional[str] = None,
    start_time: str = "-1h",
    limit: int = 100,
    current_user: User = Depends(get_current_user)
):
    """Get sensor history. Available for all authenticated users."""
    try:
        if sensor_id:
            history = query_sensor_data(sensor_id, start_time, limit)
            return {"sensor_id": sensor_id, "data": history}
        else:
            # Get all sensors' latest data if no sensor_id specified
            latest_data = get_latest_sensor_data()
            return {"sensors": latest_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



