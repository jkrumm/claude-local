---
name: otel
description: >
  Query and debug OpenTelemetry data (traces, logs, metrics) stored in ClickHouse via HyperDX/ClickStack.
  ALWAYS use this skill when investigating: application errors, slow/missing traces, log anomalies, service
  health issues, or any observability question in local dev or VPS production. Works against both environments.
  Invoke with: what to investigate + which environment (local/prod) + any known context (service name,
  trace ID, error message, time range). Returns a concise findings report directly to the main agent.
context: fork
model: haiku
---

# OTEL Debug Skill

Query ClickHouse OTEL data stored by HyperDX/ClickStack. All data is in database `default`.

## Quick Reference

| Environment | Container | Access Method |
|-|-|-|
| local | `clickstack` (Docker) | `docker exec -i clickstack clickhouse-client` |
| prod | `clickstack` on VPS | `ssh vps "docker exec -i clickstack clickhouse-client"` |

- **No password** — ClickHouse default user with empty password
- **SSH auth**: key-based, already configured in `~/.ssh/config` (`ssh vps` just works)
- **No port exposure needed** — everything goes through `docker exec` stdin

## Execution: Two Approaches

### A) Python query script (preferred — formats output as markdown table)

```bash
SCRIPT=~/SourceRoot/.claude/skills/otel/scripts/query.py

# Preset queries (fastest)
python3 $SCRIPT --env local --preset health
python3 $SCRIPT --env prod  --preset errors --since 2h
python3 $SCRIPT --env prod  --preset slow   --since 6h
python3 $SCRIPT --env local --preset trace  --trace-id abc123def456
python3 $SCRIPT --env prod  --preset log-search --pattern "connection refused" --since 3h
python3 $SCRIPT --env prod  --preset trace-logs --trace-id abc123def456

# List all presets
python3 $SCRIPT --list-presets

# Raw SQL
python3 $SCRIPT --env prod "SELECT count() FROM default.otel_traces WHERE Timestamp >= now() - INTERVAL 1 HOUR"

# JSON output (for complex data)
python3 $SCRIPT --env prod --preset trace --trace-id abc123 --json
```

### B) Direct docker exec (for quick one-liners)

```bash
# Local
echo "SELECT count() FROM default.otel_traces" | docker exec -i clickstack clickhouse-client --format=Pretty

# Prod
echo "SELECT count() FROM default.otel_logs WHERE TimestampTime >= now() - INTERVAL 1 HOUR" | ssh vps "docker exec -i clickstack clickhouse-client --format=Pretty"
```

Use `--format=Pretty` for terminal readability, `--format=TabSeparatedWithNamesAndTypes` for script processing.

## Schema Reference

### `default.otel_traces`

| Column | Type | Notes |
|-|-|-|
| Timestamp | DateTime64(9) | Span start time (ns precision) |
| TraceId | String | Hex trace ID |
| SpanId | String | Hex span ID |
| ParentSpanId | String | Empty string for root spans |
| SpanName | LowCardinality(String) | Operation name |
| SpanKind | LowCardinality(String) | SERVER, CLIENT, INTERNAL, PRODUCER, CONSUMER |
| ServiceName | LowCardinality(String) | From resource attributes |
| Duration | UInt64 | **Nanoseconds** — divide by `1e6` for ms, `1e9` for seconds |
| StatusCode | LowCardinality(String) | `STATUS_CODE_OK`, `STATUS_CODE_ERROR`, `STATUS_CODE_UNSET` |
| StatusMessage | String | Error description when StatusCode = ERROR |
| ResourceAttributes | Map(LowCardinality(String), String) | Host, deployment, runtime attributes |
| SpanAttributes | Map(LowCardinality(String), String) | HTTP method, route, DB query, etc. |
| Events.Name | Array(LowCardinality(String)) | Span events (e.g. exceptions) |
| Events.Attributes | Array(Map(LowCardinality(String), String)) | Event details |
| Links.TraceId | Array(String) | Linked traces |

### `default.otel_logs`

| Column | Type | Notes |
|-|-|-|
| Timestamp | DateTime64(9) | Nanosecond precision |
| TimestampTime | DateTime | **Use in WHERE** — partition key, faster filtering |
| TraceId | String | Correlated trace ID (may be empty) |
| SpanId | String | Correlated span ID (may be empty) |
| SeverityText | LowCardinality(String) | TRACE, DEBUG, INFO, WARN, ERROR, FATAL |
| SeverityNumber | UInt8 | 1–4=TRACE, 5–8=DEBUG, 9–12=INFO, 13–16=WARN, **17–20=ERROR**, 21–24=FATAL |
| ServiceName | LowCardinality(String) | |
| Body | String | Log message text |
| ResourceAttributes | Map(LowCardinality(String), String) | |
| LogAttributes | Map(LowCardinality(String), String) | Structured fields from structured logging |
| ScopeAttributes | Map(LowCardinality(String), String) | Instrumentation library attributes |

### Metrics Tables

`otel_metrics_gauge`, `otel_metrics_sum`, `otel_metrics_histogram`, `otel_metrics_exponential_histogram`, `otel_metrics_summary`

Common columns: `ServiceName`, `MetricName`, `MetricDescription`, `MetricUnit`, `Attributes` (Map), `Value` (Float64 for gauge/sum), `TimeUnix` (DateTime64(9))

### Map Attribute Access Patterns

