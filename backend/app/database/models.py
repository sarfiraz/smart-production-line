from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)


class StopEvent(Base):
    __tablename__ = "stop_events"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False)
    command = Column(String, nullable=False)
    reason = Column(String, nullable=False)
    notes = Column(String, nullable=True)
    machine_state = Column(String, nullable=True)
    cycle_id = Column(Integer, nullable=True)
    global_cycle_id = Column(Integer, nullable=True)


class SystemEvent(Base):
    __tablename__ = "system_events"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    source = Column(String, nullable=False)
    description = Column(String, nullable=False)
    severity = Column(String, nullable=False, default="info")



