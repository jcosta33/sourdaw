# Documentation

This documentation provides high-level overviews for implementing features in the Sourdaw application, from initial architectural design to testing.

> **Note**: These files are meant for human reading. For the authoritative, machine-enforced rules that AI agents follow, see `.agents/skills/*/SKILL.md`.

## Feature implementation flow

### 1. Architecture

Before writing any code, start with the foundational principles. Our codebase follows a specific domain-driven architecture that separates concerns and ensures scalability. Understanding this is the most critical first step.

- ➡️ **Read about our [TypeScript module architecture](./architecture/03-typescript-module.md)**
- ➡️ **Read about our [system architecture](./architecture/01-system.md)**

### 2. Dependency Injection

Understand how services and long-lived collaborators are shared across the business layer using the Container.

- ➡️ **Read about [dependency injection](./01-dependency-injection.md)**

### 3. State Management and Forms

For user input, we use a combination of React Hook Form and Zod for robust, schema-driven forms. For client-side UI state, we use a custom vanilla store.

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
