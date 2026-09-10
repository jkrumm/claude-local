#!/usr/bin/env bash
#
# astra — one-shot deep-think against GPT-6 Astra on the IU unified endpoint.
#
# The complement to `cxa`, not a replacement: no agent loop, no tools, no repo
# access — one Responses call at the strongest setting the endpoint exposes.
# That setting is `reasoning.mode = "pro"`, which no coding harness (Codex
# included) can send: codex only surfaces `model_reasoning_effort`. So the
# hardest single question you have goes here, and the answer gets executed by
# Claude Code.
#
#   astra 'is this design wrong, and why?'
#   astra -f src/a.ts -f src/b.ts 'critique the seam between these two'
#   git diff | astra 'what breaks in production?'
#
# Options:
#   -e EFFORT   low | medium | high | xhigh | max        (default: xhigh)
#   -m MODE     standard | pro                           (default: pro)
#   -M MODEL    any id the endpoint serves               (default: gpt-6-astra)
#   -f FILE     attach a file, repeatable
#
# Cost: this model is several times the price of gpt-5.6-sol and `pro` mode
# spends more reasoning tokens again. Token usage is printed to stderr on every
# run so the bill is never invisible.
set -euo pipefail

MODEL="gpt-6-astra"
EFFORT="xhigh"
MODE="pro"
FILES=()

usage() { sed -n '3,24p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while getopts ":e:m:M:f:h" opt; do
  case "$opt" in
    e) EFFORT="$OPTARG" ;;
    m) MODE="$OPTARG" ;;
    M) MODEL="$OPTARG" ;;
    f) FILES+=("$OPTARG") ;;
    h) usage 0 ;;
    *) echo "astra: unknown option -$OPTARG" >&2; usage 1 ;;
  esac
done
shift $((OPTIND - 1))

PROMPT="${*:-}"
STDIN=""
if [ ! -t 0 ]; then STDIN="$(cat)"; fi
if [ -z "$PROMPT" ] && [ -z "$STDIN" ]; then
  echo "astra: no prompt (pass one as an argument or on stdin)" >&2
  exit 1
fi

