#!/usr/bin/env python3
"""
provision-relay-vps.py — Provision a Tiny LNVPS for Codedeck relay

Reuses LNVPS API functions from sovereign-agents/create_vm.py.

Usage:
    python3 codedeck/scripts/provision-relay-vps.py

Flow:
  1. Generate temp Nostr keypair + SSH keypair (for LNVPS auth)
  2. Upload SSH key to LNVPS
  3. Create Tiny VM (Ubuntu 24.04)
  4. Print Lightning invoice for payment
  5. Wait for payment + VM boot
  6. Print SSH command to run bootstrap
  7. Clean up SSH key from LNVPS
"""

import json
import os
import sys
import tempfile

# Add sovereign-agents to path for reuse
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(os.path.dirname(SCRIPT_DIR))
SA_DIR = os.path.join(WORKSPACE, "sovereign-agents")
sys.path.insert(0, SA_DIR)

from create_vm import (
    generate_temp_nostr_keypair,
    generate_ssh_keypair,
    lnvps_fetch_templates,
    lnvps_fetch_images,
    lnvps_upload_ssh_key,
    lnvps_create_vm,
    lnvps_wait_for_vm,
    lnvps_delete_ssh_key,
    log,
)


def main():
    log.info("=== Codedeck Relay VPS Provisioning ===")

    # 1. Generate temporary credentials
    log.info("Step 1: Generating temporary Nostr + SSH keypairs...")
    nostr_kp = generate_temp_nostr_keypair()
    ssh_kp = generate_ssh_keypair()
    privkey_hex = nostr_kp["private_key_hex"]
    log.info(f"  Temp Nostr pubkey: {nostr_kp['public_key_hex'][:16]}...")
    log.info(f"  Temp SSH pubkey: {ssh_kp['public_key_openssh'][:40]}...")

    # 2. Fetch templates to find "tiny"
    log.info("Step 2: Fetching LNVPS templates...")
    templates = lnvps_fetch_templates()
    tiny = templates.get("tiny")
    if not tiny:
        log.error("Could not find 'tiny' template. Available: %s", list(templates.keys()))
        sys.exit(1)
    log.info(f"  Using template: {tiny['label']} (id={tiny['template_id']})")

    # 3. Fetch Ubuntu image
    log.info("Step 3: Fetching Ubuntu image...")
    image_id = lnvps_fetch_images()
    if not image_id:
        log.error("Could not find Ubuntu image")
        sys.exit(1)
    log.info(f"  Using image id: {image_id}")

    # 4. Upload SSH key
    log.info("Step 4: Uploading SSH key to LNVPS...")
    ssh_key_id = lnvps_upload_ssh_key(
        privkey_hex, "codedeck-relay-temp", ssh_kp["public_key_openssh"]
    )

    # 5. Create VM
    log.info("Step 5: Creating Tiny VM...")
    result = lnvps_create_vm(privkey_hex, tiny["template_id"], image_id, ssh_key_id)
    vm_id = result["vm_id"]
    bolt11 = result.get("bolt11", "")

    if bolt11:
        log.info("")
        log.info("=" * 60)
        log.info("LIGHTNING INVOICE — Pay this to activate the VPS:")
        log.info("=" * 60)
        log.info(bolt11)
        log.info("=" * 60)
        log.info("")
    else:
        log.info(f"  VM created (id={vm_id}) but no invoice returned.")
        log.info("  The VM may already be paid, or check LNVPS dashboard.")

    # 6. Wait for VM to boot
    log.info("Step 6: Waiting for VM to boot (pay the invoice above)...")
    log.info("  Polling every 10s for up to 10 minutes...")
    vm_info = lnvps_wait_for_vm(privkey_hex, vm_id)
    ip = vm_info["ip"]

    log.info("")
    log.info("=" * 60)
    log.info(f"VM is running! IP: {ip}")
    log.info("=" * 60)

    # 7. Save SSH private key to temp file
    ssh_key_file = os.path.join(tempfile.gettempdir(), "codedeck-relay-ssh.key")
    with open(ssh_key_file, "w") as f:
        f.write(ssh_kp["private_key_pem"])
    os.chmod(ssh_key_file, 0o600)

    bootstrap_script = os.path.join(SCRIPT_DIR, "bootstrap-relay.sh")

    log.info("")
    log.info("Next steps — run these commands:")
    log.info("")
    log.info(f"  # Copy bootstrap script to VPS")
    log.info(f"  scp -i {ssh_key_file} -o StrictHostKeyChecking=no {bootstrap_script} root@{ip}:")
    log.info("")
    log.info(f"  # SSH in and run bootstrap")
    log.info(f"  ssh -i {ssh_key_file} -o StrictHostKeyChecking=no root@{ip} bash bootstrap-relay.sh")
    log.info("")
    log.info(f"  # Or do both in one shot:")
    log.info(f"  scp -i {ssh_key_file} -o StrictHostKeyChecking=no {bootstrap_script} root@{ip}: && ssh -i {ssh_key_file} -o StrictHostKeyChecking=no root@{ip} bash bootstrap-relay.sh")
    log.info("")
    log.info(f"  SSH key saved to: {ssh_key_file}")
    log.info(f"  (This key will be needed until you add your own SSH key to the VPS)")

    # 8. Clean up SSH key from LNVPS (not from VPS — it's still needed)
    log.info("")
    log.info("Step 7: Cleaning up SSH key from LNVPS API...")
    lnvps_delete_ssh_key(privkey_hex, ssh_key_id)

    log.info("")
    log.info("Done! VM id=%s, IP=%s", vm_id, ip)

    # Save VM info for reference
    info_file = os.path.join(SCRIPT_DIR, "relay-vps-info.json")
    with open(info_file, "w") as f:
        json.dump({"vm_id": vm_id, "ip": ip, "ssh_key_file": ssh_key_file}, f, indent=2)
    log.info(f"VM info saved to: {info_file}")


if __name__ == "__main__":
    main()