```sql
-- Read specific attribute
SpanAttributes['http.status_code']
LogAttributes['user.id']
ResourceAttributes['host.name']
ResourceAttributes['deployment.environment']

-- Filter by attribute existence
WHERE mapContains(SpanAttributes, 'http.route')

-- Filter by attribute value
WHERE SpanAttributes['http.status_code'] = '500'
WHERE LogAttributes['error.type'] != ''

-- Combine filters
WHERE ServiceName = 'api' AND SpanAttributes['http.route'] = '/v1/users'
```

## Common Query Patterns

### Investigate a specific service

```sql
-- Service health overview
SELECT
  ServiceName,
  count() AS spans,
  countIf(StatusCode = 'STATUS_CODE_ERROR') AS errors,
  round(100.0 * countIf(StatusCode = 'STATUS_CODE_ERROR') / count(), 1) AS error_pct,
  round(avg(Duration) / 1e6, 1) AS avg_ms,
  round(quantile(0.95)(Duration) / 1e6, 1) AS p95_ms
FROM default.otel_traces
WHERE ServiceName = 'my-api'
  AND Timestamp >= now() - INTERVAL 1 HOUR
GROUP BY ServiceName
```

### Find trace root cause

```sql
-- Step 1: Find recent error traces
SELECT TraceId, SpanName, StatusMessage, Timestamp
FROM default.otel_traces
WHERE ServiceName = 'my-api'
  AND StatusCode = 'STATUS_CODE_ERROR'
  AND Timestamp >= now() - INTERVAL 30 MINUTE
ORDER BY Timestamp DESC LIMIT 10;

-- Step 2: Get full trace waterfall
SELECT SpanId, ParentSpanId, ServiceName, SpanName,
  round(Duration / 1e6, 2) AS ms, StatusCode, StatusMessage
FROM default.otel_traces
WHERE TraceId = 'THE_TRACE_ID'
ORDER BY Timestamp;

-- Step 3: Correlated logs
SELECT Timestamp, ServiceName, SeverityText, Body, LogAttributes
FROM default.otel_logs
WHERE TraceId = 'THE_TRACE_ID'
ORDER BY Timestamp;
```

### Detect anomalies

```sql
-- Sudden error spike (compare last 5min vs previous 55min)
SELECT
  countIf(Timestamp >= now() - INTERVAL 5 MINUTE) AS last_5m,
  countIf(Timestamp < now() - INTERVAL 5 MINUTE) AS prev_55m,
  round(100.0 * countIf(Timestamp >= now() - INTERVAL 5 MINUTE AND StatusCode = 'STATUS_CODE_ERROR')
    / greatest(countIf(Timestamp >= now() - INTERVAL 5 MINUTE), 1), 1) AS recent_error_pct
FROM default.otel_traces
WHERE Timestamp >= now() - INTERVAL 1 HOUR
```

### Search for specific attribute values

```sql
-- Find slow DB queries
SELECT SpanName, SpanAttributes['db.statement'] AS query,
  round(Duration / 1e6, 1) AS ms
FROM default.otel_traces
WHERE mapContains(SpanAttributes, 'db.statement')
  AND Duration > 1000000000  -- > 1 second
  AND Timestamp >= now() - INTERVAL 1 HOUR
ORDER BY Duration DESC LIMIT 20;

-- HTTP 5xx errors
SELECT SpanName, SpanAttributes['http.route'] AS route,
  SpanAttributes['http.status_code'] AS status, count() AS cnt
FROM default.otel_traces
WHERE SpanAttributes['http.status_code'] IN ('500', '502', '503', '504')
  AND Timestamp >= now() - INTERVAL 1 HOUR
GROUP BY SpanName, route, status ORDER BY cnt DESC;
```

## Debugging Workflow

1. **Start with health check**: `python3 $SCRIPT --env prod --preset health`
   - Confirms data is flowing and when the latest data arrived
   - If stale: OTEL collector may be down or app not sending

2. **Get services overview**: `python3 $SCRIPT --env prod --preset services --since 1h`
   - Identifies which services have errors or high latency

3. **Drill into errors**: `python3 $SCRIPT --env prod --preset errors --since 1h`
   - Shows exact error messages grouped by service+span

4. **Find a specific trace**:
   - Get TraceId from errors output or from a specific request
   - Run `--preset trace --trace-id <id>` to see the full span waterfall
   - Run `--preset trace-logs --trace-id <id>` for correlated logs

5. **Log investigation**: Use `--preset log-search --pattern "keyword"` for text search
   - Combine with `SeverityNumber >= 17` filter for errors only

## Troubleshooting

| Symptom | Likely cause | Fix |
|-|-|-|
| `Cannot connect to Docker daemon` | Docker not running locally | Start Docker Desktop |
| `Error response from daemon: No such container: clickstack` | ClickStack not running | `cd ~/SourceRoot/vps && docker compose -f compose.dev.yml up -d clickstack` |
| `Connection refused` via SSH | SSH not configured | Check `~/.ssh/config` for `vps` host |
| `Table default.otel_traces doesn't exist` | No data ingested yet | Send test OTEL data or check `--preset tables` |
| Empty results | No data in time range | Increase `--since` range, try `7d` |
| `ssh vps` hangs | VPN/Tailscale not connected | Connect to Tailscale |

## Response Format

Return to the main agent as a structured findings report. Keep it **under 1200 characters** unless raw data is specifically needed:

```
## OTEL Findings — [env] / [time range]

**Status:** [healthy / degraded / errors detected]

**Key findings:**
- [service]: [X errors / Y% error rate / Zms p95]
- [specific issue with trace ID or log excerpt]
- [any anomalies or patterns]

**Recommended next steps:** (if applicable)
- [actionable suggestion]
```

Only include raw table output if it adds clarity that prose cannot convey. Truncate to the most relevant 5-10 rows if including tables.
