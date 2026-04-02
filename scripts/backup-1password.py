#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""
1Password full vault backup — age-encrypted JSON to HomeLab.

Run manually: opbackup (alias)
Frequency: weekly (Uptime Kuma push monitor reminds if overdue at 8 days)

How it works:
  1. First op call triggers Touch ID (one fingerprint, session lasts ~10min)
  2. Exports every item from every accessible vault as JSON
  3. Encrypts in memory with age public key (private key in 1Password + paper)
  4. Rsyncs encrypted file to homelab — unencrypted data never touches disk
  5. Pushes success to Uptime Kuma

Recovery:
  op read "op://Private/backup-age-key/PRIVATE_KEY" \\
    | age -d -i - -o backup.json <file>.json.age
  # OR with paper key:
  echo "AGE-SECRET-KEY-..." | age -d -i - -o backup.json <file>.json.age

Pre-requisites:
  - 1Password desktop app installed + CLI enabled
  - age: brew install age
  - age keypair: private in op://Private/backup-age-key/PRIVATE_KEY + paper
  - Uptime Kuma push URL in op://homelab/config/1PASSWORD_BACKUP_PUSH_URL
  - Remote dir: ssh homelab "mkdir -p ~/backups/1password"
"""

import json, subprocess, sys, os, tempfile
from datetime import date

RECIPIENT = "age1eg6cypgrjv48urgvmxe9wua9d8a7x9e6jxt6w2phcfg46gxzpqdq9f3jke"  # public key — not a secret

def op_json(cmd: list[str]) -> ...:
    return json.loads(subprocess.check_output(["op"] + cmd))

def main():
    # Auth check — triggers biometric if 1Password desktop is unlocked
    try:
        subprocess.check_output(["op", "whoami"], stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        print("1Password not unlocked — open the app and retry")
        sys.exit(1)

    # Export all vaults
    vaults = op_json(["vault", "list", "--format", "json"])
    backup = {}
    total = 0
    for vault in vaults:
        vid, vname = vault["id"], vault["name"]
        items = op_json(["item", "list", "--vault", vid, "--format", "json"])
        vault_items = []
        for item in items:
            detail = op_json(["item", "get", item["id"], "--vault", vid, "--format", "json"])
            vault_items.append(detail)
        backup[vname] = vault_items
        total += len(vault_items)
        print(f"  {vname}: {len(vault_items)} items")

    # Encrypt → temp file (JSON never on disk unencrypted)
    json_bytes = json.dumps(backup, indent=2, ensure_ascii=False).encode()
    filename = f"1password-{date.today().isoformat()}.json.age"

    fd, tmp_path = tempfile.mkstemp(suffix=".age")
    os.close(fd)
    try:
        subprocess.run(
            ["age", "--encrypt", "--recipient", RECIPIENT, "-o", tmp_path],
            input=json_bytes, check=True
        )
        # rsync to homelab
        subprocess.run(
            ["rsync", "-az", tmp_path, f"homelab:~/backups/1password/{filename}"],
            check=True
        )
        # Push to Uptime Kuma
        push_url = subprocess.check_output(
            ["op", "read", "op://homelab/config/1PASSWORD_BACKUP_PUSH_URL"]
        ).decode().strip()
        subprocess.run(["curl", "-fsS", push_url], capture_output=True, check=True)

        size_kb = os.path.getsize(tmp_path) // 1024
        print(f"  Done: {total} items from {len(vaults)} vaults ({size_kb} KB) → homelab")
    finally:
        os.unlink(tmp_path)

if __name__ == "__main__":
    main()
