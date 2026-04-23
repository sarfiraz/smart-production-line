from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class UserBase(BaseModel):
    username: str
    email: EmailStr


class UserCreate(UserBase):
    password: str


class Login(BaseModel):
    username: str
    password: str


class UserResponse(UserBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str


class SensorData(BaseModel):
    sensor_id: str
    value: float
    timestamp: str
    unit: Optional[str] = None


class ControlCommand(BaseModel):
    command: str
    timestamp: Optional[str] = None


class StopReasonRequest(BaseModel):
    reason: str
    notes: Optional[str] = None
    timestamp: datetime
    command: str


class StopReasonResponse(BaseModel):
    status: str
    message: str


class SystemEventResponse(BaseModel):
    id: int
    timestamp: datetime
    event_type: str
    source: str
    description: str
    severity: str

    class Config:
        from_attributes = True

