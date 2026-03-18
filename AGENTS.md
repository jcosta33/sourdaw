# Webdaw Web App - AI Agent Guidelines

This document provides guidance when working with the Webdaw web application codebase.

## Commands

See `package.json` scripts for available commands. Key ones: `pnpm dev`, `pnpm test`, `pnpm typecheck:beta`, `pnpm lint`.

## Documentation

For detailed documentation, see the `/docs` folder:

- **[architecture.md](./docs/architecture.md)** - Domain-driven architecture with strict module boundaries. Modules have contract folders (`models/`, `events/`, `useCases/`, `presentations/views/`) that define their public API.

- **[routing.md](./docs/routing.md)** - Route definitions and navigation patterns using TanStack Router.

- **[data-fetching.md](./docs/data-fetching.md)** - TanStack Query patterns for server state. Never use `useEffect` for fetching.

- **[forms.md](./docs/forms.md)** - React Hook Form + Zod for validation and form state management.

- **[events.md](./docs/events.md)** - Cross-module communication via typed event system.

- **[accessibility.md](./docs/accessibility.md)** - Semantic HTML, ARIA attributes, keyboard navigation requirements.

- **[testing.md](./docs/testing.md)** - Vitest + React Testing Library. Use `vi.mock(import(...))` syntax.

- **[terrific-component-wrapper.md](./docs/terrific-component-wrapper.md)** - Legacy component integration patterns.

## Tech Stack

React 19, TypeScript, Rspack, TanStack Query, React Hook Form + Zod, Zustand, Tailwind CSS, Vitest.

## Key Conventions

- Use `type` over `interface`, `as const` over `enum`
- Direct type imports: `import { type MyType } from '...'`
- Absolute imports with `#/modules/...` aliases
- Named exports only, explicit return types
- Block conditionals required, no chained ternaries
- Tailwind CSS exclusively for styling
- Wrap suspense components with `SuspenseGuard`

## Module Boundaries

Cross-module imports only from contract folders. Run `pnpm deps:validate` to check violations.

## Self-Improvement

When learning something generally applicable, ask the user if this file should be updated.
