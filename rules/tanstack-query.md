---
description: TanStack Query (React Query) — query keys, caching, mutations, error handling, prefetching, SSR, performance
paths: ["**/*.tsx", "**/*.jsx"]
source: DeckardGer/tanstack-agent-skills@0e8bcdc (2026-04-03)
---

# TanStack Query Best Practices

Guidelines for TanStack Query patterns — data fetching, caching, mutations, and server state. 21 rules across 10 categories.

## Rule Categories by Priority

| Priority | Category | Rules | Impact |
|-|-|-|-|
| CRITICAL | Query Keys | 5 | Prevents cache bugs and data inconsistencies |
| CRITICAL | Caching | 5 | Optimizes performance and data freshness |
| HIGH | Mutations | 6 | Ensures data integrity and UI consistency |
| HIGH | Error Handling | 3 | Prevents poor user experiences |
| MEDIUM | Prefetching | 4 | Improves perceived performance |
| MEDIUM | Parallel Queries | 2 | Enables dynamic parallel fetching |
| MEDIUM | Infinite Queries | 3 | Prevents pagination bugs |
| MEDIUM | SSR Integration | 4 | Enables proper hydration |
| LOW | Performance | 4 | Reduces unnecessary re-renders |
| LOW | Offline Support | 2 | Enables offline-first patterns |

## Quick Reference

### Query Keys — CRITICAL (Prefix: `qk-`)

- `qk-array-structure` — Always use arrays for query keys
- `qk-include-dependencies` — Include all variables the query depends on
- `qk-hierarchical-organization` — Organize keys hierarchically (entity → id → filters)
- `qk-factory-pattern` — Use query key factories for complex applications
- `qk-serializable` — Ensure all key parts are JSON-serializable

### Caching — CRITICAL (Prefix: `cache-`)

- `cache-stale-time` — Set appropriate staleTime based on data volatility
- `cache-gc-time` — Configure gcTime for inactive query retention
- `cache-defaults` — Set sensible defaults at QueryClient level
- `cache-invalidation` — Use targeted invalidation over broad patterns
- `cache-placeholder-vs-initial` — Understand placeholder vs initial data differences

### Mutations — HIGH (Prefix: `mut-`)

- `mut-invalidate-queries` — Always invalidate related queries after mutations
- `mut-optimistic-updates` — Implement optimistic updates for responsive UI
- `mut-rollback-context` — Provide rollback context from onMutate
- `mut-error-handling` — Handle mutation errors gracefully
- `mut-loading-states` — Use isPending for mutation loading states
- `mut-mutation-state` — Use useMutationState for cross-component tracking

### Error Handling — HIGH (Prefix: `err-`)

- `err-error-boundaries` — Use error boundaries with useQueryErrorResetBoundary
- `err-retry-config` — Configure retry logic appropriately
- `err-fallback-data` — Provide fallback data when appropriate

### Prefetching — MEDIUM (Prefix: `pf-`)

- `pf-intent-prefetch` — Prefetch on user intent (hover, focus)
- `pf-route-prefetch` — Prefetch data during route transitions
- `pf-stale-time-config` — Set staleTime when prefetching
- `pf-ensure-query-data` — Use ensureQueryData for conditional prefetching

### Infinite Queries — MEDIUM (Prefix: `inf-`)

- `inf-page-params` — Always provide getNextPageParam
- `inf-loading-guards` — Check isFetchingNextPage before fetching more
- `inf-max-pages` — Consider maxPages for large datasets

### SSR Integration — MEDIUM (Prefix: `ssr-`)

- `ssr-dehydration` — Use dehydrate/hydrate pattern for SSR
- `ssr-client-per-request` — Create QueryClient per request
- `ssr-stale-time-server` — Set higher staleTime on server
- `ssr-hydration-boundary` — Wrap with HydrationBoundary

### Parallel Queries — MEDIUM

- `parallel-use-queries` — Use useQueries for dynamic parallel queries
- `query-cancellation` — Implement query cancellation properly

### Performance — LOW (Prefix: `perf-`)

- `perf-select-transform` — Use select to transform/filter data
- `perf-structural-sharing` — Leverage structural sharing
- `perf-notify-change-props` — Limit re-renders with notifyOnChangeProps
- `perf-placeholder-data` — Use placeholderData for instant UI

### Offline Support — LOW

- `network-mode` — Configure network mode for offline support
- `persist-queries` — Configure query persistence for offline support

## Detailed Rules

For full explanations with code examples, read individual rules in `~/SourceRoot/claude-local/reference/tanstack-query/`
