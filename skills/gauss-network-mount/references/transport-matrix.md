# Network mount transport matrix

Use this reference only after the target, path, data classification, and transport have been identified by the main skill.

## SSHFS: Mac user to Kali directory

Use for a single operator, development artifacts, or a controlled working directory. It avoids creating a server-side filesystem export and reuses SSH authorization, but it is not ideal for databases, high-throughput training data, or many concurrent writers.

Prerequisites:

- Tailscale peer is online and the target host key is already verified in `~/.ssh/known_hosts`.
- `ssh` works in batch mode for the selected user.
- macOS has an approved, compatible macFUSE/SSHFS installation; Kali has `sshfs`.

Default options are read-only, `reconnect`, bounded `ServerAliveInterval`/`ServerAliveCountMax`, strict host-key checking, and no credential on the command line. Do not use `sshfs` to mount a directory containing private keys or a live database.

## NFS: bounded read-mostly data export

Use when low overhead matters and the server owns the exported directory. On Kali, export a dedicated path such as `/srv/gauss-data`, not `/home` or `/`. Limit the export to the Mac's Tailscale IP or a deliberately narrow tailnet CIDR, use `root_squash`, and start with read-only options.

Before applying an export, back up `/etc/exports`, inspect the active interface and firewall, then verify with `exportfs -v` and a client-side mount probe. NFS access control is not a substitute for application authentication; keep sensitive data behind the approved storage boundary.

## SMB3: Mac-friendly shared files

Use when macOS Finder compatibility, named shares, or multi-user ACLs matter. On Kali, use a dedicated Samba share and account, restrict `hosts allow` to the private overlay, keep `read only = yes` unless a write workflow is approved, and store credentials in a host secret manager or mode-0600 file. Prefer SMB3; do not downgrade protocol versions to make an unknown server work.

On macOS, use Keychain-backed credentials or `mount_smbfs -N` only after verifying how the local Keychain is configured. Never put an SMB password in an `autofs` map, shell history, launchd plist, or repository file.

## Raw block devices and iSCSI

Do not make these automatic through this skill. A raw block device requires an ownership, locking, filesystem, backup, and recovery design. A mount that appears to work can still corrupt data if another host writes the same filesystem. Escalate to a storage-specific task with explicit operator approval.

## Private network boundary

Use the existing Tailscale/WireGuard overlay for transport. Tailscale Serve is for private TCP/HTTPS services on a tailnet, not a replacement for NFS/SMB/SSHFS filesystem semantics. Do not use Funnel or a public IP for disk access. Verify ACLs, peer identity, target listener, and data residency separately.
