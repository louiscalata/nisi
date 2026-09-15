#!/bin/zsh
# AFM 3 Core local LLM endpoint — manual wrapper around `fm serve`.
# Usage: scripts/afm-serve.sh [port]   (default 1977)
PORT="${1:-1977}"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
	echo "afm serve already listening on ${PORT}"
	exit 0
fi
nohup fm serve --host 127.0.0.1 --port "$PORT" >/tmp/fm-serve.log 2>&1 &
echo "afm serve started on ${PORT} (pid $!) — log /tmp/fm-serve.log"
