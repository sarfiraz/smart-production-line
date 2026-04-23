from datetime import datetime, timedelta
import logging

from app.database.database import SessionLocal
from app.database.models import SystemEvent

logger = logging.getLogger(__name__)


def delete_old_events() -> int:
    """Delete system events older than 30 days."""
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(days=30)
        deleted = (
            db.query(SystemEvent)
            .filter(SystemEvent.timestamp < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        logger.info(f"System event cleanup removed {deleted} records older than 30 days")
        return int(deleted or 0)
    except Exception as e:
        db.rollback()
        logger.error(f"System event cleanup failed: {e}")
        return 0
    finally:
        db.close()

