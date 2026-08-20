# Automount templates

These are review templates, not commands to apply blindly. Confirm the local operating-system man pages, package versions, export ACLs, and mount options before use. Back up every system file before editing it.

## macOS autofs direct-map template for NFS

Use a dedicated map rather than changing an existing vendor map. The map should use a private Tailscale target and a read-only export:

```text
# /etc/auto_master — add only after approval and backup
/-    /etc/auto_gauss    -nobrowse
```

```text
# /etc/auto_gauss — direct-map example; replace placeholders after verification
/Users/<local-user>/Volumes/GaussData    -fstype=nfs,ro,nosuid,nodev,noowners,tcp    <tailscale-ip>:/srv/gauss-data
```

Create the mount directory, reload with the platform's `automount` command, and verify with `mount` and a bounded read. macOS option names and NFS behavior vary by release; check `man auto_master`, `man automount`, and `man mount_nfs` on the actual Mac.

For SMB, prefer a manually verified Finder/`mount_smbfs` mount and Keychain-backed credentials before attempting an `autofs` map. Do not place credentials in the map.

## macOS user SSHFS persistence

SSHFS persistence is more fragile than NFS/SMB because macFUSE can be unavailable during early login or after sleep. First validate a user-scoped manual mount. If persistence is still required, use a user LaunchAgent that invokes a checked-in wrapper with a fixed mount point, bounded retry/backoff, strict host-key checking, and an explicit unmount trap. Do not run SSHFS as root or create a system daemon that can mount arbitrary paths.

## Kali/Linux systemd automount template for NFS

For a dedicated read-only export, an `/etc/fstab` entry can be reviewed as:

```text
<tailscale-ip>:/srv/gauss-data  /mnt/gauss-data  nfs  ro,nosuid,nodev,noexec,_netdev,x-systemd.automount,x-systemd.idle-timeout=300  0  0
```

After approval, create the mount point, run `systemctl daemon-reload`, and verify with `findmnt`, `systemctl status mnt-gauss-data.automount`, and a read probe. Use a native `.mount`/`.automount` pair when a generated unit is easier to review than `fstab`.

## Kali/Linux systemd automount template for SMB3

Store the credential file outside the repository with mode `0600` and a dedicated share account:

```text
username=<share-user>
password=<stored-by-secret-manager>
domain=<optional-domain>
```

Review an entry like this only after the credential path and share ACL are verified:

```text
//<tailscale-ip>/<share>  /mnt/gauss-share  cifs  ro,vers=3.1.1,credentials=/etc/gauss/gauss-share.credentials,_netdev,x-systemd.automount,x-systemd.idle-timeout=300,nosuid,nodev,noexec  0  0
```

Do not copy the example password into a file. The placeholder means the secret manager must materialize it on the host with appropriate ownership and permissions.

## Verification and rollback

For every template:

1. Verify the target peer, listener, export/share, and ACL.
2. Mount read-only and verify the actual options.
3. Read a known harmless file and confirm a forbidden write fails.
4. Disconnect the overlay for a bounded interval and verify the client does not spin or corrupt local state.
5. Unmount, disable the automount entry, restore the configuration backup, and confirm the mount point is no longer active.
