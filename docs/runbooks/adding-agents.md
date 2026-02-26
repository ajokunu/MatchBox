# Runbook: Adding Wazuh Agents

## Overview
Wazuh agents collect logs and security data from monitored endpoints. The DonnieBot SOC supports two agent deployment models:

1. **DaemonSet agents** (in-cluster) — already deployed, monitor k3s nodes
2. **External agents** — monitor other devices on your home network

## Adding External Agents (Home Network Devices)

### Step 1: Get the Wazuh Manager Address
The manager is accessible from your LAN via Lima port forwarding:
- Registration: `<mac-mini-ip>:1515`
- Agent communication: `<mac-mini-ip>:1514`

Find your Mac Mini's IP:
```bash
ipconfig getifaddr en0
```

### Step 2: Install Agent on the Target Device

#### Linux (Ubuntu/Debian)
```bash
curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import && chmod 644 /usr/share/keyrings/wazuh.gpg

echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" | tee -a /etc/apt/sources.list.d/wazuh.list

apt-get update && apt-get install wazuh-agent

# Configure manager address
sed -i 's/MANAGER_IP/<mac-mini-ip>/g' /var/ossec/etc/ossec.conf

# Start agent
systemctl enable wazuh-agent && systemctl start wazuh-agent
```

#### macOS (the Mac Mini itself)
```bash
# Download macOS agent from Wazuh
curl -O https://packages.wazuh.com/4.x/macos/wazuh-agent-4.9.2-1.arm64.pkg
sudo installer -pkg wazuh-agent-4.9.2-1.arm64.pkg -target /

# Configure
sudo /Library/Ossec/bin/agent-auth -m 127.0.0.1 -p 1515

# Start
sudo /Library/Ossec/bin/wazuh-control start
```

#### Windows
1. Download installer from https://packages.wazuh.com/4.x/windows/wazuh-agent-4.9.2-1.msi
2. Run installer, set Manager IP to `<mac-mini-ip>`
3. Start service: `net start WazuhSvc`

### Step 3: Verify Agent Registration
```bash
# From macOS (via kubectl)
kubectl exec -n wazuh deployment/wazuh-manager -- /var/ossec/bin/agent_control -l
# Should list the new agent
```

### Step 4: Assign Agent to a Group
```bash
# Create a group for home network devices
kubectl exec -n wazuh deployment/wazuh-manager -- /var/ossec/bin/agent_groups -a -g home-network

# Assign agent to group
kubectl exec -n wazuh deployment/wazuh-manager -- /var/ossec/bin/agent_groups -a -i <agent-id> -g home-network
```

## Agent Groups
| Group | Purpose | Monitored |
|-------|---------|-----------|
| k8s-nodes | In-cluster nodes (DaemonSet) | FIM, rootcheck, k8s audit |
| home-network | LAN devices | FIM, rootcheck, SSH, auth logs |
| servers | Home servers | Full monitoring suite |

## Monitoring Agent Health
```bash
# Check all agent statuses
kubectl exec -n wazuh deployment/wazuh-manager -- /var/ossec/bin/agent_control -l

# Check disconnected agents
kubectl exec -n wazuh deployment/wazuh-manager -- /var/ossec/bin/agent_control -l -s disconnected

# Via Wazuh Dashboard: https://soc.homelab.local/wazuh -> Agents
```
