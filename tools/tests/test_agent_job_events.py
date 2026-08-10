from __future__ import annotations

import json
import unittest

from pathlib import Path
import sys


TOOLS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS_DIR))

from agent_job_events import (  # noqa: E402
    MAX_EVENT_RECORD_BYTES,
    MAX_EVENT_TEXT_CHARS,
    ProviderEventDecoder,
    bound_event_payload,
)


class ProviderEventDecoderTest(unittest.TestCase):
    def test_codex_json_split_across_chunks_yields_one_event(self) -> None:
        decoder = ProviderEventDecoder("codex")
        line = json.dumps({
            "type": "item.completed",
            "item": {"id": "message-1", "type": "agent_message", "text": "ready"},
        }).encode("utf-8") + b"\n"

        self.assertEqual([], decoder.feed(line[:17]))
        events = decoder.feed(line[17:])

        self.assertEqual(["message_delta"], [event["kind"] for event in events])
        self.assertEqual("ready", events[0]["payload"]["text"])

    def test_utf8_character_split_across_chunks_is_preserved(self) -> None:
        decoder = ProviderEventDecoder("codex")
        line = json.dumps({
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "café"},
        }, ensure_ascii=False).encode("utf-8") + b"\n"
        split = line.index("é".encode("utf-8")) + 1

        self.assertEqual([], decoder.feed(line[:split]))
        events = decoder.feed(line[split:])

        self.assertEqual("café", events[0]["payload"]["text"])

    def test_tool_boundaries_are_normalized_without_command_text(self) -> None:
        decoder = ProviderEventDecoder("codex")
        source = (
            json.dumps({
                "type": "item.started",
                "item": {"id": "tool-1", "type": "command_execution", "command": "secret"},
            })
            + "\n"
            + json.dumps({
                "type": "item.completed",
                "item": {"id": "tool-1", "type": "command_execution", "exit_code": 0},
            })
            + "\n"
        ).encode("utf-8")

        events = decoder.feed(source)

        self.assertEqual(["tool_started", "tool_finished"], [event["kind"] for event in events])
        self.assertNotIn("secret", json.dumps(events))

    def test_malformed_and_unknown_records_are_nonfatal(self) -> None:
        decoder = ProviderEventDecoder("codex")

        events = decoder.feed(b"not-json\n{\"type\":\"future.event\",\"value\":1}\n")

        self.assertEqual(["parse_error", "provider_raw"], [event["kind"] for event in events])

    def test_unknown_event_payload_has_a_total_size_bound(self) -> None:
        decoder = ProviderEventDecoder("codex")
        value = {
            "type": "future.event",
            "items": ["x" * MAX_EVENT_TEXT_CHARS for _ in range(50)],
        }

        events = decoder.feed((json.dumps(value) + "\n").encode())

        self.assertEqual("provider_raw", events[0]["kind"])
        payload = events[0]["payload"]
        self.assertTrue(payload["truncated"])
        self.assertLessEqual(
            len(json.dumps(payload, ensure_ascii=False).encode("utf-8")),
            MAX_EVENT_TEXT_CHARS + 100,
        )

    def test_progress_payload_has_an_aggregate_record_bound(self) -> None:
        decoder = ProviderEventDecoder("codex")
        value = {
            "type": "item.completed",
            "item": {
                "type": "file_change",
                "changes": ["x" * MAX_EVENT_TEXT_CHARS for _ in range(50)],
            },
        }

        event = decoder.feed((json.dumps(value) + "\n").encode())[0]
        payload = bound_event_payload(event["payload"])

        self.assertTrue(payload["truncated"])
        self.assertLess(
            len(json.dumps({"payload": payload}, ensure_ascii=False).encode("utf-8")),
            MAX_EVENT_RECORD_BYTES,
        )

    def test_final_unterminated_line_is_decoded(self) -> None:
        decoder = ProviderEventDecoder("codex")
        decoder.feed(b'{"type":"turn.started"')
        events = decoder.feed(b"}", final=True)
        self.assertEqual("turn_started", events[0]["kind"])


if __name__ == "__main__":
    unittest.main()
