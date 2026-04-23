import logging

from sqlalchemy import text

from app.database.database import SessionLocal

logger = logging.getLogger(__name__)


def reset_analytics_sql():
    """Delete all analytics SQL rows for development reset."""
    db = SessionLocal()
    deleted = {"system_events": 0, "incidents": 0, "state_transitions": 0}
    try:
        tables = set()
        rows = db.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        for row in rows:
            if row and row[0]:
                tables.add(str(row[0]))

        for table_name in ("system_events", "incidents", "state_transitions"):
            if table_name not in tables:
                continue
            result = db.execute(text(f"DELETE FROM {table_name}"))
            deleted[table_name] = int(result.rowcount or 0)

        db.commit()
        logger.info("Analytics SQL reset complete: %s", deleted)
        return {"deleted": deleted}
    except Exception as e:
        db.rollback()
        logger.error("Analytics SQL reset failed: %s", e)
        raise
    finally:
        db.close()
