# Documentation

This documentation provides high-level overviews for implementing features in the Sourdaw application, from initial architectural design to testing.

> **Note**: These files are meant for human reading. For the authoritative, machine-enforced rules that AI agents follow, see `.agents/skills/*/SKILL.md`.

## Feature implementation flow

### 1. Architecture

Before writing any code, start with the foundational principles. Our codebase follows a specific domain-driven architecture that separates concerns and ensures scalability. Understanding this is the most critical first step.

- ➡️ **Read about our [architecture](./architecture.md)**

### 2. State Management and Forms

For user input, we use a combination of React Hook Form and Zod for robust, schema-driven forms. For client-side UI state, we use a custom vanilla store.

- ➡️ **Implement [forms](./forms.md) the right way**
- ➡️ **Manage UI state with our [state management](./state-management.md) principles**

### 3. Events

If your feature needs to notify another part of the application without creating a tight coupling (e.g. invalidating a cache after an action), use our event bus.

- ➡️ **Use [events](./events.md) for cross-module communication**

### 4. Accessibility

With the core logic in place, ensure the feature is accessible to all users, properly using ARIA attributes for complex audio surfaces.

- ➡️ **Ensure [accessibility (a11y)](./accessibility.md)**

### 5. Testing

Write tests to ensure your feature is robust and bug-free. We have specific patterns for testing different parts of the architecture using Vitest and React Testing Library.

- ➡️ **Follow our [testing](./testing.md) guidelines**

### 6. Conventions

To keep our codebase clean and consistent, we follow strict conventions for TypeScript, naming, and architectural layers.

- ➡️ **Follow our [conventions](./conventions.md)**
