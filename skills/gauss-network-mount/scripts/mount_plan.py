#!/usr/bin/env python3
"""Render a fail-closed network mount plan; never performs a mount."""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import shutil
import socket
import sys
from pathlib import Path


TAILSCALE_V4 = ipaddress.ip_network("100.64.0.0/10")
TAILSCALE_V6 = ipaddress.ip_network("fd7a:115c:a1e0::/48")
PLATFORMS = {"macos", "linux"}
TRANSPORTS = {"sshfs", "nfs", "smb"}
SAFE_TOKEN = re.compile(r"^[A-Za-z0-9._:@%+~-]+$")
SAFE_USER = re.compile(r"^[A-Za-z0-9._-]+$")
FORBIDDEN_MOUNT_ROOTS = {"/", "/System", "/Library", "/Applications", "/private", "/etc", "/var"}


def is_tailnet_target(target: str) -> bool:
    try:
        address = ipaddress.ip_address(target)
    except ValueError:
        return target.endswith(".ts.net")
    return address in TAILSCALE_V4 or address in TAILSCALE_V6


def validate_target(target: str, require_tailnet: bool) -> list[str]:
    errors: list[str] = []
    if not target or not SAFE_TOKEN.fullmatch(target):
        errors.append("target must be a simple hostname, tailnet DNS name, or IP address")
    if require_tailnet and not is_tailnet_target(target):
        errors.append("target is not a Tailscale IP or *.ts.net name")
    return errors


def validate_remote_path(remote_path: str, transport: str) -> list[str]:
    errors: list[str] = []
    if not remote_path or "\x00" in remote_path or "\n" in remote_path or "\r" in remote_path:
        errors.append("remote path is empty or contains a forbidden control character")
    if ".." in Path(remote_path).parts:
        errors.append("remote path must not contain '..'")
    if transport in {"sshfs", "nfs"} and not remote_path.startswith("/"):
        errors.append(f"{transport} remote path must be absolute")
    if transport == "smb" and remote_path.startswith("/"):
        errors.append("SMB remote path must be a share name, not an absolute filesystem path")
    return errors


def validate_mount_point(mount_point: str) -> tuple[str, list[str]]:
    expanded = str(Path(mount_point).expanduser())
    errors: list[str] = []
    if not Path(expanded).is_absolute():
        errors.append("mount point must be absolute or use ~/...")
    if expanded in FORBIDDEN_MOUNT_ROOTS:
        errors.append("mount point is a protected system root")
    if ".." in Path(expanded).parts:
        errors.append("mount point must not contain '..'")
    return expanded, errors


def local_prerequisites(platform: str, transport: str) -> list[str]:
    commands = ["tailscale"]
    if transport == "sshfs":
        commands += ["ssh", "sshfs"]
    elif transport == "nfs":
        commands += ["mount"] if platform == "linux" else ["mount_nfs"]
    elif transport == "smb":
        commands += ["mount.cifs"] if platform == "linux" else ["mount_smbfs"]
    return [f"{command}: {'present' if shutil.which(command) else 'missing'}" for command in commands]


def protocol_port(transport: str) -> int:
    return {"sshfs": 22, "nfs": 2049, "smb": 445}[transport]


def probe_port(target: str, port: int) -> dict[str, object]:
    try:
        with socket.create_connection((target, port), timeout=2):
            return {"target": target, "port": port, "status": "reachable"}
    except (OSError, ValueError) as error:
        return {"target": target, "port": port, "status": "unreachable", "detail": str(error)}


def render_command(args: argparse.Namespace, mount_point: str) -> tuple[str, str]:
    safety = "ro,nosuid,nodev,noexec"
    if args.transport == "sshfs":
        source = f"{args.user}@{args.target}:{args.remote_path}"
        options = "reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,StrictHostKeyChecking=yes"
        if args.read_only:
            options = f"ro,{options}"
        if args.platform == "macos":
            options += ",defer_permissions,noappledouble"
        command = f"sshfs -o {options} {source} {mount_point}"
    elif args.transport == "nfs":
        options = safety if args.read_only else "nosuid,nodev,noexec"
        if args.platform == "linux":
            options += ",_netdev,x-systemd.automount,x-systemd.idle-timeout=300"
            command = f"mount -t nfs -o {options} {args.target}:{args.remote_path} {mount_point}"
        else:
            options += ",tcp"
            command = f"mount_nfs -o {options} {args.target}:{args.remote_path} {mount_point}"
    else:
        options = "vers=3.1.1,credentials=/path/to/0600/credential-file,_netdev,x-systemd.automount,nosuid,nodev,noexec"
        if args.read_only:
            options = f"ro,{options}"
        share = args.remote_path.strip("/")
        if args.platform == "linux":
            command = f"mount -t cifs //{args.target}/{share} {mount_point} -o {options}"
        else:
            command = f"mount_smbfs -N //{args.user}@{args.target}/{share} {mount_point}"
    return command, f"umount {mount_point}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a safe, non-executing network mount plan")
    parser.add_argument("--platform", choices=sorted(PLATFORMS), required=True)
    parser.add_argument("--transport", choices=sorted(TRANSPORTS), required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--remote-path", required=True)
    parser.add_argument("--mount-point", required=True)
    parser.add_argument("--user", default="pallas117")
    parser.add_argument("--read-only", action="store_true", default=True)
    parser.add_argument("--read-write", dest="read_only", action="store_false")
    parser.add_argument("--persistent", action="store_true")
    parser.add_argument("--require-tailnet", action="store_true", default=True)
    parser.add_argument("--no-require-tailnet", dest="require_tailnet", action="store_false")
    parser.add_argument("--probe", action="store_true", help="attempt a bounded TCP probe; still never mounts")
    parser.add_argument("--json", action="store_true", help="emit JSON; otherwise print the same report indented")
    args = parser.parse_args()

    errors = validate_target(args.target, args.require_tailnet)
    errors.extend(validate_remote_path(args.remote_path, args.transport))
    mount_point, mount_errors = validate_mount_point(args.mount_point)
    errors.extend(mount_errors)
    if not SAFE_USER.fullmatch(args.user):
        errors.append("user must contain only letters, digits, '.', '_', or '-'")

    command, unmount = render_command(args, mount_point)
    report: dict[str, object] = {
        "schema": "gauss-network-mount-plan-v1",
        "status": "blocked" if errors else "ready",
        "truth_state": "blocked" if errors else "inferred",
        "platform": args.platform,
        "transport": args.transport,
        "target": args.target,
        "remote_path": args.remote_path,
        "mount_point": mount_point,
        "read_only": args.read_only,
        "persistent": args.persistent,
        "requires_approval": True,
        "private_overlay_required": args.require_tailnet,
        "local_prerequisites": local_prerequisites(args.platform, args.transport),
        "commands": {"mount": command, "unmount": unmount},
        "verification": [
            "verify target peer and last handshake on the private overlay",
            "verify protocol-specific listener and host key/export ACL",
            f"verify mount options and path with findmnt or mount for {mount_point}",
            "test bounded reconnect and clean unmount",
        ],
        "errors": errors,
    }
    if args.probe and not errors:
        report["probe"] = probe_port(args.target, protocol_port(args.transport))
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
