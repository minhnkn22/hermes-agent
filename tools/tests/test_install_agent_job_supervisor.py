from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


TOOLS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS_DIR))

from install_agent_job_supervisor import _service_environment  # noqa: E402


class SupervisorInstallerTest(unittest.TestCase):
    def test_service_environment_forwards_cao_canary_configuration(self) -> None:
        values = {
            "AGENT_JOB_EXECUTION_BACKEND": "native",
            "AGENT_JOB_CAO_URL": "http://127.0.0.1:9889",
            "AGENT_JOB_CAO_TOKEN": "token",
            "AGENT_JOB_CAO_LAUNCH_TIMEOUT": "7",
            "AGENT_JOB_CAO_PROVIDERS": "kimi",
            "AGENT_JOB_CAO_CANARY_PROVIDERS": "claude",
            "AGENT_JOB_CAO_CANARY_OWNER_PREFIXES": "cao-canary:abc:",
        }
        with patch.dict(os.environ, values, clear=False):
            environment = _service_environment()

        for name, value in values.items():
            self.assertEqual(value, environment[name])


if __name__ == "__main__":
    unittest.main()
