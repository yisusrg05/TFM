#!/usr/bin/env python3
"""Batería reproducible de evaluación para las fases 0, 1 y 2 del TFM.

Genera resultados JSON/CSV sin conservar tokens completos. Los PCAP y las
capturas de navegador se adquieren por separado para que cada artefacto quede
ligado a un escenario concreto.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import platform
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[2]
RESULTS_DIR = ROOT / "evidencias" / "resultados"

PHASES = {
    "fase0": {"base": "http://localhost:8080", "origin": "http://localhost:3000"},
    "fase1": {"base": "http://localhost:9080", "origin": "http://localhost:9301"},
    "fase2": {"base": "http://localhost:9180", "origin": "http://localhost:9401"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def run_command(arguments: list[str], timeout: int = 60) -> str:
    completed = subprocess.run(
        arguments,
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return completed.stdout.strip()


def wait_for_url(url: str, timeout_seconds: float = 30.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    last_status: int | None = None
    while time.monotonic() < deadline:
        try:
            response = request("GET", url, timeout=3)
            last_status = response["status"]
            if response["status"] == 200:
                return
        except Exception as error:  # pragma: no cover - diagnóstico externo
            last_error = error
        time.sleep(0.4)
    raise RuntimeError(f"No se recuperó {url}: status={last_status}, error={last_error}")


def reset_phase0() -> None:
    run_command(["docker", "restart", "tfm-license-server"])
    wait_for_url("http://localhost:8082/health")


def reset_phase1() -> None:
    run_command(["docker", "restart", "tfm-fase1-control-plane"])
    wait_for_url("http://localhost:9080/health")


def reset_phase2() -> None:
    run_command(["docker", "exec", "tfm-fase2-redis", "redis-cli", "FLUSHDB"])
    wait_for_url("http://localhost:9180/health")


def sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if "token" in key.lower():
                result[key] = "<redacted>"
            else:
                result[key] = sanitize(item)
        return result
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    return value


def request(
    method: str,
    url: str,
    *,
    json_body: dict[str, Any] | None = None,
    binary_body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 25.0,
) -> dict[str, Any]:
    request_headers = dict(headers or {})
    body: bytes | None = binary_body
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")

    http_request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    started = time.perf_counter_ns()
    status: int | None = None
    response_headers: dict[str, str] = {}
    response_body = b""
    transport_error: str | None = None
    try:
        with urllib.request.urlopen(http_request, timeout=timeout) as response:
            status = response.status
            response_headers = {key.lower(): value for key, value in response.headers.items()}
            response_body = response.read()
    except urllib.error.HTTPError as error:
        status = error.code
        response_headers = {key.lower(): value for key, value in error.headers.items()}
        response_body = error.read()
    except Exception as error:  # pragma: no cover - diagnóstico de infraestructura
        transport_error = f"{type(error).__name__}: {error}"
    duration_ms = (time.perf_counter_ns() - started) / 1_000_000

    decoded: Any = None
    if response_body:
        try:
            decoded = json.loads(response_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            decoded = {
                "binaryBytes": len(response_body),
                "contentType": response_headers.get("content-type"),
            }

    return {
        "status": status,
        "durationMs": round(duration_ms, 3),
        "headers": response_headers,
        "body": decoded,
        "transportError": transport_error,
    }


def bearer(token: str, session_id: str | None = None, origin: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if session_id:
        headers["X-Playback-Session-Id"] = session_id
    if origin:
        headers["Origin"] = origin
    return headers


class FunctionalSuite:
    def __init__(self) -> None:
        self.results: list[dict[str, Any]] = []

    def check(
        self,
        identifier: str,
        phase: str,
        category: str,
        description: str,
        response: dict[str, Any],
        expected: str,
        predicate: Callable[[dict[str, Any]], bool],
    ) -> bool:
        passed = bool(predicate(response))
        self.results.append(
            {
                "id": identifier,
                "phase": phase,
                "category": category,
                "description": description,
                "expected": expected,
                "passed": passed,
                "observed": {
                    "status": response.get("status"),
                    "durationMs": response.get("durationMs"),
                    "headers": {
                        key: value
                        for key, value in response.get("headers", {}).items()
                        if key in {
                            "content-type",
                            "x-phase0-weakness",
                            "x-playback-session-id",
                            "x-asset-id",
                            "x-risk-score",
                        }
                    },
                    "body": sanitize(response.get("body")),
                    "transportError": response.get("transportError"),
                },
            }
        )
        return passed

    def synthetic(
        self,
        identifier: str,
        phase: str,
        category: str,
        description: str,
        expected: str,
        observed: Any,
        passed: bool,
    ) -> None:
        self.results.append(
            {
                "id": identifier,
                "phase": phase,
                "category": category,
                "description": description,
                "expected": expected,
                "passed": bool(passed),
                "observed": sanitize(observed),
            }
        )

    def phase0(self) -> None:
        reset_phase0()
        base = PHASES["fase0"]["base"]
        origin = PHASES["fase0"]["origin"]

        health = request("GET", "http://localhost:8082/health")
        self.check("F0-HEALTH", "fase0", "disponibilidad", "Health del servicio base", health, "HTTP 200", lambda r: r["status"] == 200)

        allowed = request("POST", f"{base}/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "demo123"}, headers={"Origin": origin})
        self.check("F0-AUTH-OK", "fase0", "autenticacion", "Login del usuario autorizado", allowed, "HTTP 200", lambda r: r["status"] == 200)
        access_token = allowed["body"]["accessToken"]

        invalid = request("POST", f"{base}/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "incorrecta"}, headers={"Origin": origin})
        self.check("F0-AUTH-BAD", "fase0", "autenticacion", "Credenciales incorrectas", invalid, "HTTP 401", lambda r: r["status"] == 401)

        denied = request("POST", f"{base}/auth/login", json_body={"email": "usuario-denegado@tfm.local", "password": "demo123"}, headers={"Origin": origin})
        self.check("F0-AUTH-DENIED-LOGIN", "fase0", "autenticacion", "Login del usuario sin entitlement", denied, "HTTP 200", lambda r: r["status"] == 200)
        denied_token = denied["body"]["accessToken"]

        config = request("POST", f"{base}/playback/config", json_body={"assetId": "shaka-widevine"}, headers={**bearer(access_token, origin=origin)})
        self.check("F0-CONFIG-OK", "fase0", "reproduccion", "Configuración Widevine autorizada", config, "HTTP 200", lambda r: r["status"] == 200)

        denied_config = request("POST", f"{base}/playback/config", json_body={"assetId": "shaka-widevine"}, headers={**bearer(denied_token, origin=origin)})
        self.check("F0-CONFIG-DENIED", "fase0", "autorizacion", "Usuario sin entitlement solicita configuración", denied_config, "HTTP 403", lambda r: r["status"] == 403)

        platform_no_token = request("POST", f"{base}/platform/license", binary_body=b"tfm-test", headers={"Content-Type": "application/octet-stream", "Origin": origin})
        self.check("F0-LICENSE-PROTECTED", "fase0", "licencia", "Ruta oficial de licencia sin token", platform_no_token, "HTTP 401", lambda r: r["status"] == 401)

        public_license = request("POST", f"{base}/license/no_auth", binary_body=b"tfm-test", headers={"Content-Type": "application/octet-stream", "Origin": "http://localhost:3001"})
        self.check(
            "F0-LICENSE-BYPASS",
            "fase0",
            "bypass",
            "Ruta pública de licencia sin autenticación",
            public_license,
            "Ruta alcanzable sin 401/403/404 y marcada como debilidad",
            lambda r: r["status"] not in {None, 401, 403, 404} and r["headers"].get("x-phase0-weakness") == "public-no-auth-license",
        )

        direct_origin = request("GET", "http://localhost:8081/dash-known-key/stream.mpd")
        self.check("F0-ORIGIN-DIRECT", "fase0", "topologia", "Acceso directo al origen publicado", direct_origin, "HTTP 200", lambda r: r["status"] == 200)

        direct_license = request("GET", "http://localhost:8082/health")
        self.check("F0-LICENSE-DIRECT", "fase0", "topologia", "Acceso directo al servidor de licencias publicado", direct_license, "HTTP 200", lambda r: r["status"] == 200)

        clearkey_mpd = request("GET", f"{base}/content/dash-known-key/stream.mpd")
        self.check("F0-CLEARKEY-MPD", "fase0", "contenido", "MPD CENC local sin token", clearkey_mpd, "HTTP 200", lambda r: r["status"] == 200)

    def protected_baseline(self, phase: str) -> None:
        if phase == "fase1":
            reset_phase1()
        else:
            reset_phase2()
        base = PHASES[phase]["base"]
        origin = PHASES[phase]["origin"]
        prefix = "F1" if phase == "fase1" else "F2"
        device_id = f"eval-{phase}-baseline"

        health = request("GET", f"{base}/health")
        self.check(f"{prefix}-HEALTH", phase, "disponibilidad", "Health del plano de control", health, "HTTP 200", lambda r: r["status"] == 200)

        allowed = request("POST", f"{base}/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "demo123", "deviceId": device_id}, headers={"Origin": origin})
        self.check(f"{prefix}-AUTH-OK", phase, "autenticacion", "Login del usuario autorizado", allowed, "HTTP 200", lambda r: r["status"] == 200)
        access_token = allowed["body"]["accessToken"]

        invalid = request("POST", f"{base}/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "incorrecta", "deviceId": f"{device_id}-bad"}, headers={"Origin": origin})
        self.check(f"{prefix}-AUTH-BAD", phase, "autenticacion", "Credenciales incorrectas", invalid, "HTTP 401", lambda r: r["status"] == 401)

        denied = request("POST", f"{base}/auth/login", json_body={"email": "usuario-denegado@tfm.local", "password": "demo123", "deviceId": f"{device_id}-denied"}, headers={"Origin": origin})
        self.check(f"{prefix}-DENIED-LOGIN", phase, "autenticacion", "Login del usuario sin entitlement", denied, "HTTP 200", lambda r: r["status"] == 200)
        denied_token = denied["body"]["accessToken"]
        denied_session = request("POST", f"{base}/playback/session", json_body={"assetId": "sintel-widevine"}, headers={**bearer(denied_token, origin=origin)})
        self.check(f"{prefix}-DENIED-SESSION", phase, "autorizacion", "Usuario sin entitlement crea sesión", denied_session, "HTTP 403", lambda r: r["status"] == 403)

        if phase == "fase2":
            denied_admin = request("GET", f"{base}/admin/overview", headers={**bearer(denied_token, origin=origin)})
            self.check("F2-DENIED-ADMIN", phase, "administracion", "Usuario sin rol accede a observabilidad", denied_admin, "HTTP 403", lambda r: r["status"] == 403)

        session = request("POST", f"{base}/playback/session", json_body={"assetId": "sintel-widevine"}, headers={**bearer(access_token, origin=origin)})
        self.check(f"{prefix}-SESSION-OK", phase, "sesion", "Primera sesión de reproducción", session, "HTTP 201", lambda r: r["status"] == 201)
        playback_token = session["body"]["playbackToken"]
        session_id = session["body"]["session"]["sessionId"]

        concurrent = request("POST", f"{base}/playback/session", json_body={"assetId": "sintel-widevine"}, headers={**bearer(access_token, origin=origin)})
        self.check(f"{prefix}-CONCURRENCY", phase, "concurrencia", "Segunda sesión simultánea", concurrent, "HTTP 409 CONCURRENCY_LIMIT", lambda r: r["status"] == 409 and (r["body"] or {}).get("error") == "CONCURRENCY_LIMIT")

        manifest_no_token = request("GET", f"{base}/manifest/sintel-widevine", headers={"Origin": origin})
        self.check(f"{prefix}-MANIFEST-NO-TOKEN", phase, "manifest", "Manifest sin token", manifest_no_token, "HTTP 401", lambda r: r["status"] == 401)

        altered = request("GET", f"{base}/manifest/sintel-widevine", headers={**bearer(f"{playback_token}x", session_id, origin)})
        self.check(f"{prefix}-MANIFEST-ALTERED", phase, "manifest", "Manifest con token alterado", altered, "HTTP 401", lambda r: r["status"] == 401)

        wrong_session = request("GET", f"{base}/manifest/sintel-widevine", headers={**bearer(playback_token, "wrong-session", origin)})
        self.check(f"{prefix}-MANIFEST-WRONG-SESSION", phase, "binding", "Manifest con sesión distinta", wrong_session, "HTTP 409", lambda r: r["status"] == 409)

        wrong_asset = request("GET", f"{base}/manifest/otro-activo", headers={**bearer(playback_token, session_id, origin)})
        self.check(f"{prefix}-MANIFEST-WRONG-ASSET", phase, "binding", "Manifest de otro activo", wrong_asset, "HTTP 403", lambda r: r["status"] == 403)

        manifest_ok = request("GET", f"{base}/manifest/sintel-widevine", headers={**bearer(playback_token, session_id, origin)})
        self.check(f"{prefix}-MANIFEST-OK", phase, "manifest", "Manifest protegido legítimo", manifest_ok, "HTTP 200 DASH", lambda r: r["status"] == 200 and "dash+xml" in r["headers"].get("content-type", ""))

        content_no_token = request("GET", f"{base}/content/dash-known-key/stream.mpd", headers={"Origin": origin})
        self.check(f"{prefix}-CONTENT-NO-TOKEN", phase, "contenido", "Contenido local sin token", content_no_token, "HTTP 401", lambda r: r["status"] == 401)

        content_wrong_asset = request("GET", f"{base}/content/dash-known-key/stream.mpd", headers={**bearer(playback_token, session_id, origin)})
        self.check(f"{prefix}-CONTENT-WRONG-ASSET", phase, "binding", "Token Widevine intenta contenido de otro activo", content_wrong_asset, "HTTP 403", lambda r: r["status"] == 403)

        license_no_token = request("POST", f"{base}/license", binary_body=b"tfm-test", headers={"Content-Type": "application/octet-stream", "Origin": origin})
        self.check(f"{prefix}-LICENSE-NO-TOKEN", phase, "licencia", "Licencia sin token", license_no_token, "HTTP 401", lambda r: r["status"] == 401)

        license_wrong_session = request("POST", f"{base}/license", binary_body=b"tfm-test", headers={**bearer(playback_token, "wrong-session", origin), "Content-Type": "application/octet-stream"})
        self.check(f"{prefix}-LICENSE-WRONG-SESSION", phase, "binding", "Licencia con sesión distinta", license_wrong_session, "HTTP 409", lambda r: r["status"] == 409)

        no_auth_without_token = request("POST", f"{base}/license/no_auth", binary_body=b"tfm-test", headers={"Content-Type": "application/octet-stream", "Origin": origin})
        self.check(f"{prefix}-NO-AUTH-UNAUTH", phase, "superficie", "Ruta heredada sin token", no_auth_without_token, "HTTP 401", lambda r: r["status"] == 401)

        no_auth_with_token = request("POST", f"{base}/license/no_auth", binary_body=b"tfm-test", headers={**bearer(playback_token, session_id, origin), "Content-Type": "application/octet-stream"})
        self.check(f"{prefix}-NO-AUTH-REMOVED", phase, "superficie", "Ruta heredada con token válido", no_auth_with_token, "HTTP 404", lambda r: r["status"] == 404)

        stop = request("POST", f"{base}/playback/stop", headers={**bearer(playback_token, session_id, origin)})
        self.check(f"{prefix}-STOP", phase, "sesion", "Parada explícita", stop, "HTTP 200", lambda r: r["status"] == 200)

        after_stop = request("GET", f"{base}/manifest/sintel-widevine", headers={**bearer(playback_token, session_id, origin)})
        self.check(f"{prefix}-TOKEN-AFTER-STOP", phase, "revocacion", "Token después de detener sesión", after_stop, "HTTP 401", lambda r: r["status"] == 401)

    def phase2_concurrency(self) -> None:
        reset_phase2()
        base = PHASES["fase2"]["base"]
        origin = PHASES["fase2"]["origin"]
        device_id = "eval-fase2-concurrency"
        login = request("POST", f"{base}/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "demo123", "deviceId": device_id}, headers={"Origin": origin})
        access_token = login["body"]["accessToken"]
        session = request("POST", f"{base}/playback/session", json_body={"assetId": "sintel-widevine"}, headers={**bearer(access_token, origin=origin)})
        playback_token = session["body"]["playbackToken"]
        session_id = session["body"]["session"]["sessionId"]

        attempts: list[dict[str, Any]] = []
        scores: list[int] = []
        for index in range(1, 6):
            response = request("POST", f"{base}/playback/session", json_body={"assetId": "sintel-widevine"}, headers={**bearer(access_token, origin=origin)})
            overview = request("GET", f"{base}/admin/overview", headers={**bearer(access_token, origin=origin)})
            score = overview["body"]["overview"]["risk"]["score"]
            scores.append(score)
            attempts.append({"attempt": index, "status": response["status"], "error": (response["body"] or {}).get("error"), "score": score})

        self.synthetic(
            "F2-CONCURRENCY-SCORE",
            "fase2",
            "deteccion",
            "Cinco rechazos de concurrencia elevan el score",
            "409 en los cinco intentos y score 0/25/50/75/100",
            {"attempts": attempts, "scoreProgression": scores},
            all(item["status"] == 409 and item["error"] == "CONCURRENCY_LIMIT" for item in attempts) and scores == [0, 25, 50, 75, 100],
        )

        overview = request("GET", f"{base}/admin/overview", headers={**bearer(access_token, origin=origin)})
        bans = overview["body"]["overview"]["bans"]
        account_ban = next((ban for ban in bans if ban.get("type") == "account"), None)
        self.synthetic(
            "F2-CONCURRENCY-BAN",
            "fase2",
            "respuesta",
            "Ban automático de cuenta al llegar a 100",
            "AUTO_BAN:REPEATED_CONCURRENCY_VIOLATION",
            account_ban,
            bool(account_ban and account_ban.get("reason") == "AUTO_BAN:REPEATED_CONCURRENCY_VIOLATION"),
        )

        manifest_after_ban = request("GET", f"{base}/manifest/sintel-widevine", headers={**bearer(playback_token, session_id, origin)})
        self.check("F2-CONCURRENCY-MANIFEST-BLOCKED", "fase2", "respuesta", "Manifest tras ban de cuenta", manifest_after_ban, "HTTP 401", lambda r: r["status"] == 401)

        clear = request("POST", f"{base}/admin/bans/clear", json_body={"type": "account", "subjectId": "acc-allowed-001"}, headers={**bearer(access_token, origin=origin)})
        self.check("F2-CONCURRENCY-CLEAR", "fase2", "recuperacion", "Retirada administrativa del ban de cuenta", clear, "HTTP 200", lambda r: r["status"] == 200)
        heartbeat = request("POST", f"{base}/playback/heartbeat", headers={**bearer(playback_token, session_id, origin)})
        self.check("F2-CONCURRENCY-RECOVER", "fase2", "recuperacion", "Heartbeat tras retirar ban", heartbeat, "HTTP 200", lambda r: r["status"] == 200)
        renewed_token = heartbeat["body"].get("playbackToken") if heartbeat["status"] == 200 else playback_token
        request("POST", f"{base}/playback/stop", headers={**bearer(renewed_token, session_id, origin)})

    def phase2_device_ban(self) -> None:
        reset_phase2()
        base = PHASES["fase2"]["base"]
        origin = PHASES["fase2"]["origin"]
        device_id = "eval-fase2-device-ban"
        login = request("POST", f"{base}/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "demo123", "deviceId": device_id}, headers={"Origin": origin})
        access_token = login["body"]["accessToken"]
        session = request("POST", f"{base}/playback/session", json_body={"assetId": "sintel-widevine"}, headers={**bearer(access_token, origin=origin)})
        playback_token = session["body"]["playbackToken"]
        session_id = session["body"]["session"]["sessionId"]

        statuses: list[int | None] = []
        for index in range(1, 9):
            failed = request("POST", f"{base}/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": f"incorrecta-{index}", "deviceId": device_id}, headers={"Origin": origin})
            statuses.append(failed["status"])
        self.synthetic("F2-AUTH-BURST", "fase2", "deteccion", "Ocho fallos de autenticación del mismo dispositivo", "Ocho respuestas HTTP 401", {"statuses": statuses}, statuses == [401] * 8)

        overview = request("GET", f"{base}/admin/overview", headers={**bearer(access_token, origin=origin)})
        bans = overview["body"]["overview"]["bans"]
        device_ban = next((ban for ban in bans if ban.get("type") == "device"), None)
        self.synthetic("F2-DEVICE-BAN", "fase2", "respuesta", "Ban de dispositivo por ráfaga de fallos", "AUTH_FAILURE_BURST", device_ban, bool(device_ban and device_ban.get("reason") == "AUTH_FAILURE_BURST"))

        blocked = request("GET", f"{base}/manifest/sintel-widevine", headers={**bearer(playback_token, session_id, origin)})
        self.check("F2-DEVICE-MANIFEST-BLOCKED", "fase2", "respuesta", "Manifest tras ban de dispositivo", blocked, "HTTP 401", lambda r: r["status"] == 401)

        clear = request("POST", f"{base}/admin/bans/clear", json_body={"type": "device", "subjectId": device_id}, headers={**bearer(access_token, origin=origin)})
        self.check("F2-DEVICE-CLEAR", "fase2", "recuperacion", "Retirada administrativa del ban de dispositivo", clear, "HTTP 200", lambda r: r["status"] == 200)
        heartbeat = request("POST", f"{base}/playback/heartbeat", headers={**bearer(playback_token, session_id, origin)})
        self.check("F2-DEVICE-RECOVER", "fase2", "recuperacion", "Heartbeat tras retirar ban", heartbeat, "HTTP 200", lambda r: r["status"] == 200)
        renewed_token = heartbeat["body"].get("playbackToken") if heartbeat["status"] == 200 else playback_token
        request("POST", f"{base}/playback/stop", headers={**bearer(renewed_token, session_id, origin)})

    def topology(self) -> None:
        targets = {
            "fase0": ["tfm-origin", "tfm-license-server"],
            "fase1": ["tfm-fase1-origin", "tfm-fase1-license-server", "tfm-fase1-control-plane"],
            "fase2": ["tfm-fase2-origin", "tfm-fase2-license-server", "tfm-fase2-control-plane", "tfm-fase2-redis"],
        }
        for phase, containers in targets.items():
            observed: dict[str, Any] = {}
            for container in containers:
                output = run_command(["docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", container])
                observed[container] = json.loads(output)
            if phase == "fase0":
                passed = any(value for ports in observed.values() for value in ports.values())
                expected = "Origen y licencia con bindings publicados"
            else:
                passed = all(not value for ports in observed.values() for value in ports.values())
                expected = "Sin bindings publicados para servicios internos"
            self.synthetic(f"{phase.upper()}-TOPOLOGY", phase, "topologia", "Publicación de servicios internos", expected, observed, passed)

    def run(self) -> dict[str, Any]:
        self.phase0()
        self.protected_baseline("fase1")
        self.protected_baseline("fase2")
        self.phase2_concurrency()
        self.phase2_device_ban()
        self.topology()
        passed = sum(1 for result in self.results if result["passed"])
        return {
            "generatedAt": utc_now(),
            "host": {"platform": platform.platform(), "python": sys.version.split()[0]},
            "summary": {"total": len(self.results), "passed": passed, "failed": len(self.results) - passed},
            "results": self.results,
        }


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def run_metrics(iterations: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw: list[dict[str, Any]] = []

    def sample(phase: str, operation: str, iteration: int, response: dict[str, Any], expected_status: int) -> None:
        raw.append(
            {
                "phase": phase,
                "operation": operation,
                "iteration": iteration,
                "status": response["status"],
                "success": response["status"] == expected_status,
                "duration_ms": response["durationMs"],
            }
        )

    reset_phase0()
    for iteration in range(1, iterations + 1):
        login = request("POST", "http://localhost:8080/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "demo123"}, headers={"Origin": "http://localhost:3000"})
        sample("fase0", "login", iteration, login, 200)
        token = login["body"]["accessToken"]
        config = request("POST", "http://localhost:8080/playback/config", json_body={"assetId": "shaka-widevine"}, headers=bearer(token, origin="http://localhost:3000"))
        sample("fase0", "autorizar_reproduccion", iteration, config, 200)

    reset_phase1()
    for iteration in range(1, iterations + 1):
        origin = "http://localhost:9301"
        login = request("POST", "http://localhost:9080/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "demo123", "deviceId": f"metric-f1-{iteration}"}, headers={"Origin": origin})
        sample("fase1", "login", iteration, login, 200)
        access_token = login["body"]["accessToken"]
        session = request("POST", "http://localhost:9080/playback/session", json_body={"assetId": "sintel-widevine"}, headers=bearer(access_token, origin=origin))
        sample("fase1", "autorizar_reproduccion", iteration, session, 201)
        playback_token = session["body"]["playbackToken"]
        session_id = session["body"]["session"]["sessionId"]
        manifest = request("GET", "http://localhost:9080/manifest/sintel-widevine", headers=bearer(playback_token, session_id, origin))
        sample("fase1", "manifest", iteration, manifest, 200)
        heartbeat = request("POST", "http://localhost:9080/playback/heartbeat", headers=bearer(playback_token, session_id, origin))
        sample("fase1", "heartbeat", iteration, heartbeat, 200)
        playback_token = heartbeat["body"].get("playbackToken", playback_token)
        stop = request("POST", "http://localhost:9080/playback/stop", headers=bearer(playback_token, session_id, origin))
        sample("fase1", "detener_sesion", iteration, stop, 200)

    for iteration in range(1, iterations + 1):
        reset_phase2()
        origin = "http://localhost:9401"
        login = request("POST", "http://localhost:9180/auth/login", json_body={"email": "usuario-permitido@tfm.local", "password": "demo123", "deviceId": f"metric-f2-{iteration}"}, headers={"Origin": origin})
        sample("fase2", "login", iteration, login, 200)
        access_token = login["body"]["accessToken"]
        session = request("POST", "http://localhost:9180/playback/session", json_body={"assetId": "sintel-widevine"}, headers=bearer(access_token, origin=origin))
        sample("fase2", "autorizar_reproduccion", iteration, session, 201)
        playback_token = session["body"]["playbackToken"]
        session_id = session["body"]["session"]["sessionId"]
        manifest = request("GET", "http://localhost:9180/manifest/sintel-widevine", headers=bearer(playback_token, session_id, origin))
        sample("fase2", "manifest", iteration, manifest, 200)
        heartbeat = request("POST", "http://localhost:9180/playback/heartbeat", headers=bearer(playback_token, session_id, origin))
        sample("fase2", "heartbeat", iteration, heartbeat, 200)
        playback_token = heartbeat["body"].get("playbackToken", playback_token)
        stop = request("POST", "http://localhost:9180/playback/stop", headers=bearer(playback_token, session_id, origin))
        sample("fase2", "detener_sesion", iteration, stop, 200)

    summary: list[dict[str, Any]] = []
    groups = sorted({(item["phase"], item["operation"]) for item in raw})
    for phase, operation in groups:
        items = [item for item in raw if item["phase"] == phase and item["operation"] == operation]
        values = [float(item["duration_ms"]) for item in items]
        summary.append(
            {
                "phase": phase,
                "operation": operation,
                "samples": len(values),
                "successes": sum(1 for item in items if item["success"]),
                "mean_ms": round(statistics.fmean(values), 3),
                "median_ms": round(statistics.median(values), 3),
                "p95_ms": round(percentile(values, 0.95), 3),
                "min_ms": round(min(values), 3),
                "max_ms": round(max(values), 3),
                "stddev_ms": round(statistics.pstdev(values), 3),
            }
        )
    return raw, summary


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="mode", required=True)
    subparsers.add_parser("functional")
    metrics_parser = subparsers.add_parser("metrics")
    metrics_parser.add_argument("--iterations", type=int, default=20)
    arguments = parser.parse_args()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    if arguments.mode == "functional":
        report = FunctionalSuite().run()
        write_json(RESULTS_DIR / "resultados_funcionales.json", report)
        csv_rows = [
            {
                "id": item["id"],
                "phase": item["phase"],
                "category": item["category"],
                "description": item["description"],
                "expected": item["expected"],
                "passed": item["passed"],
                "status": item.get("observed", {}).get("status") if isinstance(item.get("observed"), dict) else None,
            }
            for item in report["results"]
        ]
        write_csv(RESULTS_DIR / "resultados_funcionales.csv", csv_rows)
        print(json.dumps(report["summary"], ensure_ascii=False))
        return 0 if report["summary"]["failed"] == 0 else 2

    raw, summary = run_metrics(arguments.iterations)
    write_csv(RESULTS_DIR / "metricas_raw.csv", raw)
    write_csv(RESULTS_DIR / "metricas_resumen.csv", summary)
    write_json(
        RESULTS_DIR / "metricas_resumen.json",
        {"generatedAt": utc_now(), "iterations": arguments.iterations, "summary": summary},
    )
    failures = sum(1 for item in raw if not item["success"])
    print(json.dumps({"samples": len(raw), "failed": failures}, ensure_ascii=False))
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
