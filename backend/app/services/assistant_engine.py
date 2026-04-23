import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import text

from app.database.database import SessionLocal

try:
    from app.influx.influx_client import (
        client as influx_client,
        INFLUXDB_ORG,
        INFLUXDB_BUCKET,
    )
    _INFLUX_OK = True
except ImportError:
    _INFLUX_OK = False

try:
    from openai import OpenAI
    _OPENAI_OK = True
except ImportError:
    OpenAI = None
    _OPENAI_OK = False

DOCS_DIR = Path(__file__).resolve().parents[2] / "docs"
DOC_TECH = DOCS_DIR / "punching_machine_full_technical_docs.md"
DOC_SAFETY = DOCS_DIR / "control_and_safety_policy.md"

_openai_client: Optional[OpenAI] = None
_system_prompt_cache: Optional[str] = None


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _trim_for_budget(text: str, token_budget: int) -> str:
    if _estimate_tokens(text) <= token_budget:
        return text
    max_chars = max(200, token_budget * 4)
    return text[:max_chars] + "\n...[truncated for token budget]..."


def _get_openai_client() -> Optional[OpenAI]:
    global _openai_client
    if _openai_client is not None:
        return _openai_client
    if not _OPENAI_OK:
        return None

    openai_api_key = os.getenv("OPENAI_API_KEY")
    github_token = os.getenv("GITHUB_TOKEN")
    if openai_api_key:
        api_key = openai_api_key
        base_url = None
    elif github_token:
        api_key = github_token
        base_url = "https://models.github.ai/inference"
    else:
        return None

    try:
        _openai_client = OpenAI(api_key=api_key, base_url=base_url)
        return _openai_client
    except Exception:
        return None


def _read_docs_best_effort() -> tuple[str, str]:
    tech = ""
    safety = ""
    tech_candidates = [
        DOC_TECH,
        Path(__file__).resolve().parents[3] / "docs" / "punching_machine_full_technical_docs.md",
    ]
    safety_candidates = [
        DOC_SAFETY,
        Path(__file__).resolve().parents[3] / "docs" / "control_and_safety_policy.md",
    ]

    for candidate in tech_candidates:
        try:
            if candidate.exists():
                tech = candidate.read_text(encoding="utf-8")
                break
        except Exception:
            pass
    for candidate in safety_candidates:
        try:
            if candidate.exists():
                safety = candidate.read_text(encoding="utf-8")
                break
        except Exception:
            pass
    return tech, safety


def _build_system_prompt(tech_doc: str, safety_doc: str) -> str:
    base = """
You are an industrial machine diagnostic assistant for a conveyor punching machine.
You are interpretation-only.

Rules:
- NEVER send or suggest control commands (start/stop/reset/override).
- NEVER recommend unsafe machine operations.
- NEVER hallucinate missing events; if evidence is missing, say it is unavailable.
- Use only provided runtime/analytics context.

Always respond as JSON with fields:
authoritative_summary, technical_explanation, recommended_operator_actions, confidence_level.
"""
    if tech_doc:
        base += "\nTECHNICAL DOC EXCERPT:\n" + _trim_for_budget(tech_doc, 500)
    if safety_doc:
        base += "\nSAFETY DOC EXCERPT:\n" + _trim_for_budget(safety_doc, 400)
    return _trim_for_budget(base.strip(), 1600)


def _get_system_prompt() -> str:
    global _system_prompt_cache
    tech_doc, safety_doc = _read_docs_best_effort()
    _system_prompt_cache = _build_system_prompt(tech_doc, safety_doc)
    return _system_prompt_cache


def _query_tables(query: str):
    if not _INFLUX_OK:
        return []
    return influx_client.query_api().query(org=INFLUXDB_ORG, query=query)


def _extract_records(tables) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table in tables:
        for record in table.records:
            rows.append(record.values or {})
    return rows


