from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
from sqlalchemy.orm import Session

from app.auth.security import get_current_user
from app.database.database import get_db
from app.database.models import User
from app.models.assistant_message import AssistantMessage
from app.services.assistant_engine import (
    generate_assistant_response,
)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class AssistantRequest(BaseModel):
    question: str
    snapshot: Optional[Dict[str, Any]] = None  # Optional decision snapshot for context


class AssistantResponse(BaseModel):
    interpretation: Dict[str, Any]
    timestamp: str
    cycle_id: Optional[int] = None
    global_cycle_id: Optional[int] = None


class AssistantHistoryItem(BaseModel):
    id: int
    timestamp: str
    role: str
    content: str
    cycle_id: Optional[int] = None
    global_cycle_id: Optional[int] = None


def _extract_cycle_id(snapshot: Optional[Dict[str, Any]]) -> Optional[int]:
    if not snapshot or not isinstance(snapshot, dict):
        return None
    value = snapshot.get("cycle_id")
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_global_cycle_id(snapshot: Optional[Dict[str, Any]]) -> Optional[int]:
    if not snapshot or not isinstance(snapshot, dict):
        return None
    value = snapshot.get("global_cycle_id")
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_anomaly_score(snapshot: Optional[Dict[str, Any]]) -> Optional[float]:
    if not snapshot or not isinstance(snapshot, dict):
        return None
    direct = snapshot.get("anomaly_score")
    nested = None
    ml_result = snapshot.get("ml_result")
    if isinstance(ml_result, dict):
        nested = ml_result.get("anomaly_score")
    value = direct if direct is not None else nested
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _requires_cycle_data(question: str) -> bool:
    q = (question or "").lower()
    keywords = ("anomaly", "score", "warning", "critical", "incident")
    return any(keyword in q for keyword in keywords)


def _format_assistant_content(interpretation: Dict[str, Any]) -> str:
    summary = (interpretation.get("authoritative_summary") or "").strip()
    cause = (interpretation.get("technical_explanation") or "").strip()
    actions = interpretation.get("recommended_operator_actions") or []
    if not isinstance(actions, list):
        actions = []
    action_lines = [f"- {str(item).strip()}" for item in actions if str(item).strip()]

    lines = [
        "SUMMARY",
        summary or "No summary provided.",
        "",
        "TECHNICAL CAUSE",
        cause or "No technical explanation provided.",
        "",
        "RECOMMENDED ACTIONS",
    ]
    if action_lines:
        lines.extend(action_lines)
    else:
        lines.append("- No actions provided.")
    return "\n".join(lines)


def _save_assistant_message(
    db: Session,
    role: str,
    content: str,
    cycle_id: Optional[int],
    global_cycle_id: Optional[int],
) -> None:
    msg = AssistantMessage(
        timestamp=datetime.utcnow(),
        role=role,
        content=content,
        cycle_id=cycle_id,
        global_cycle_id=global_cycle_id,
    )
    db.add(msg)
    db.commit()


@router.post("/ask", response_model=AssistantResponse)
async def ask_assistant(
    request: AssistantRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Ask the operator assistant a question.
    The assistant uses ChatGPT to provide interpretations based on the current system state.
    This endpoint is interpretation-only and has NO control authority.
    
    Assistant router responsibilities:
    - validate request/snapshot
    - store chat history
    - call assistant_engine
    - return normalized response
    """
    cycle_id = _extract_cycle_id(request.snapshot)
    global_cycle_id = _extract_global_cycle_id(request.snapshot)
    if global_cycle_id is None:
        global_cycle_id = cycle_id
    anomaly_score = _extract_anomaly_score(request.snapshot)
    _save_assistant_message(db, "operator", request.question.strip(), cycle_id, global_cycle_id)

    # Only anomaly/incident-style questions require cycle/anomaly data.
    if _requires_cycle_data(request.question) and (
        request.snapshot is None or cycle_id is None or anomaly_score is None
    ):
        interpretation = {
            "authoritative_summary": "The machine has not completed a production cycle yet.",
            "technical_explanation": "ML anomaly detection requires at least one recorded production cycle.",
            "recommended_operator_actions": [
                "Run one production cycle.",
                "Ask the assistant again after cycle data is available."
            ],
        }
        _save_assistant_message(db, "assistant", _format_assistant_content(interpretation), cycle_id, global_cycle_id)
        return AssistantResponse(
            interpretation=interpretation,
            timestamp=datetime.now().isoformat(),
            cycle_id=cycle_id,
            global_cycle_id=global_cycle_id,
        )

    interpretation = generate_assistant_response(
        request.question,
        request.snapshot,
    )
    _save_assistant_message(db, "assistant", _format_assistant_content(interpretation), cycle_id, global_cycle_id)
    return AssistantResponse(
        interpretation=interpretation,
        timestamp=datetime.now().isoformat(),
        cycle_id=cycle_id,
        global_cycle_id=global_cycle_id,
    )


@router.get("/history", response_model=List[AssistantHistoryItem])
def get_assistant_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(AssistantMessage).order_by(AssistantMessage.timestamp.asc(), AssistantMessage.id.asc()).all()
    return [
        AssistantHistoryItem(
            id=row.id,
            timestamp=row.timestamp.isoformat() if row.timestamp else datetime.utcnow().isoformat(),
            role=row.role,
            content=row.content,
            cycle_id=row.cycle_id,
            global_cycle_id=row.global_cycle_id,
        )
        for row in rows
    ]


@router.delete("/history")
def clear_assistant_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deleted = db.query(AssistantMessage).delete(synchronize_session=False)
    db.commit()
    return {"status": "ok", "deleted": int(deleted or 0)}

