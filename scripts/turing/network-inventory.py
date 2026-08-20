#!/usr/bin/env python3
"""Collect a bounded, operator-visible network inventory for a Turing node.

Passive interface/route/neighbor facts are collected locally. Active TCP checks
only run when an operator supplies an explicit CIDR and port allow-list plus an
approval flag. This helper never grabs banners, reads credentials, or changes
routes/firewalls.
"""

from __future__ import annotations

import datetime as dt
import ipaddress
import json
import os
import re
import socket
import subprocess
import time
from typing import Any


MAX_ERRORS = 32
MAX_STRING = 160


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    return value not in {"0", "false", "off", "no", "disabled"}


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip())
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def clean(value: Any, limit: int = MAX_STRING) -> str | None:
    if not isinstance(value, str):
        return None
    value = re.sub(r"[\x00-\x1f\x7f]", "", value).strip()
    return value[:limit] or None


def run_command(args: list[str], errors: list[str], timeout: float = 2.0) -> Any:
    try:
        result = subprocess.run(args, check=False, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"{args[0]}: {type(exc).__name__}")
        return None
    if result.returncode != 0:
        errors.append(f"{args[0]}: exit_{result.returncode}")
        return None
    try:
        return json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError):
        errors.append(f"{args[0]}: invalid_json")
        return None


def collect_interfaces(errors: list[str]) -> list[dict[str, Any]]:
    data = run_command(["ip", "-j", "addr"], errors)
    interfaces: list[dict[str, Any]] = []
    if isinstance(data, list):
        for item in data[:32]:
            if not isinstance(item, dict):
                continue
            name = clean(item.get("ifname"), 80)
            if not name:
                continue
            addresses: list[str] = []
            cidrs: list[str] = []
            for info in item.get("addr_info", []) if isinstance(item.get("addr_info"), list) else []:
                if not isinstance(info, dict):
                    continue
                local = clean(info.get("local"), 80)
                prefix = info.get("prefixlen")
                if local:
                    addresses.append(local)
                    if isinstance(prefix, int) and 0 <= prefix <= 128:
                        try:
                            cidrs.append(str(ipaddress.ip_interface(f"{local}/{prefix}").network))
                        except ValueError:
                            pass
            interfaces.append({"name": name, "up": item.get("operstate") == "UP", "addresses": addresses[:32], "network_cidrs": cidrs[:32]})
        return interfaces

    # macOS/BSD fallback. This deliberately captures only interface names and
    # addresses; ifconfig output can contain link-layer identifiers, which are
    # not part of the inventory contract.
    raw = run_text_command(["ifconfig"], errors)
    if raw is None:
        return interfaces
    discard_optional_command_error(errors, "ip")
    current: dict[str, Any] | None = None
    for line in raw.splitlines():
        header = re.match(r"^([^\s:]+):\s+flags=", line)
        if header:
            if current:
                interfaces.append(current)
            current = {"name": header.group(1)[:80], "up": False, "addresses": [], "network_cidrs": []}
        if current is None:
            continue
        if "UP" in line.split("<", 1)[-1].split(">", 1)[0]:
            current["up"] = True
        match = re.search(r"\binet6?\s+([^\s/]+)(?:/(\d+))?", line)
        if match:
            address = match.group(1)
            current["addresses"].append(address)
            if match.group(2):
                try:
                    current["network_cidrs"].append(str(ipaddress.ip_interface(f"{address}/{match.group(2)}").network))
                except ValueError:
                    pass
    if current:
        interfaces.append(current)
    return interfaces[:32]


def run_text_command(args: list[str], errors: list[str], timeout: float = 2.0) -> str | None:
    try:
        result = subprocess.run(args, check=False, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"{args[0]}: {type(exc).__name__}")
        return None
    if result.returncode != 0:
        errors.append(f"{args[0]}: exit_{result.returncode}")
        return None
    return result.stdout


def discard_optional_command_error(errors: list[str], command: str) -> None:
    """The Linux `ip` command is optional when the BSD/macOS fallback works."""
    errors[:] = [error for error in errors if error != f"{command}: FileNotFoundError"]


def collect_routes(errors: list[str]) -> list[dict[str, Any]]:
    data = run_command(["ip", "-j", "route"], errors)
    routes: list[dict[str, Any]] = []
    if isinstance(data, list):
        for item in data[:256]:
            if not isinstance(item, dict):
                continue
            destination = clean(item.get("dst"), 80) or "default"
            routes.append({"destination": destination, "gateway": clean(item.get("gateway"), 80), "interface": clean(item.get("dev"), 80)})
        return routes
    raw = run_text_command(["netstat", "-rn"], errors)
    if raw is None:
        return routes
    discard_optional_command_error(errors, "ip")
    for line in raw.splitlines():
        fields = line.split()
        if len(fields) < 3 or fields[0].lower() in {"destination", "routing", "internet6"}:
            continue
        destination = clean(fields[0], 80)
        gateway = clean(fields[1], 80)
        interface = clean(fields[-1], 80) if len(fields) >= 4 else None
        if destination and gateway:
            routes.append({"destination": destination, "gateway": None if gateway.startswith("<") else gateway, "interface": interface})
            if len(routes) >= 256:
                break
    return routes


