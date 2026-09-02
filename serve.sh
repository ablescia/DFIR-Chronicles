#!/usr/bin/env bash
# Preview the site locally. A plain HTTP server is required — browsers refuse
# fetch() on file:// URLs, and the whole catalog is fetched at runtime.
#
#   ./serve.sh          start on 8080, or the next free port
#   ./serve.sh 9000     start on 9000, or the next free port
set -euo pipefail
cd "$(dirname "$0")"

PORT="$(python3 - "${1:-8080}" <<'PY'
import socket, sys
start = int(sys.argv[1])
for port in range(start, start + 50):
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            continue
    print(port)
    break
else:
    sys.exit("No free port between %d and %d" % (start, start + 49))
PY
)"

echo "The DFIR Chronicles → http://localhost:$PORT"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
