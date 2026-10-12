#!/bin/sh
# Send a notification to the home page's hub (POST /api/notify; fields in lib/notify.js, README "Notifications").
# Plain sh + curl, so it runs on any LAN box, in cron, or at the end of a script:
#
#   NOTIFY_TOKEN=… scripts/notify.sh -l success -s backup -i fa:database "Backup done" "nextcloud → b2, 4.2 GB"
#   long_job && scripts/notify.sh -l success "Job done" || scripts/notify.sh -l error "Job failed"
#
# Options: -l level (info | success | warning | error)  -s source  -i icon (fa:<name>, fa-brands fa-<name>, or an https
# image URL)  -c color (primary | secondary | highlight | muted | green | red | blue | purple)  -u url (a click opens it)
# -t tag (replaces the last notice with this tag)  -e ttl (seconds until it goes)  -q (quiet: inbox only, no pop-up)
# Env: NOTIFY_TOKEN (or NOTIFY_TOKEN_FILE: a file holding it), NOTIFY_URL (default https://home.wliafdew.dev/api/notify).
# Exit status: 0 when the hub took it (its answer, with any warnings, goes to stdout), 1 otherwise.
set -eu

url=${NOTIFY_URL:-https://home.wliafdew.dev/api/notify}
token=${NOTIFY_TOKEN:-}
[ -z "$token" ] && [ -n "${NOTIFY_TOKEN_FILE:-}" ] && token=$(cat "$NOTIFY_TOKEN_FILE")
[ -z "$token" ] && { echo "notify: set NOTIFY_TOKEN (or NOTIFY_TOKEN_FILE)" >&2; exit 1; }

# a JSON string: backslashes and quotes escaped, tabs as spaces, newlines as \n
str() { printf '"%s"' "$(printf '%s' "$1" | tr '\t\r' '  ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }')"; }

json=''
add() { json="$json,\"$1\":$2"; }
while getopts l:s:i:c:u:t:e:q opt; do
  case $opt in
    l) add level "$(str "$OPTARG")" ;;
    s) add source "$(str "$OPTARG")" ;;
    i) add icon "$(str "$OPTARG")" ;;
    c) add color "$(str "$OPTARG")" ;;
    u) add url "$(str "$OPTARG")" ;;
    t) add tag "$(str "$OPTARG")" ;;
    e) case $OPTARG in *[!0-9]* | '') echo "notify: -e takes seconds" >&2; exit 1 ;; esac; add ttl "$OPTARG" ;;
    q) add silent true ;;
    *) exit 1 ;;
  esac
done
shift $((OPTIND - 1))
[ $# -ge 1 ] || { echo "usage: notify.sh [-l level] [-s source] [-i icon] [-c color] [-u url] [-t tag] [-e ttl] [-q] title [body]" >&2; exit 1; }
body="{\"title\":$(str "$1")"
[ $# -ge 2 ] && body="$body,\"body\":$(str "$2")"
body="$body$json}"

out=$(curl -sS -m 10 -w '\n%{http_code}' -X POST "$url" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data-binary "$body") || exit 1
code=$(printf '%s' "$out" | tail -n 1)
printf '%s\n' "$out" | sed '$d'
case $code in 2??) exit 0 ;; *) exit 1 ;; esac
