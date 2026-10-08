#!/bin/sh
# home-lofi host agent: every 10 s writes this machine's stats to /www/stats.json, served by busybox httpd
# on :9101 behind HTTP basic auth (user "home", password = $AGENT_TOKEN). Same shape as home-lofi's own
# /api/private "stats": {cpu, mem, temp, disk, uptime, load, power, at}; a field is null when unreadable.
# Runs in Docker: /proc and /sys are the host's; the host's / is mounted read-only at /host for the disk.
set -u
[ ${#AGENT_TOKEN} -ge 16 ] || { echo "AGENT_TOKEN must be at least 16 characters" >&2; exit 1; }
mkdir -p /www && echo "/:home:$AGENT_TOKEN" > /etc/httpd.conf && httpd -p 9101 -h /www -c /etc/httpd.conf

R=/rapl/intel-rapl/intel-rapl:0
DRAM=$(grep -lx dram "$R"/intel-rapl:0:*/name 2>/dev/null | head -1); DRAM=${DRAM%/name}

cpu() { awk '/^cpu /{print $5+$6, $2+$3+$4+$5+$6+$7+$8+$9}' /proc/stat; }   # idle total (jiffies)
uj() { [ -n "$1" ] && cat "$1/energy_uj" 2>/dev/null || echo; }
cs() { cut -d' ' -f1 /proc/uptime | tr -d .; }                                  # centiseconds
mw() {                                                                          # mw <dir> <uj0> <uj1> <cs> -> mW
  [ -n "$2" ] && [ -n "$3" ] || return
  d=$(( $3 - $2 )); [ "$d" -lt 0 ] && d=$(( d + $(cat "$1/max_energy_range_uj") ))
  echo $(( d / ($4 * 10) ))
}
w() { echo "$(( $1 / 1000 )).$(( $1 % 1000 / 100 ))"; }

# hottest CPU sensor (coretemp / k10temp / ...), else hottest of any kind; 1 decimal °C or null
temp() {
  for h in /sys/class/hwmon/hwmon*; do
    n=$(cat "$h/name" 2>/dev/null); c=0
    case "$n" in coretemp|k10temp|zenpower|cpu_thermal|cpu-thermal|x86_pkg_temp|soc_thermal) c=1;; esac
    for f in "$h"/temp*_input; do [ -r "$f" ] && echo "$c $(cat "$f")"; done
  done
  for z in /sys/class/thermal/thermal_zone*; do
    case "$(cat "$z/type" 2>/dev/null)" in x86_pkg_temp|cpu_thermal|cpu-thermal|soc_thermal) c=1;; *) c=0;; esac
    [ -r "$z/temp" ] && echo "$c $(cat "$z/temp")"
  done
}
pick_temp() { awk '$2>0 {if ($1) {cpu=1; if ($2>mc) mc=$2} else if ($2>ma) ma=$2}
  END {m = cpu ? mc : ma; if (m) printf "%.1f", m/1000; else printf "null"}'; }

while :; do
  set -- $(cpu); i0=$1 t0=$2; p0=$(uj $R); r0=$(uj "$DRAM"); c0=$(cs)
  sleep 10
  set -- $(cpu); i1=$1 t1=$2; p1=$(uj $R); r1=$(uj "$DRAM"); c1=$(cs)

  dt=$(( t1 - t0 )); busy=null; [ $dt -gt 0 ] && busy=$(( 100 - 100 * (i1 - i0) / dt ))
  mem=$(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END {printf "{\"used\":%.0f,\"total\":%.0f}", (t-a)*1024, t*1024}' /proc/meminfo)
  disk=$(df -P -k /host 2>/dev/null | awk 'NR==2 {printf "{\"used\":%.0f,\"total\":%.0f}", $3*1024, $2*1024}'); disk=${disk:-null}
  up=$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)
  load=$(awk '{printf "[%s,%s,%s]", $1, $2, $3}' /proc/loadavg)
  power=null; pc=$(mw $R "$p0" "$p1" $(( c1 - c0 )))
  if [ -n "$pc" ]; then
    pr=$(mw "$DRAM" "$r0" "$r1" $(( c1 - c0 )))
    power="{\"watts\":$(w $(( pc + ${pr:-0} ))),\"cpu\":$(w $pc),\"ram\":$([ -n "$pr" ] && w $pr || echo null)}"
  fi
  printf '{"cpu":%s,"mem":%s,"temp":%s,"disk":%s,"uptime":%s,"load":%s,"power":%s,"at":%s}\n' \
    "$busy" "$mem" "$(temp | pick_temp)" "$disk" "$up" "$load" "$power" "$(date +%s)" > /www/.s && mv /www/.s /www/stats.json
done