def _to_int(value) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _to_float(value) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _build_recent_system_context() -> str:
    context_obj = {
        "machine_state": "STOPPED",
        "decision_level": "NORMAL",
        "cycle_id": None,
        "global_cycle_id": None,
        "incident_history": {
            "recent_decisions": [],
            "recent_ml_results": [],
        },
    }

    db = SessionLocal()
    try:
        row = db.execute(
            text(
                """
                SELECT state
                FROM state_transitions
                ORDER BY timestamp DESC
                LIMIT 1
                """
            )
        ).fetchone()
        if row and row[0]:
            context_obj["machine_state"] = str(row[0]).upper()
    except Exception:
        pass
    finally:
        db.close()

    if _INFLUX_OK:
        try:
            decision_query = f'''
            from(bucket: "{INFLUXDB_BUCKET}")
            |> range(start: -24h)
            |> filter(fn: (r) => r["_measurement"] == "decision")
            |> filter(fn: (r) => r["_field"] == "cycle_id" or r["_field"] == "global_cycle_id" or r["_field"] == "decision_level")
            |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> keep(columns: ["_time", "cycle_id", "global_cycle_id", "decision_level"])
            |> sort(columns: ["_time"], desc: true)
            |> limit(n: 3)
            '''
            decisions = []
            for row in _extract_records(_query_tables(decision_query)):
                cid = _to_int(row.get("cycle_id"))
                gcid = _to_int(row.get("global_cycle_id"))
                if gcid is None:
                    gcid = cid
                decisions.append(
                    {
                        "cycle_id": cid,
                        "global_cycle_id": gcid,
                        "decision_level": str(row.get("decision_level", "NORMAL")).upper(),
                    }
                )
            if decisions:
                context_obj["incident_history"]["recent_decisions"] = decisions[:3]
                context_obj["decision_level"] = decisions[0].get("decision_level", "NORMAL")
                context_obj["cycle_id"] = decisions[0].get("cycle_id")
                context_obj["global_cycle_id"] = decisions[0].get("global_cycle_id")
        except Exception:
            pass

        try:
            ml_query = f'''
            from(bucket: "{INFLUXDB_BUCKET}")
            |> range(start: -24h)
            |> filter(fn: (r) => r["_measurement"] == "ml_behavior")
            |> filter(fn: (r) => r["_field"] == "anomaly_score" or r["_field"] == "cycle_id" or r["_field"] == "global_cycle_id")
            |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> keep(columns: ["_time", "cycle_id", "global_cycle_id", "anomaly_score", "status"])
            |> sort(columns: ["_time"], desc: true)
            |> limit(n: 3)
            '''
            ml = []
            for row in _extract_records(_query_tables(ml_query)):
                cid = _to_int(row.get("cycle_id"))
                gcid = _to_int(row.get("global_cycle_id"))
                if gcid is None:
                    gcid = cid
                ml.append(
                    {
                        "cycle_id": cid,
                        "global_cycle_id": gcid,
                        "status": str(row.get("status", "")).upper() or None,
                        "anomaly_score": _to_float(row.get("anomaly_score")),
                    }
                )
            if ml:
                context_obj["incident_history"]["recent_ml_results"] = ml[:3]
        except Exception:
            pass

    text_payload = "SYSTEM DIAGNOSTIC CONTEXT (JSON):\n" + json.dumps(
        context_obj, ensure_ascii=True, separators=(",", ":")
    )
    return _trim_for_budget(text_payload, 600)


def is_control_or_unsafe_question(question: str) -> bool:
    q = (question or "").strip().lower()

    patterns = (
        r"\bstart\b.*\b(machine|production|system)\b",
        r"\bstop\b.*\b(machine|production|system)\b",
        r"\breset\b",
        r"\bemergency stop\b",
        r"\boverride\b",
        r"\bdisable\b.*\bsafety\b",
        r"\bsend command\b",
        r"\bissue command\b",
    )

    return any(re.search(pattern, q) for pattern in patterns)


def is_meta_question(question: str) -> bool:
    q = (question or "").lower()

    keywords = [
        "what information are you missing",
        "what data do you not have",
        "what data sources are unavailable",
        "what data sources do you have",
        "what limitations",
        "how certain",
        "can you use external knowledge",
        "what sources",
        "what are you missing",
        "what information would help",
    ]

    return any(k in q for k in keywords)


def safety_refusal_interpretation() -> dict[str, Any]:
    return {
        "authoritative_summary": "I cannot issue or suggest control commands.",
        "technical_explanation": (
            "This assistant is interpretation-only and cannot start, stop, reset, or override machine safety logic."
        ),
        "recommended_operator_actions": [
            "Use authorized controls in the proper interface.",
            "Follow documented safety procedures before any operation.",
        ],
        "confidence_level": "HIGH",
    }


def generate_meta_response() -> dict[str, Any]:
    return {
        "authoritative_summary": "The assistant can only interpret available system and analytics data.",
        "technical_explanation": (
            "This assistant analyzes machine state, decision events, and anomaly metrics. "
            "However it does not have access to several external sources that could improve diagnostics."
        ),
        "recommended_operator_actions": [
            "Provide historical sensor trend data across many cycles.",
            "Include electrical measurements such as voltage and current.",
            "Provide maintenance and inspection records.",
            "Include environmental measurements like vibration or temperature.",
        ],
        "confidence_level": "HIGH",
    }


