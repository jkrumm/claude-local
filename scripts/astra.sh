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
if [ "$curl_rc" -ne 0 ] && [ ! -s "$WORK/response.json" ]; then
  echo "astra: request failed (curl exit $curl_rc, no response body)" >&2
  exit 1
fi

python3 -c '
import json, sys

path, http = sys.argv[1], sys.argv[2]
raw = open(path, encoding="utf-8", errors="replace").read()
try:
    d = json.loads(raw)
except json.JSONDecodeError:
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
' "$WORK/response.json" "$http"
