from datetime import datetime
import logging

from app.database.database import SessionLocal
from app.database.models import SystemEvent

logger = logging.getLogger(__name__)


def log_system_event(
    event_type: str,
    description: str,
    source: str = "system",
    severity: str = "info",
    timestamp: datetime | None = None,
) -> None:
    """Persist a system event in SQL database."""
    db = SessionLocal()
    try:
        event = SystemEvent(
            timestamp=timestamp or datetime.utcnow(),
            event_type=str(event_type),
            source=str(source),
            description=str(description),
            severity=str(severity),
        )
        db.add(event)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to log system event '{event_type}': {e}")
    finally:
        db.close()