def _query_last_anomaly_scores(limit: int = 5) -> list[dict[str, Any]]:
    tables = _query_tables(
        f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -3650d)
        |> filter(fn: (r) => r["_measurement"] == "ml_behavior")
        |> filter(fn: (r) => r["_field"] == "anomaly_score" or r["_field"] == "cycle_id" or r["_field"] == "global_cycle_id")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> keep(columns: ["_time", "cycle_id", "global_cycle_id", "anomaly_score", "status"])
        |> sort(columns: ["_time"], desc: true)
        |> limit(n: {int(limit)})
        '''
    )
    out: list[dict[str, Any]] = []
    for row in _extract_records(tables):
        cid = _to_int(row.get("cycle_id"))
        gcid = _to_int(row.get("global_cycle_id"))
        if gcid is None:
            gcid = cid
        out.append(
            {
                "time": str(row.get("_time")),
                "cycle_id": cid,
                "global_cycle_id": gcid,
                "anomaly_score": _to_float(row.get("anomaly_score")),
                "status": row.get("status"),
            }
        )
    return out


def _query_cycle_details(cycle_ref: int) -> dict[str, Any] | None:
    tables = _query_tables(
        f'''
        from(bucket: "{INFLUXDB_BUCKET}")
        |> range(start: -3650d)
        |> filter(fn: (r) => r["_measurement"] == "ml_behavior")
        |> filter(fn: (r) => r["_field"] == "anomaly_score" or r["_field"] == "cycle_id" or r["_field"] == "global_cycle_id")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> keep(columns: ["_time", "cycle_id", "global_cycle_id", "anomaly_score", "status"])
        |> sort(columns: ["_time"], desc: true)
        '''
    )
    for row in _extract_records(tables):
        cid = _to_int(row.get("cycle_id"))
        gcid = _to_int(row.get("global_cycle_id"))
        if gcid is None:
            gcid = cid
        if gcid == cycle_ref or cid == cycle_ref:
            return {
                "time": str(row.get("_time")),
                "cycle_id": cid,
                "global_cycle_id": gcid,
                "anomaly_score": _to_float(row.get("anomaly_score")),
                "status": row.get("status"),
            }
    return None


def build_analytics_context(question: str) -> str:
    if not _INFLUX_OK:
        return "ANALYTICS CONTEXT:\nInfluxDB data unavailable.\n"

    q = (question or "").strip().lower()
    lines: list[str] = ["ANALYTICS CONTEXT:"]

    cycle_match = re.search(r"\bcycle\s+(\d+)\b", q)
    asks_last_5_scores = ("anomaly score" in q) and ("last 5" in q or "last five" in q)
    asks_trend = ("anomal" in q and "increasing" in q) or ("trend" in q and "anomal" in q)

    if asks_last_5_scores:
        rows = _query_last_anomaly_scores(limit=5)
        if not rows:
            lines.append("No anomaly score records found.")
        else:
            lines.append("Last 5 anomaly scores (newest first):")
            for item in rows:
                lines.append(
                    f"- global_cycle_id={item.get('global_cycle_id')}, cycle_id={item.get('cycle_id')}, "
                    f"score={item.get('anomaly_score')}, status={item.get('status')}"
                )

    if cycle_match:
        cycle_ref = int(cycle_match.group(1))
        details = _query_cycle_details(cycle_ref)
        if details is None:
            lines.append(f"No record found for cycle reference {cycle_ref}.")
        else:
            lines.append(
                "Cycle details: "
                f"global_cycle_id={details.get('global_cycle_id')}, "
                f"cycle_id={details.get('cycle_id')}, "
                f"score={details.get('anomaly_score')}, "
                f"status={details.get('status')}, "
                f"time={details.get('time')}"
            )

    if asks_trend:
        rows = list(reversed(_query_last_anomaly_scores(limit=5)))
        values = [x.get("anomaly_score") for x in rows if isinstance(x.get("anomaly_score"), (int, float))]
        if len(values) < 2:
            lines.append("Insufficient anomaly records to determine trend.")
        else:
            delta = values[-1] - values[0]
            if delta > 0.01:
                trend = "increasing"
            elif delta < -0.01:
                trend = "decreasing"
            else:
                trend = "stable"
            lines.append(
                f"Anomaly trend over last {len(values)} cycles: {trend} "
                f"(start={values[0]:.4f}, end={values[-1]:.4f}, delta={delta:.4f})"
            )

    if len(lines) == 1:
        lines.append("No analytics-specific query pattern detected.")

    lines.append(
        "Safety policy: interpretation only, never issue control commands, never assume missing events occurred."
    )
    lines.append(f"Generated_at_utc={datetime.now(timezone.utc).isoformat()}")
    return "\n".join(lines) + "\n"


def _build_user_message(
    question: str,
    snapshot: Optional[dict[str, Any]],
    recent_system_context: str,
    analytics_context: str,
) -> str:
    if snapshot:
        snapshot_json = json.dumps(snapshot, ensure_ascii=True, separators=(",", ":"))
        return (
            f"SYSTEM CONTEXT:\n{recent_system_context}\n\n"
            f"{analytics_context}\n"
            f"OPERATOR QUESTION:\n{question}\n\n"
            f"CURRENT SYSTEM STATE (JSON):\n{snapshot_json}\n\n"
            "Answer using only available evidence. If data is missing, say so explicitly."
        )
    return (
        f"SYSTEM CONTEXT:\n{recent_system_context}\n\n"
        f"{analytics_context}\n"
        f"OPERATOR QUESTION:\n{question}\n\n"
        "Answer using only available evidence. If data is missing, say so explicitly."
    )


def _call_chatgpt_api(client: OpenAI, system_prompt: str, user_message: str) -> str:
    model = os.getenv("MODEL", "gpt-4o-mini" if os.getenv("OPENAI_API_KEY") else "openai/gpt-4o")
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _trim_for_budget(system_prompt, 1800)},
            {"role": "user", "content": _trim_for_budget(user_message, 1800)},
        ],
        temperature=0,
        max_tokens=350,
        stream=False,
    )
    return (response.choices[0].message.content or "").strip()


def _parse_chatgpt_response(response_text: str) -> dict[str, Any]:
    raw = (response_text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE).strip()
        raw = re.sub(r"\s*```$", "", raw).strip()

    first = raw.find("{")
    last = raw.rfind("}")
    candidate = raw[first:last + 1] if first != -1 and last != -1 and last > first else raw

    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        if isinstance(parsed, dict) and isinstance(parsed.get("interpretation"), dict):
            parsed = parsed["interpretation"]
        summary = str(parsed.get("authoritative_summary", "")).strip()
        technical = str(parsed.get("technical_explanation", "")).strip()
        actions = parsed.get("recommended_operator_actions", [])
        if isinstance(actions, str):
            actions = [actions]
        if not isinstance(actions, list):
            actions = []
        actions = [str(a).strip() for a in actions if str(a).strip()]
        confidence = str(parsed.get("confidence_level", "MEDIUM")).upper()
        if not summary:
            summary = "No authoritative summary provided."
        if not technical:
            technical = "No technical explanation provided."
        if not actions:
            actions = ["Review system history and verify sensor/actuator state."]
        return {
            "authoritative_summary": summary,
            "technical_explanation": technical,
            "recommended_operator_actions": actions,
            "confidence_level": confidence,
        }
    except Exception:
        return {
            "authoritative_summary": raw or "Unable to parse model response.",
            "technical_explanation": raw or "Unable to parse model response.",
            "recommended_operator_actions": ["Review system history and ask a more specific question."],
            "confidence_level": "LOW",
        }


def generate_assistant_response(question: str, snapshot: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    if is_control_or_unsafe_question(question):
        return safety_refusal_interpretation()
    if is_meta_question(question):
        return generate_meta_response()

    recent_context = _build_recent_system_context()
    analytics_context = build_analytics_context(question)
    system_prompt = _get_system_prompt()
    user_message = _build_user_message(question, snapshot, recent_context, analytics_context)

    client = _get_openai_client()
    if client is None:
        return {
            "authoritative_summary": "AI interpretation service is not configured.",
            "technical_explanation": "No API credentials found. Configure OPENAI_API_KEY or GITHUB_TOKEN.",
            "recommended_operator_actions": ["Contact system administrator to configure API access."],
            "confidence_level": "LOW",
        }

    try:
        response = _call_chatgpt_api(client, system_prompt, user_message)
        return _parse_chatgpt_response(response)
    except Exception as exc:
        return {
            "authoritative_summary": "Assistant generation failed.",
            "technical_explanation": f"Error calling model API: {exc}",
            "recommended_operator_actions": ["Retry the request.", "Check backend/API logs if the issue persists."],
            "confidence_level": "LOW",
        }

