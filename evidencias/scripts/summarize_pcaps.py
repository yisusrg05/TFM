#!/usr/bin/env python3
"""Genera resúmenes JSON seguros de los PCAP sin exportar Authorization."""

from __future__ import annotations

import csv
import hashlib
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PCAPS = [
    ROOT / "evidencias" / "fase0" / "pcap" / "fase0_01_flujo_oficial_widevine.pcap",
    ROOT / "evidencias" / "fase0" / "pcap" / "fase0_02_bypass_widevine_no_auth.pcap",
    ROOT / "evidencias" / "fase0" / "pcap" / "fase0_03_clearkey_sin_licencia.pcap",
    ROOT / "evidencias" / "fase1" / "pcap" / "fase1_01_laboratorio_protegido.pcap",
    ROOT / "evidencias" / "fase1" / "pcap" / "fase1_02_cdn_leeching.pcap",
    ROOT / "evidencias" / "fase2" / "pcap" / "fase2_01_concurrencia_y_ban.pcap",
    ROOT / "evidencias" / "fase2" / "pcap" / "fase2_02_fallos_auth_y_ban_device.pcap",
    ROOT / "evidencias" / "fase2" / "pcap" / "fase2_03_cdn_leeching.pcap",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def tshark_rows(path: Path) -> list[dict[str, str]]:
    mount = str(path.parent.resolve())
    command = [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{mount}:/captures:ro",
        "nicolaka/netshoot",
        "tshark",
        "-r",
        f"/captures/{path.name}",
        "-Y",
        "http.request || http.response.code",
        "-T",
        "fields",
        "-E",
        "quote=d",
        "-E",
        "header=y",
        "-e",
        "frame.number",
        "-e",
        "frame.time_epoch",
        "-e",
        "ip.src",
        "-e",
        "ip.dst",
        "-e",
        "http.request.method",
        "-e",
        "http.host",
        "-e",
        "http.request.uri",
        "-e",
        "http.response.code",
        "-e",
        "http.content_length",
    ]
    result = subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return list(csv.DictReader(result.stdout.splitlines(), delimiter="\t", quotechar='"'))


def main() -> None:
    generated = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for path in PCAPS:
        rows = tshark_rows(path)
        requests = [row for row in rows if row.get("http.request.method")]
        responses = [row for row in rows if row.get("http.response.code")]
        request_counts = Counter(f"{row['http.request.method']} {row['http.request.uri']}" for row in requests)
        response_counts = Counter(row["http.response.code"] for row in responses)
        phase = next(part for part in path.parts if part in {"fase0", "fase1", "fase2"})
        output_directory = ROOT / "evidencias" / phase / "json"
        output_directory.mkdir(parents=True, exist_ok=True)
        document = {
            "generatedAt": generated,
            "source": str(path.relative_to(ROOT)).replace("\\", "/"),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
            "httpRequestCount": len(requests),
            "httpResponseCount": len(responses),
            "requestCounts": dict(sorted(request_counts.items())),
            "responseCounts": dict(sorted(response_counts.items())),
            "packets": rows,
        }
        destination = output_directory / f"{path.stem}_http.json"
        destination.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{path.name}: {len(requests)} requests, {len(responses)} responses")


if __name__ == "__main__":
    main()
