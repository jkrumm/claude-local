---
description: Code quality principles — readability, simplicity, KISS
---

# Code Style

## Core Principles
- Readability and simplicity are paramount
- Low nesting: early returns, guard clauses
- Simple, battle-tested solutions over clever abstractions
- No premature optimization or over-engineering
- Self-documenting code over comments
- Value ESLint rules and tests (unit, integration, E2E) — improve them along the way where possible

## Deep Modules & Clean Architecture
- **Deep modules over shallow ones**: Prefer few well-encapsulated modules with simple interfaces that hide significant complexity, rather than many shallow wrappers that expose internals
- **Interface-driven design**: Each module owns a clear public interface; implementation details stay hidden. Humans design interfaces, implementation can be delegated
- **Ports and adapters**: Define shared interfaces with separate production and test adapters. Replace, don't layer — inject dependencies rather than stacking test infrastructure
- **Boundary-based testing**: Test through public interfaces/contracts, not internal state. Tests that survive refactors define behavior, not implementation
- **Reduce mental load**: Limit module interconnection to ~7–8 major chunks. Avoid webs of small modules with unclear relationships
- **Dependency classification**: Classify each dependency (in-process, owned service, external third-party) and apply the appropriate testing strategy per type
