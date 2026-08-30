#!/usr/bin/env python3
"""Exporta el estado observable de Redis para un escenario de Fase 2."""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def redis(*arguments: str) -> str:
    result = subprocess.run(
        ["docker", "exec", "tfm-fase2-redis", "redis-cli", "--raw", *arguments],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def json_value(key: str):
    value = redis("GET", key)
    if not value:
        return None
    return json.loads(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario")
    arguments = parser.parse_args()

    event_rows = redis("LRANGE", "events", "0", "-1").splitlines()
    events = [json.loads(row) for row in event_rows if row.strip()]
    session_keys = [row for row in redis("--scan", "--pattern", "session:*").splitlines() if row.strip()]
    ban_keys = [row for row in redis("--scan", "--pattern", "ban:*").splitlines() if row.strip()]
    document = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scenario": arguments.scenario,
        "risk": json_value("risk:acc-allowed-001"),
        "activeBans": [json_value(key) for key in sorted(ban_keys)],
        "sessions": [json_value(key) for key in sorted(session_keys)],
        "events": events,
    }
    destination = ROOT / "evidencias" / "fase2" / "json" / f"{arguments.scenario}.json"
    destination.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main()
