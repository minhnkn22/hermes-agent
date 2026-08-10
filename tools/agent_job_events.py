#!/usr/bin/env python3
"""Pure provider-event normalization for durable agent jobs."""

from __future__ import annotations

import codecs
import json
from typing import Any


MAX_EVENT_TEXT_CHARS = 16_000
MAX_EVENT_RECORD_BYTES = (MAX_EVENT_TEXT_CHARS * 4) + 4096
MAX_COLLECTION_ITEMS = 50
MAX_VALUE_DEPTH = 4


def _bounded(value: Any, depth: int = 0) -> Any:
    if depth >= MAX_VALUE_DEPTH:
        return "[nested value omitted]"
    if isinstance(value, str):
        if len(value) <= MAX_EVENT_TEXT_CHARS:
            return value
        return value[:MAX_EVENT_TEXT_CHARS] + "[truncated]"
    if isinstance(value, dict):
        return {
            str(key)[:200]: _bounded(item, depth + 1)
            for key, item in list(value.items())[:MAX_COLLECTION_ITEMS]
        }
    if isinstance(value, list):
        return [_bounded(item, depth + 1) for item in value[:MAX_COLLECTION_ITEMS]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:MAX_EVENT_TEXT_CHARS]


def _raw_payload(value: Any) -> dict[str, Any]:
    bounded = _bounded(value)
    encoded = json.dumps(bounded, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) <= MAX_EVENT_TEXT_CHARS:
        return {"provider_event": bounded}
    preview = encoded.encode("utf-8")[:MAX_EVENT_TEXT_CHARS].decode(
        "utf-8", errors="ignore"
    )
    return {"provider_event_preview": preview, "truncated": True}


def bound_event_payload(payload: dict[str, Any]) -> dict[str, Any]:
    bounded = _bounded(payload)
    encoded = json.dumps(bounded, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) <= MAX_EVENT_RECORD_BYTES - 4096:
        return bounded
    preview = encoded.encode("utf-8")[:MAX_EVENT_TEXT_CHARS].decode(
        "utf-8", errors="ignore"
    )
    return {"payload_preview": preview, "truncated": True}


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _tool_name(item: dict[str, Any]) -> str:
    item_type = str(item.get("type") or "tool")
    if item_type == "command_execution":
        return "command"
    if item_type == "mcp_tool_call":
        server = str(item.get("server") or item.get("server_name") or "mcp")
        tool = str(item.get("tool") or item.get("tool_name") or "tool")
        return f"{server}:{tool}"[:200]
    if item_type == "web_search":
        return "web_search"
    return item_type[:200]


def _codex_events(value: dict[str, Any]) -> list[dict[str, Any]]:
    event_type = str(value.get("type") or "")
    item = value.get("item")
    item = item if isinstance(item, dict) else {}
    item_type = str(item.get("type") or "")
    item_id = str(item.get("id") or "")[:200]

    if event_type == "turn.started":
        return [{"kind": "turn_started", "payload": {}}]
    if event_type == "turn.completed":
        usage = value.get("usage")
        return [{"kind": "usage", "payload": {"usage": _bounded(usage or {})}}]
    if event_type in {"turn.failed", "error"}:
        message = _text(value.get("message") or item.get("message"))
        return [{"kind": "warning", "payload": {"message": message[:MAX_EVENT_TEXT_CHARS]}}]
    if event_type == "item.started":
        if item_type in {"command_execution", "mcp_tool_call", "web_search"}:
            return [{
                "kind": "tool_started",
                "payload": {"id": item_id, "name": _tool_name(item)},
            }]
        if item_type == "reasoning":
            text = _text(item.get("text"))
            return [{"kind": "thinking_delta", "payload": {"text": text}}]
        return [{"kind": "provider_raw", "payload": _raw_payload(value)}]
    if event_type == "item.completed":
        if item_type == "agent_message":
            return [{
                "kind": "message_delta",
                "payload": {"text": _text(item.get("text"))},
            }]
        if item_type == "reasoning":
            return [{
                "kind": "thinking_delta",
                "payload": {"text": _text(item.get("text"))},
            }]
        if item_type in {"command_execution", "mcp_tool_call", "web_search"}:
            return [{
                "kind": "tool_finished",
                "payload": {
                    "id": item_id,
                    "name": _tool_name(item),
                    "status": str(item.get("status") or "completed")[:100],
                    "exit_code": item.get("exit_code"),
                },
            }]
        if item_type == "error":
            return [{
                "kind": "warning",
                "payload": {"message": _text(item.get("message"))[:MAX_EVENT_TEXT_CHARS]},
            }]
        return [{"kind": "progress", "payload": {"item": _bounded(item)}}]
    return [{"kind": "provider_raw", "payload": _raw_payload(value)}]


class ProviderEventDecoder:
    """Incrementally decode complete provider JSONL records from raw bytes."""

    def __init__(self, provider: str):
        self.provider = provider
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._buffer = ""

    def feed(self, data: bytes, *, final: bool = False) -> list[dict[str, Any]]:
        self._buffer += self._decoder.decode(data, final=final)
        lines = self._buffer.split("\n")
        self._buffer = "" if final else lines.pop()
        if final and lines and not lines[-1]:
            lines.pop()
        events: list[dict[str, Any]] = []
        for raw_line in lines:
            line = raw_line.rstrip("\r")
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                events.append({
                    "kind": "parse_error",
                    "payload": {
                        "message": str(exc)[:500],
                        "raw": line[:MAX_EVENT_TEXT_CHARS],
                    },
                })
                continue
            if not isinstance(value, dict):
                events.append({
                    "kind": "provider_raw",
                    "payload": _raw_payload(value),
                })
                continue
            if self.provider == "codex":
                events.extend(_codex_events(value))
            else:
                events.append({
                    "kind": "provider_raw",
                    "payload": _raw_payload(value),
                })
        return events

    def finish(self) -> list[dict[str, Any]]:
        return self.feed(b"", final=True)
