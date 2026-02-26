#!/usr/bin/env python3
"""
Wazuh-to-TheHive Integration Script (custom-w2thive.py)

This script is called by the Wazuh Manager's active response system when an
alert meets the configured threshold (level 7+). It creates a TheHive alert
with extracted observables for analyst triage.

Deployed as a ConfigMap and mounted into the Wazuh Manager pod at:
  /var/ossec/integrations/custom-w2thive.py

Wazuh calls this script with:
  python3 custom-w2thive.py <alert_file> <api_key> <hook_url>
"""

import json
import logging
import sys
import os
import requests
from datetime import datetime

# Configure logging to Wazuh integration log
LOG_FILE = "/var/ossec/logs/integrations.log"
logging.basicConfig(
    filename=LOG_FILE if os.path.exists(os.path.dirname(LOG_FILE)) else None,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [w2thive] %(message)s",
)
log = logging.getLogger("w2thive")

# Severity mapping: Wazuh alert level -> TheHive severity
SEVERITY_MAP = {
    range(1, 7): 1,    # Low
    range(7, 10): 1,   # Low
    range(10, 13): 2,  # Medium
    range(13, 15): 3,  # High
    range(15, 16): 4,  # Critical (Wazuh max is 15)
}


def get_severity(level: int) -> int:
    """Map Wazuh alert level to TheHive severity."""
    for level_range, severity in SEVERITY_MAP.items():
        if level in level_range:
            return severity
    return 2  # Default: Medium


def extract_observables(alert_data: dict) -> list:
    """Extract observables (IOCs) from Wazuh alert JSON."""
    observables = []
    data = alert_data.get("data", {})

    # Source IP
    if data.get("srcip"):
        observables.append({
            "dataType": "ip",
            "data": data["srcip"],
            "message": "Source IP from Wazuh alert",
            "tags": ["wazuh", "source"]
        })

    # Destination IP
    if data.get("dstip"):
        observables.append({
            "dataType": "ip",
            "data": data["dstip"],
            "message": "Destination IP from Wazuh alert",
            "tags": ["wazuh", "destination"]
        })

    # URL
    if data.get("url"):
        observables.append({
            "dataType": "url",
            "data": data["url"],
            "message": "URL from Wazuh alert",
            "tags": ["wazuh"]
        })

    # File hashes
    for hash_type in ["md5", "sha1", "sha256"]:
        if data.get(hash_type):
            observables.append({
                "dataType": "hash",
                "data": data[hash_type],
                "message": f"{hash_type.upper()} hash from Wazuh alert",
                "tags": ["wazuh", hash_type]
            })

    # Filename
    if data.get("filename"):
        observables.append({
            "dataType": "filename",
            "data": data["filename"],
            "message": "Filename from Wazuh alert",
            "tags": ["wazuh"]
        })

    # Username
    if data.get("srcuser"):
        observables.append({
            "dataType": "other",
            "data": data["srcuser"],
            "message": "Source username from Wazuh alert",
            "tags": ["wazuh", "username"]
        })

    return observables


def create_thehive_alert(hook_url: str, api_key: str, alert: dict):
    """Create a TheHive alert from a Wazuh alert."""
    rule = alert.get("rule", {})
    agent = alert.get("agent", {})
    level = rule.get("level", 5)

    # Build TheHive alert payload
    thehive_alert = {
        "title": f"[Wazuh] {rule.get('description', 'Unknown Alert')}",
        "description": (
            f"**Wazuh Alert (Level {level})**\n\n"
            f"- **Rule ID:** {rule.get('id', 'N/A')}\n"
            f"- **Rule Description:** {rule.get('description', 'N/A')}\n"
            f"- **Groups:** {', '.join(rule.get('groups', []))}\n"
            f"- **Agent:** {agent.get('name', 'N/A')} ({agent.get('id', 'N/A')})\n"
            f"- **Timestamp:** {alert.get('timestamp', 'N/A')}\n"
            f"- **Full Log:** {alert.get('full_log', 'N/A')[:500]}\n"
        ),
        "type": "wazuh-alert",
        "source": "Wazuh",
        "sourceRef": f"wazuh-{rule.get('id', '0')}-{alert.get('id', '0')}",
        "severity": get_severity(level),
        "tags": ["wazuh", f"level:{level}"] + rule.get("groups", []),
        "observables": extract_observables(alert),
    }

    # MITRE ATT&CK tags if present
    mitre = rule.get("mitre", {})
    if mitre.get("id"):
        thehive_alert["tags"].extend(
            [f"mitre:{tid}" for tid in mitre["id"]]
        )

    # Send to TheHive
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(
            f"{hook_url}/api/v1/alert",
            headers=headers,
            json=thehive_alert,
            timeout=10
        )

        if response.status_code in (200, 201):
            alert_id = response.json().get("_id", "unknown")
            log.info(f"TheHive alert created: {alert_id} (rule {rule.get('id', '?')})")
        else:
            log.error(
                f"TheHive returned {response.status_code}: {response.text[:200]}"
            )
    except requests.exceptions.Timeout:
        log.error(f"TheHive request timed out: {hook_url}")
    except requests.exceptions.ConnectionError as e:
        log.error(f"Cannot reach TheHive at {hook_url}: {e}")
    except Exception as e:
        log.error(f"Unexpected error sending to TheHive: {e}")


def main():
    """Entry point — called by Wazuh integration framework."""
    if len(sys.argv) < 4:
        print("Usage: custom-w2thive.py <alert_file> <api_key> <hook_url>")
        sys.exit(1)

    alert_file = sys.argv[1]
    api_key = sys.argv[2]
    hook_url = sys.argv[3]

    try:
        with open(alert_file, "r") as f:
            alert = json.load(f)
    except json.JSONDecodeError as e:
        log.error(f"Invalid JSON in alert file {alert_file}: {e}")
        sys.exit(1)
    except FileNotFoundError:
        log.error(f"Alert file not found: {alert_file}")
        sys.exit(1)

    create_thehive_alert(hook_url, api_key, alert)


if __name__ == "__main__":
    main()
