from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import os

# Database path - stored in A:/dip_docker_vols/backend_data
DB_DIR = os.getenv("DB_DIR", "/app/data")
os.makedirs(DB_DIR, exist_ok=True)
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_DIR}/users.sqlite3"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Dependency to get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database tables."""
    from app.database.models import Base
    from app.models.assistant_message import AssistantMessage  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _ensure_optional_columns()


def _ensure_optional_columns():
    """Apply lightweight SQLite migrations for newly added nullable columns."""
    migrations = (
        ("stop_events", "global_cycle_id", "INTEGER"),
        ("assistant_messages", "global_cycle_id", "INTEGER"),
    )
    with engine.begin() as conn:
        for table_name, column_name, column_type in migrations:
            table_exists = conn.execute(
                text(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=:table_name LIMIT 1"
                ),
                {"table_name": table_name},
            ).fetchone()
            if not table_exists:
                continue
            rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            columns = {str(row[1]) for row in rows if len(row) > 1}
            if column_name in columns:
                continue
            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))



