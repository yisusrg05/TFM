#!/usr/bin/env python3
"""Batería suplementaria de Key Leak y CDN leeching para las tres fases."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run_evaluation import bearer, request, reset_phase1, reset_phase2


ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "evidencias" / "resultados"
ASSET_ID = "local-cenc-clearkey"
CONTENT_FILES = ["video_init.mp4", "video_1.m4s", "video_2.m4s"]
PHASES = {
    "fase1": {"base": "http://localhost:9080", "hostileOrigin": "http://localhost:9302"},
    "fase2": {"base": "http://localhost:9180", "hostileOrigin": "http://localhost:9402"},
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def check(
    rows: list[dict[str, Any]],
    identifier: str,
    phase: str,
    description: str,
    expected: str,
    observed: Any,
    passed: bool,
) -> None:
    rows.append({
        "id": identifier,
        "phase": phase,
        "description": description,
        "expected": expected,
        "observed": observed,
        "passed": bool(passed),
    })


def phase0(rows: list[dict[str, Any]]) -> dict[str, Any]:
    base = "http://localhost:8080"
    manifest = request("GET", f"{base}/content/dash-known-key/stream.mpd")
    initialization = request("GET", f"{base}/content/dash-known-key/video_init.mp4")
    segment = request("GET", f"{base}/content/dash-known-key/video_1.m4s")
    check(rows, "CDN-F0-MANIFEST-PUBLIC", "fase0", "Manifest local sin token", "HTTP 200", manifest["status"], manifest["status"] == 200)
    check(rows, "CDN-F0-INIT-PUBLIC", "fase0", "Inicialización sin token", "HTTP 200", initialization["status"], initialization["status"] == 200)
    check(rows, "CDN-F0-SEGMENT-PUBLIC", "fase0", "Segmento cifrado sin token", "HTTP 200", segment["status"], segment["status"] == 200)
    return {
        "phase": "fase0",
        "manifestStatus": manifest["status"],
        "initializationStatus": initialization["status"],
        "segmentStatus": segment["status"],
        "bytesAccessibleWithoutToken": sum((item.get("body") or {}).get("binaryBytes", 0) for item in [initialization, segment]),
        "existingPlaybackEvidence": "evidencias/fase0/capturas/fase0_03_clearkey_sin_licencia.png",
    }


def protected_phase(phase: str, rows: list[dict[str, Any]], *, reset: bool = True) -> dict[str, Any]:
    config = PHASES[phase]
    base = config["base"]
    hostile_origin = config["hostileOrigin"]
    if reset:
        if phase == "fase1":
            reset_phase1()
        else:
            reset_phase2()

    prefix = "CDN-F1" if phase == "fase1" else "CDN-F2"
    device_id = f"cdn-leech-{phase}"
    client_instance_id = f"cdn-leech-instance-{phase}"

    no_token_manifest = request("GET", f"{base}/manifest/{ASSET_ID}")
    no_token_segment = request("GET", f"{base}/content/dash-known-key/video_init.mp4")
    check(rows, f"{prefix}-MANIFEST-NO-TOKEN", phase, "Manifest sin playbackToken", "HTTP 401", no_token_manifest["status"], no_token_manifest["status"] == 401)
    check(rows, f"{prefix}-SEGMENT-NO-TOKEN", phase, "Segmento sin playbackToken", "HTTP 401", no_token_segment["status"], no_token_segment["status"] == 401)

    login = request("POST", f"{base}/auth/login", json_body={
        "email": "usuario-permitido@tfm.local",
        "password": "demo123",
        "deviceId": device_id,
    })
    access_token = login["body"]["accessToken"]
    session_response = request("POST", f"{base}/playback/session", json_body={
        "assetId": ASSET_ID,
        "clientInstanceId": client_instance_id,
    }, headers=bearer(access_token))
    session_body = session_response["body"]
    playback_token = session_body["playbackToken"]
    session_id = session_body["session"]["sessionId"]
    protected_headers = bearer(playback_token, session_id, client_instance_id=client_instance_id)
    check(rows, f"{prefix}-SESSION-VALID", phase, "Única sesión externa autorizada", "HTTP 201", session_response["status"], session_response["status"] == 201)

    manifest = request("GET", f"{base}/manifest/{ASSET_ID}", headers=protected_headers)
    cors_manifest = request("GET", f"{base}/manifest/{ASSET_ID}", headers={**protected_headers, "Origin": hostile_origin})
    allowed_origin = cors_manifest["headers"].get("access-control-allow-origin")
    check(rows, f"{prefix}-MANIFEST-VALID", phase, "Cliente no sujeto a CORS con token válido", "HTTP 200 DASH", manifest["status"], manifest["status"] == 200)
    check(
        rows,
        f"{prefix}-CORS-HOSTILE",
        phase,
        "Origen web externo no autorizado",
        "ACAO distinto del origen atacante",
        {"status": cors_manifest["status"], "origin": hostile_origin, "allowOrigin": allowed_origin},
        cors_manifest["status"] == 200 and allowed_origin != hostile_origin,
    )

    content_responses = [
        request("GET", f"{base}/content/dash-known-key/{filename}", headers=protected_headers)
        for filename in CONTENT_FILES
    ]
    content_statuses = [item["status"] for item in content_responses]
    bytes_served = sum((item.get("body") or {}).get("binaryBytes", 0) for item in content_responses)
    check(rows, f"{prefix}-CONTENT-VALID", phase, "Tres objetos de contenido con token válido", "HTTP 200/200/200", content_statuses, content_statuses == [200, 200, 200])

    second_session = request("POST", f"{base}/playback/session", json_body={
        "assetId": ASSET_ID,
        "clientInstanceId": f"{client_instance_id}-second",
    }, headers=bearer(access_token))
    cloned = request("GET", f"{base}/manifest/{ASSET_ID}", headers=bearer(
        playback_token,
        session_id,
        client_instance_id=f"{client_instance_id}-clone",
    ))
    cross_asset = request("GET", f"{base}/manifest/sintel-widevine", headers=protected_headers)
    check(rows, f"{prefix}-SECOND-SESSION", phase, "Segunda sesión para la misma cuenta", "HTTP 409", second_session["status"], second_session["status"] == 409)
    check(rows, f"{prefix}-CLONED-INSTANCE", phase, "Mismo token desde otra instancia", "HTTP 401", cloned["status"], cloned["status"] == 401)
    check(rows, f"{prefix}-CROSS-ASSET", phase, "Token del canal local aplicado a otro activo", "HTTP 403", cross_asset["status"], cross_asset["status"] == 403)

    overview_body = None
    risk_score = None
    risk_reasons: list[str] = []
    key_leak_events = 0
    if phase == "fase2":
        overview_response = request("GET", f"{base}/admin/overview", headers=bearer(access_token))
        overview_body = overview_response["body"]["overview"]
        risk_score = overview_body["risk"]["score"]
        risk_reasons = overview_body["risk"]["reasons"]
        key_leak_events = sum(1 for event in overview_body["recentEvents"] if event.get("type") == "key_leak.pattern_detected")
        check(rows, f"{prefix}-KEY-LEAK-RISK", phase, "Contenido sin licencia genera riesgo una vez", "+20 y razón específica", {"score": risk_score, "reasons": risk_reasons, "events": key_leak_events}, risk_score == 20 and "POSSIBLE_KEY_LEAK_LICENSE_BYPASS" in risk_reasons and key_leak_events == 1)

        extra_segment = request("GET", f"{base}/content/dash-known-key/video_3.m4s", headers=protected_headers)
        overview_after = request("GET", f"{base}/admin/overview", headers=bearer(access_token))["body"]["overview"]
        check(rows, f"{prefix}-RISK-ONCE", phase, "La señal no se duplica en la misma sesión", "Score permanece en 20", overview_after["risk"]["score"], extra_segment["status"] == 200 and overview_after["risk"]["score"] == 20)
        overview_body = overview_after

    stop = request("POST", f"{base}/playback/stop", headers=protected_headers)
    after_stop = request("GET", f"{base}/content/dash-known-key/video_4.m4s", headers=protected_headers)
    check(rows, f"{prefix}-STOP", phase, "Parada explícita de la sesión externa", "HTTP 200", stop["status"], stop["status"] == 200)
    check(rows, f"{prefix}-AFTER-STOP", phase, "Segmento tras detener la sesión", "HTTP 401", after_stop["status"], after_stop["status"] == 401)

    summary = {
        "phase": phase,
        "sessionId": session_id,
        "assetId": ASSET_ID,
        "manifestStatus": manifest["status"],
        "contentStatuses": content_statuses,
        "contentBytesServed": bytes_served,
        "contentLatencyMs": [item["durationMs"] for item in content_responses],
        "licenseRequests": 0,
        "cors": {"hostileOrigin": hostile_origin, "allowOrigin": allowed_origin, "httpStatus": cors_manifest["status"]},
        "secondSessionStatus": second_session["status"],
        "clonedInstanceStatus": cloned["status"],
        "crossAssetStatus": cross_asset["status"],
        "riskScore": risk_score,
        "riskReasons": risk_reasons,
        "keyLeakEvents": key_leak_events,
        "postStopStatus": after_stop["status"],
        "overview": overview_body,
    }
    output = ROOT / "evidencias" / phase / "json" / f"{phase}_{'02' if phase == 'fase1' else '03'}_cdn_leeching.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def write_results(rows: list[dict[str, Any]], summaries: list[dict[str, Any]]) -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    document = {
        "generatedAt": now_iso(),
        "campaign": "key-leak-cdn-leeching",
        "summary": {
            "total": len(rows),
            "passed": sum(1 for row in rows if row["passed"]),
            "failed": sum(1 for row in rows if not row["passed"]),
        },
        "checks": rows,
        "phaseSummaries": summaries,
    }
    (RESULTS / "resultados_cdn_leeching.json").write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    csv_rows = [{**row, "observed": json.dumps(row["observed"], ensure_ascii=False)} for row in rows]
    with (RESULTS / "resultados_cdn_leeching.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["id", "phase", "description", "expected", "observed", "passed"])
        writer.writeheader()
        writer.writerows(csv_rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["fase0", "fase1", "fase2", "all"], default="all", nargs="?")
    parser.add_argument("--skip-reset", action="store_true", help="Usa un estado ya reiniciado, útil durante una captura PCAP limpia")
    args = parser.parse_args()
    rows: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    selected = ["fase0", "fase1", "fase2"] if args.phase == "all" else [args.phase]
    for phase in selected:
        summaries.append(phase0(rows) if phase == "fase0" else protected_phase(phase, rows, reset=not args.skip_reset))
    if args.phase == "all":
        write_results(rows, summaries)
    passed = sum(1 for row in rows if row["passed"])
    print(json.dumps({"phase": args.phase, "total": len(rows), "passed": passed, "failed": len(rows) - passed}, ensure_ascii=False))
    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
