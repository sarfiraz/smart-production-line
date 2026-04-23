from sqlalchemy import Column, Integer, String, DateTime, Text

from app.database.models import Base


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    role = Column(String, nullable=False)  # "operator" | "assistant"
    content = Column(Text, nullable=False)
    cycle_id = Column(Integer, nullable=True, index=True)
    global_cycle_id = Column(Integer, nullable=True, index=True)
