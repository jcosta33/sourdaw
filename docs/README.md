# Documentation

This directory states current architecture, engineering practice, and user-visible behavior. Legacy
plans under `.agents/specs/` preserve intent and implementation history; they do not prove what ships.

> **Note**: These files are meant for human reading. AI agents start at the root `AGENTS.md` and load task-specific rules from `.agents/skills/*/SKILL.md`; machine enforcement lives in `eslint.config.mjs` and `.dependency-cruiser*.cjs` (`pnpm deps:validate`).

> **Note**: End-user documentation lives in [`docs/manual/`](./manual/README.md). It is written for people using the DAW, not building it — keep implementation vocabulary out of it.

## Feature implementation flow

### 1. Architecture

Before writing any code, start with the foundational principles. Our codebase follows a specific domain-driven architecture that separates concerns and ensures scalability. Understanding this is the most critical first step.

- ➡️ **Read about our [TypeScript module architecture](./architecture/03-typescript-module.md)**
- ➡️ **Read about our [system architecture](./architecture/01-system.md)**
- ➡️ **Read about our [Rust backend architecture](./architecture/02-rust-backend.md)**
- ➡️ **Review [plugin hosting security](./architecture/04-plugin-hosting-security.md) before changing native plugin scan/load behavior**
- ➡️ **Read about [boundary enforcement limits](./architecture/05-boundary-enforcement-limits.md) before touching dependency rules or baselines**
- ➡️ **Read about the [CRDT write path & collaboration](./architecture/06-crdt-collaboration.md) before touching state, undo, or persistence**
- ➡️ **Read about the [WASM DSP pipeline](./architecture/07-wasm-dsp-pipeline.md) before touching device engines or worklets**
- ➡️ **Follow the [device authoring playbook](./architecture/08-device-authoring.md) when adding or changing a built-in device**
- ➡️ **Read about the [AI stack](./architecture/09-ai-stack.md) before touching LLM or ML features**
- ➡️ **Read about [desktop packaging](./architecture/10-desktop-packaging.md) before changing the packaged layout, fuses, or entitlements**

### 2. Dependency Injection

Understand how services and long-lived collaborators are shared across the business layer using the Container.

- ➡️ **Read about [dependency injection](./01-dependency-injection.md)**

### 3. State Management and Forms

For client-side UI state, we use a custom vanilla store. (A React Hook Form + Zod forms stack is documented as a target in [forms](./02-forms.md) but is not yet installed.)

- ➡️ **Implement [forms](./02-forms.md) the right way**
- ➡️ **Manage UI state with our [state management](./03-state-management.md) principles**

### 4. Events

If your feature needs to notify another part of the application without creating a tight coupling (e.g. invalidating a cache after an action), use our event bus.

- ➡️ **Use [events](./04-events.md) for cross-module communication**

### 5. Accessibility

With the core logic in place, ensure the feature is accessible to all users, properly using ARIA attributes for complex audio surfaces.

- ➡️ **Ensure [accessibility (a11y)](./05-accessibility.md)**

### 6. Testing

Write tests to ensure your feature is robust and bug-free. We have specific patterns for testing different parts of the architecture using Vitest and React Testing Library.

- ➡️ **Follow our [testing](./06-testing.md) guidelines**

### 7. Conventions

To keep our codebase clean and consistent, we follow strict conventions for TypeScript, naming, and architectural layers.

- ➡️ **Follow our [conventions](./07-conventions.md)**
