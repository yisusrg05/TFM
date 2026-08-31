#!/usr/bin/env python3
"""Conserva metadatos del entorno, uso puntual y logs de la evaluación."""

from __future__ import annotations

import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def run(*arguments: str) -> str:
    result = subprocess.run(arguments, cwd=ROOT, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def json_lines(value: str):
    return [json.loads(line) for line in value.splitlines() if line.strip()]


def main() -> None:
    containers = json_lines(run("docker", "ps", "--format", "{{json .}}"))
    stats = json_lines(run("docker", "stats", "--no-stream", "--format", "{{json .}}"))
    relevant = [
        item
        for item in containers
        if item.get("Names", "").startswith("tfm-")
    ]
    relevant_names = {item["Names"] for item in relevant}
    relevant_stats = [item for item in stats if item.get("Name") in relevant_names]
    document = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": {
            "platform": platform.platform(),
            "processor": platform.processor(),
            "logicalCpuCount": os.cpu_count(),
        },
        "dockerVersion": run("docker", "version", "--format", "{{json .Server.Version}}"),
        "gitRevision": run("git", "rev-parse", "HEAD"),
        "containers": relevant,
        "pointInTimeStats": relevant_stats,
    }
    destination = ROOT / "evidencias" / "resultados" / "entorno_ejecucion.json"
    destination.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    logs = {
        ROOT / "evidencias" / "fase1" / "logs" / "control-plane.log": "tfm-fase1-control-plane",
        ROOT / "evidencias" / "fase1" / "logs" / "license-server.log": "tfm-fase1-license-server",
        ROOT / "evidencias" / "fase1" / "logs" / "key-leak-lab.log": "tfm-fase1-key-leak-lab",
        ROOT / "evidencias" / "fase2" / "logs" / "control-plane.log": "tfm-fase2-control-plane",
        ROOT / "evidencias" / "fase2" / "logs" / "license-server.log": "tfm-fase2-license-server",
        ROOT / "evidencias" / "fase2" / "logs" / "key-leak-lab.log": "tfm-fase2-key-leak-lab",
    }
    for path, container in logs.items():
        raw_log = run("docker", "logs", "--timestamps", container)
        normalized_log = "\n".join(line.rstrip() for line in raw_log.splitlines()) + "\n"
        path.write_text(normalized_log, encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main()
