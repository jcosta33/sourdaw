# Documentation

This documentation provides walkthrough for implementing a new feature, from initial architectural design to final styling touches. Follow these steps to ensure your work aligns with our established patterns and conventions.

## Feature implementation flow

### 1. Architecture

Before writing any code, start with the foundational principles. Our codebase follows a specific domain-driven architecture that separates concerns and ensures scalability. Understanding this is the most critical first step.

➡️ **Read about our [architecture](./architecture.md)**

### 2. Routing and boundaries

Once you understand the architecture, define where your new feature will live. This involves creating the right files and folders for your pages and modules, which in turn defines the routes. At the same time, be mindful of the strict import boundaries between modules.

- ➡️ **Learn about [routing](./routing.md)**

### 3. Data fetching, HTTP and GraphQL

Most features need to interact with the backend. We use TanStack Query as our primary tool for managing server state. Depending on the API, you'll use either our custom HTTP client or GraphQL executors within your repositories.

- ➡️ **Master [data fetching](./data-fetching.md) with TanStack Query**
- ➡️ **See how to use the [HTTP client](./http-client.md)**
- ➡️ **Learn our [GraphQL](./gql.md) workflow**

### 4. Forms and state management

With data flowing, you can build the UI. For user input, we use a combination of React Hook Form and Zod for robust, schema-driven forms. For client-side UI state that isn't server data, we use a simple, event-driven vanilla store.

- ➡️ **Implement [forms](./forms.md) the right way**
- ➡️ **Manage UI state with our [state management](./state-management.md) principles**

### 5. Events

If your feature needs to notify another part of the application without creating a tight coupling, use our event bus. This is key for scalable, maintainable code.

- ➡️ **Use [events](./events.md) for cross-module communication**

### 6. Accessibility and internationalization

With the core logic in place, it's time to polish the feature. This includes ensuring it's accessible to all users, and adding translations for all text.

- ➡️ **Ensure [accessibility (a11y)](./accessibility.md)**
- ➡️ **Add translations with [internationalization (i18n)](./internationalization.md)**

### 7. Testing

Finally, write tests to ensure your feature is robust and bug-free. We have specific patterns for testing different parts of the architecture, from pure business logic to UI components.

- ➡️ **Follow our [testing](./testing.md) guidelines**

### 8. Terrific Integration

When working within the modern React architecture, you may need to incorporate existing Terrific modules. The `TerrificComponentWrapper` bridges this gap, allowing you to use legacy components seamlessly.

- ➡️ **Learn how to use the [Terrific Component Wrapper](./terrific-component-wrapper.md)**