def collect_neighbors(errors: list[str]) -> list[dict[str, Any]]:
    data = run_command(["ip", "-j", "neigh"], errors)
    neighbors: list[dict[str, Any]] = []
    if isinstance(data, list):
        for item in data[:256]:
            if not isinstance(item, dict):
                continue
            address = clean(item.get("dst"), 80)
            if address:
                neighbors.append({"address": address, "interface": clean(item.get("dev"), 80), "state": clean(item.get("state"), 40)})
        return neighbors
    raw = run_text_command(["arp", "-an"], errors)
    if raw is None:
        return neighbors
    discard_optional_command_error(errors, "ip")
    for line in raw.splitlines():
        match = re.search(r"\(([^)]+)\).*?\bon\s+(\S+)", line)
        if match:
            neighbors.append({"address": clean(match.group(1), 80), "interface": clean(match.group(2), 80), "state": None})
            if len(neighbors) >= 256:
                break
    return neighbors


def collect_overlay_peers(errors: list[str]) -> list[dict[str, Any]]:
    data = run_command(["tailscale", "status", "--json"], errors, timeout=3.0)
    if not isinstance(data, dict):
        return []
    peers = data.get("Peer")
    if not isinstance(peers, dict):
        return []
    result: list[dict[str, Any]] = []
    for peer in list(peers.values())[:256]:
        if not isinstance(peer, dict):
            continue
        addresses = peer.get("TailscaleIPs")
        address = next((clean(value, 80) for value in addresses if isinstance(value, str) and "." in value), None) if isinstance(addresses, list) else None
        if not address:
            continue
        result.append({
            "address": address,
            "hostname": clean(peer.get("HostName") or peer.get("DNSName"), 120),
            "online": peer.get("Online") if isinstance(peer.get("Online"), bool) else None,
            "platform": clean(peer.get("OS") or peer.get("ClientVersion"), 80),
            "last_seen": clean(peer.get("LastSeen"), 40),
        })
    return result


def parse_allowlist(raw: str, errors: list[str]) -> list[ipaddress._BaseNetwork]:
    networks: list[ipaddress._BaseNetwork] = []
    for entry in [item.strip() for item in raw.split(",") if item.strip()]:
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            errors.append("invalid_cidr")
    return networks[:64]


def parse_ports(raw: str, errors: list[str]) -> list[int]:
    ports: list[int] = []
    for entry in [item.strip() for item in raw.split(",") if item.strip()]:
        try:
            port = int(entry)
        except ValueError:
            errors.append("invalid_port")
            continue
        if 1 <= port <= 65535:
            ports.append(port)
        else:
            errors.append("port_out_of_range")
    return sorted(set(ports))[:64]


def collect_probes(errors: list[str], authorized: bool, max_targets: int, max_probes: int) -> list[dict[str, Any]]:
    if not authorized:
        return []
    networks = parse_allowlist(os.environ.get("TURING_NETWORK_DISCOVERY_CIDRS", ""), errors)
    ports = parse_ports(os.environ.get("TURING_NETWORK_DISCOVERY_PORTS", ""), errors)
    if not networks or not ports:
        errors.append("active_discovery_requires_cidr_and_port_allowlist")
        return []
    targets: list[str] = []
    for network in networks:
        for host in network.hosts():
            targets.append(str(host))
            if len(targets) >= max_targets:
                break
        if len(targets) >= max_targets:
            break
    probes: list[dict[str, Any]] = []
    for address in targets:
        for port in ports:
            if len(probes) >= max_probes:
                return probes
            started = time.monotonic()
            reachable = False
            try:
                with socket.create_connection((address, port), timeout=0.25):
                    reachable = True
            except OSError:
                pass
            latency = round((time.monotonic() - started) * 1000, 2)
            probes.append({"address": address, "port": port, "reachable": reachable, "latency_ms": latency})
    return probes


def main() -> None:
    errors: list[str] = []
    mode = os.environ.get("TURING_NETWORK_DISCOVERY_MODE", "passive").strip().lower()
    if mode not in {"passive", "approved"}:
        errors.append("invalid_discovery_mode")
        mode = "passive"
    approval_flag = env_bool("TURING_NETWORK_DISCOVERY_APPROVED", False)
    cidr_networks = parse_allowlist(os.environ.get("TURING_NETWORK_DISCOVERY_CIDRS", ""), errors)
    cidrs = [str(network) for network in cidr_networks]
    ports = parse_ports(os.environ.get("TURING_NETWORK_DISCOVERY_PORTS", ""), errors)
    authorized = mode == "passive" or (mode == "approved" and approval_flag and bool(cidrs) and bool(ports))
    if mode == "approved" and not authorized:
        errors.append("active_discovery_not_authorized")
    max_targets = env_int("TURING_NETWORK_DISCOVERY_MAX_TARGETS", 64, 1, 256)
    max_probes = env_int("TURING_NETWORK_DISCOVERY_MAX_PROBES", 128, 1, 512)
    inventory = {
        "observed_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "mode": mode,
        "authorized": authorized,
        "interfaces": collect_interfaces(errors),
        "routes": collect_routes(errors),
        "neighbors": collect_neighbors(errors),
        "overlay_peers": collect_overlay_peers(errors),
        "probes": collect_probes(errors, authorized and mode == "approved", max_targets, max_probes),
        "policy": {
            "allowed_cidrs": cidrs,
            "allowed_ports": ports,
            "max_targets": max_targets,
            "max_probes": max_probes,
            "truncated": False,
            "errors": list(dict.fromkeys(errors))[:MAX_ERRORS],
        },
    }
    print(json.dumps(inventory, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