# Same Keychain-then-cache resolution as the rest of the estate: the MacBook
# answers from the login Keychain, the mini from the offline SOPS cache. The
# endpoint host is never committed, so it comes from the same pair.
resolve() {
  local svc="$1" ref="$2" val
  val=$(security find-generic-password -s "$svc" -w 2>/dev/null || true)
  [ -n "$val" ] || val=$(secrets-run read "$ref" 2>/dev/null || true)
  printf '%s' "$val"
}
KEY=$(resolve claude-sdk-api-key op://common/anthropic/API_KEY)
BASE=$(resolve claude-sdk-base-url op://common/anthropic/BASE_URL)
if [ -z "$KEY" ] || [ -z "$BASE" ]; then
  echo "astra: IU credentials unavailable — run 'make setup' in dotfiles" >&2
  exit 1
fi
BASE="${BASE%/}"; ROOT="${BASE%/anthropic}"

WORK=$(mktemp -d -t astra)
trap 'rm -rf "$WORK"' EXIT

MODEL="$MODEL" EFFORT="$EFFORT" MODE="$MODE" PROMPT="$PROMPT" STDIN="$STDIN" \
FILES="$(printf '%s\n' "${FILES[@]+"${FILES[@]}"}")" python3 -c '
import json, os, sys

parts = []
for path in filter(None, os.environ["FILES"].splitlines()):
    try:
        body = open(path, encoding="utf-8", errors="replace").read()
    except OSError as exc:
        sys.exit("astra: %s" % exc)
    parts.append("<file path=\"%s\">\n%s\n</file>" % (path, body))
if os.environ["STDIN"].strip():
    parts.append("<stdin>\n%s\n</stdin>" % os.environ["STDIN"])
if os.environ["PROMPT"].strip():
    parts.append(os.environ["PROMPT"])

json.dump({
    "model": os.environ["MODEL"],
    "input": "\n\n".join(parts),
    "reasoning": {"effort": os.environ["EFFORT"], "mode": os.environ["MODE"]},
    "text": {"verbosity": "high"},
    "max_output_tokens": 32000,
    "store": False,
}, open(sys.argv[1], "w"))
' "$WORK/payload.json"

# The key goes in through a `--config` file on stdin and the payload through
# `-d @file`: as argv elements both would sit in `ps auxww` for the length of
# the call, and the payload can be megabytes of attached source besides.
#
# No `--fail-with-body`: under `set -e` a non-2xx would abort the script and the
# EXIT trap would delete the body before it could be read, leaving `curl: (22)`
# in place of the endpoint's actual error message. Take the status, then always
# parse the body.
# python3, not `date +%s%N`: BSD date on macOS has no sub-second format, and
# python3 is already a hard dependency of this script.
start_ms=$(python3 -c 'import time; print(int(time.time() * 1000))')
http=000
set +e
http=$(printf 'header = "Authorization: Bearer %s"\n' "$KEY" |
  curl -sS -m 1800 --config - \
    "$ROOT/openai/v1/responses" \
    -H 'Content-Type: application/json' \
    -d @"$WORK/payload.json" \
    -o "$WORK/response.json" \
    -w '%{http_code}')
curl_rc=$?
set -e
end_ms=$(python3 -c 'import time; print(int(time.time() * 1000))')
duration_ms=$((end_ms - start_ms))
if [ "$curl_rc" -ne 0 ] && [ ! -s "$WORK/response.json" ]; then
  echo "astra: request failed (curl exit $curl_rc, no response body)" >&2
  exit 1
fi

python3 -c '
import json, sys

path, http, duration_ms, effort, mode = sys.argv[1:6]
raw = open(path, encoding="utf-8", errors="replace").read()
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    # The endpoint sits behind a front door with its own request timeout, well
    # under the curl -m 1800 above, and it answers with an HTML error page
    # rather than JSON. Measured: pro + xhigh + a ~400-line attachment exceeds
    # it; the same question at -e high returned in ~4 min. Name the fix instead
    # of printing markup -- the raw body says 500 and nothing about what to
    # change. No apostrophes anywhere in this block: it is single-quoted shell.
    if "<html" in raw[:200].lower():
        if "timed out" in raw.lower():
            hint = ("front-door timeout, not curl. Retry with a lower -e (high), "
                    "drop -m pro, or shrink the -f attachment.")
        else:
            hint = "the endpoint returned an HTML error page, not JSON."
        sys.exit("astra: HTTP %s -- %s" % (http, hint))
    sys.exit("astra: HTTP %s, unparseable response\n%s" % (http, raw[:800]))
if d.get("error"):
    sys.exit("astra: HTTP %s — %s" % (http, json.dumps(d["error"])))
if http != "200":
    sys.exit("astra: HTTP %s\n%s" % (http, raw[:800]))

print("".join(
    c.get("text", "")
    for item in d.get("output", []) if item.get("type") == "message"
    for c in item.get("content", [])
))

u = d.get("usage") or {}
detail = u.get("output_tokens_details") or {}
print(
    "[astra] %s in=%s out=%s reasoning=%s" % (
        d.get("model", "?"),
        u.get("input_tokens", 0),
        u.get("output_tokens", 0),
        detail.get("reasoning_tokens", 0),
    ),
    file=sys.stderr,
)

# Usage sink for the usage tracker: this is the only place gpt-6-astra spend is
# ever recorded, since it is not a Codex session and the codex collector cannot
# see it. Never let this cost the user an answer that already succeeded and
# already printed above -- swallow every failure (missing dir, full disk, perms).
try:
    import pathlib
    import uuid
    from datetime import datetime, timezone

    request_id = d.get("id")
    synthetic_id = False
    if not request_id:
        # No id on the response body -- synthesize one rather than letting two
        # calls collapse onto the same (missing) dedup key, and flag it so the
        # collector can tell a real id from a stand-in.
        request_id = str(uuid.uuid4())
        synthetic_id = True

    # input_tokens_details.cached_tokens is the Responses API cache-read count;
    # fall back to 0 when the endpoint omits the block rather than guessing.
    cached_tokens = (u.get("input_tokens_details") or {}).get("cached_tokens", 0)

    record = {
        "ts": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "request_id": request_id,
        "model": d.get("model"),
        "input_tokens": u.get("input_tokens", 0),
        "output_tokens": u.get("output_tokens", 0),
        "reasoning_tokens": detail.get("reasoning_tokens", 0),
        "cached_tokens": cached_tokens,
        "effort": effort,
        "mode": mode,
        "outcome": "ok",
        "duration_ms": int(duration_ms),
    }
    if synthetic_id:
        record["synthetic_request_id"] = True

    sink_dir = pathlib.Path.home() / ".local" / "share" / "usage-tracker"
    sink_dir.mkdir(parents=True, exist_ok=True)
    with open(sink_dir / "astra.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
except Exception:
    pass
' "$WORK/response.json" "$http" "$duration_ms" "$EFFORT" "$MODE"
