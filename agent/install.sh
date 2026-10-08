#!/usr/bin/env bash
# Installs the home-lofi host agent on this machine (needs Docker), then prints the entry to add to
# home-lofi's HOST_AGENTS. Re-running it updates the agent and keeps the token.
#   curl -fsSL https://static.wliafdew.dev/tools/host-agent/install.sh | bash
set -euo pipefail
SRC=https://static.wliafdew.dev/tools/host-agent
DIR=${DIR:-$HOME/host-agent}
command -v docker >/dev/null || { echo "Docker is missing. Install it:  curl -fsSL https://get.docker.com | sudo sh  && sudo usermod -aG docker \$USER  (then log out and in)" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Can't run 'docker compose' (not in the docker group yet? log out and in, or run with sudo)." >&2; exit 1; }

mkdir -p "$DIR" && cd "$DIR"
curl -fsSL "$SRC/agent.sh" -o agent.sh && chmod +x agent.sh
curl -fsSL "$SRC/docker-compose.yml" -o docker-compose.yml
# no Intel RAPL (AMD without the rapl driver, ARM, VMs): drop the power mount, power shows as n/a
[ -d /sys/devices/virtual/powercap/intel-rapl ] || sed -i '/powercap/d;/RAPL/d' docker-compose.yml
[ -f .env ] || { umask 077; echo "AGENT_TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" > .env; }
docker compose up -d --force-recreate
# RAPL counters are root-only; rootless Docker (or a non-root container) can't read them -> power shows nothing
if [ -d /sys/devices/virtual/powercap/intel-rapl ] && ! docker exec host-agent sh -c 'cat /rapl/intel-rapl/intel-rapl:0/energy_uj' >/dev/null 2>&1; then
  echo
  echo "Note: power (⚡) is off: Docker here can't read the CPU power counter (root-only; rootless Docker?)."
  echo "To allow it (makes the counters readable by every user on this machine, now and after reboots):"
  echo "  echo 'z /sys/class/powercap/intel-rapl:*/energy_uj 0444 - - -' | sudo tee /etc/tmpfiles.d/rapl.conf && sudo systemd-tmpfiles --create /etc/tmpfiles.d/rapl.conf"
fi

ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
. ./.env
echo
echo "Agent running on :9101 (folder $DIR). Add this to home-lofi's HOST_AGENTS (a JSON list) in Coolify:"
echo
echo "  {\"name\":\"$(hostname)\",\"url\":\"http://${ip:-<this-ip>}:9101/stats.json\",\"token\":\"$AGENT_TOKEN\"}"
echo
echo "Check it:  curl -u home:$AGENT_TOKEN http://${ip:-localhost}:9101/stats.json"
