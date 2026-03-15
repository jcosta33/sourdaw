---
name: event-driven-communication
description: >
    Use when modules need to communicate without creating direct dependencies — emitting, subscribing to, or handling domain events. Covers defining typed `DomainEvent` classes, publishing from use cases via `EventBus.emit`, subscribing for side effects (cache updates, analytics, store mutations), handler registration with cleanup, and the `inject`-in-hook anti-pattern. Apply even when the user says "notify another module", "react to a change", "trigger a side effect", "listen for an update", "invalidate cache after mutation", or "cross-module communication".
---

## Setup

```typescript
// ProductCatalog/events/ProductPriceChangedEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

// 1. Define the event
export class ProductPriceChangedEvent extends DomainEvent<{
    productId: string;
    previousPrice: number;
    newPrice: number;
}> {
    constructor(payload: ProductPriceChangedEvent['payload']) {
        super(payload);
    }
}

// ProductCatalog/useCases/updateProductPrice.ts
import { inject } from '#/helpers/DependencyInjector/inject';
import { EventBus } from '#/helpers/Event/EventBus';
import { patchProductApi } from '../repositories/patchProductApi';
import { type Product } from '../models/Product';

type UpdateProductPriceInput = {
    id: string;
    newPrice: number;
    previousPrice: number;
};

type UpdateProductPriceOutput = Promise<Product>;

export const updateProductPrice = inject({ patchProductApi, eventBus: EventBus }, ({ patchProductApi, eventBus }) => {
    return async function ({ id, newPrice, previousPrice }: UpdateProductPriceInput): UpdateProductPriceOutput {
        const updatedProduct = await patchProductApi({ id, price: newPrice });

        // 2. Publish the event from a use case
        eventBus.emit(
            new ProductPriceChangedEvent({
                productId: updatedProduct.id,
                previousPrice,
                newPrice,
            })
        );

        return updatedProduct;
    };
});
```

## Core Patterns

### Subscribing to events for cache updates

```typescript
// ShoppingCart/useCases/registerCartEventHandlers.ts
import { EventBus } from '#/helpers/Event/EventBus';
import { getQueryClient } from '#/helpers/QueryClient/getQueryClient';
import { ProductPriceChangedEvent } from '#/modules/ProductCatalog/events/ProductPriceChangedEvent';
import { useCartProducts } from '../hooks/useCartProducts';

export const registerCartEventHandlers = (eventBus: EventBus) => {
    eventBus.on(ProductPriceChangedEvent, (event) => {
        const queryClient = getQueryClient();
        const { productId, newPrice } = event.payload;
        const queryKey = useCartProducts.getKey();

        queryClient.setQueryData(queryKey, (old: any[] = []) =>
            old.map((item) => (item.productId === productId ? { ...item, unitPrice: newPrice } : item))
        );
    });
};
```

Subscribe to events in other domains to trigger side effects, such as updating a cache or sending analytics, keeping concerns separate.

### Creating reusable subscription helpers

```typescript
// FeatureFlags/helpers/subscribeToFlagsFetchedEvent.ts
import { inject } from '#/helpers/DependencyInjector/inject';
import { EventBus } from '#/helpers/Event/EventBus';
import { FlagsFetchedEvent } from '../events/FlagsFetchedEvent';

type Input = (flags: FlagsFetchedEvent['payload']) => void;
type Output = () => void;

export const subscribeToFlagsFetchedEvent = inject({ eventBus: EventBus }, ({ eventBus }) => {
    return function (callback: Input): Output {
        return eventBus.on(FlagsFetchedEvent, (event) => {
            callback(event.payload);
        });
    };
});
```

Encapsulate subscription logic into reusable helpers for events that are frequently subscribed to across the application.

### Cross-module handlers with complex logic

When a handler needs to do more than update a cache, delegate to use cases via `inject`:

```typescript
// ShoppingCart/useCases/handleProductPriceChanged.ts
import { inject } from '#/helpers/DependencyInjector/inject';
import { findByProductId } from '../useCases/findByProductId';
import { updateCartProduct } from '../useCases/updateCartProduct';

export const handleProductPriceChanged = inject(
    { findByProductId, updateCartProduct },
    ({ findByProductId, updateCartProduct }) => {
        return async function (event: ProductPriceChangedEvent): Promise<void> {
            const cartProducts = await findByProductId(event.payload.productId);

            for (const cartProduct of cartProducts) {
                await updateCartProduct({ ...cartProduct, unitPrice: event.payload.newPrice });
            }
        };
    }
);
```

Handlers should be kept small and delegate long-running or complex work to use cases.

### Event handler registration with cleanup

Group related handlers into a registration function that returns an unsubscribe teardown:

```typescript
// Analytics/useCases/registerAnalyticsEventHandlers.ts
import { type EventBus } from '#/helpers/Event/EventBus';

export const registerAnalyticsEventHandlers = (eventBus: EventBus): (() => void) => {
    eventBus.on(UserRegisteredEvent, trackUserRegistration);
    eventBus.on(OrderCompletedEvent, trackPurchase);
    eventBus.on(PaymentProcessedEvent, trackPaymentMethod);

    return () => {
        eventBus.off(UserRegisteredEvent, trackUserRegistration);
        eventBus.off(OrderCompletedEvent, trackPurchase);
        eventBus.off(PaymentProcessedEvent, trackPaymentMethod);
    };
};
```

Always return a cleanup function so handlers can be safely torn down (e.g. in tests or on module unmount).

## Common Mistakes

### CRITICAL Using inject inside React hooks

Wrong:

```typescript
// FeatureFlags/presentations/hooks/useFlagSubscription.ts
import { useEffect } from 'react';
import { inject } from '#/helpers/DependencyInjector/inject';
import { EventBus } from '#/helpers/Event/EventBus';
import { FlagsFetchedEvent } from '../events/FlagsFetchedEvent';

export const useFlagSubscription = (callback: () => void) => {
    useEffect(() => {
        // This will fail after minification
        const subscribe = inject({ eventBus: EventBus }, ({ eventBus }) => {
            return eventBus.on(FlagsFetchedEvent, callback);
        });

        return subscribe();
    }, [callback]);
};
```

Correct:

```typescript
// FeatureFlags/presentations/hooks/useFlagSubscription.ts
import { useEffect, useEffectEvent } from 'react';
import { Container } from '#/helpers/DependencyInjector/Container';
import { EventBus } from '#/helpers/Event/EventBus';
import { FlagsFetchedEvent } from '../events/FlagsFetchedEvent';

export const useFlagSubscription = (callback: () => void) => {
    const onFlagsFetched = useEffectEvent(callback);

    useEffect(() => {
        const eventBus = Container.getInstance().get(EventBus);
        const unsubscribe = eventBus.on(FlagsFetchedEvent, () => {
            onFlagsFetched();
        });

        return () => {
            unsubscribe();
        };
    }, []);
};
```

Two rules: (1) `inject` in hooks is forbidden -- it fails after minification; use `Container.getInstance()` instead. (2) Use `useEffectEvent` (stable in React 19.2) to capture the latest callback without adding it to the dependency array, preventing unnecessary re-subscriptions.

Source: <root>/docs/events.md

### HIGH Insufficient event payload context

Wrong:

```typescript
// Authorization/events/UserPermissionChangedEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

export class UserPermissionChangedEvent extends DomainEvent<{
    readonly userId: string;
    readonly newPermissions: string[];
}> {}
```

Correct:

```typescript
// Authorization/events/UserPermissionChangedEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

export class UserPermissionChangedEvent extends DomainEvent<{
    readonly userId: string;
    readonly previousPermissions: string[];
    readonly newPermissions: string[];
    readonly changedBy: string;
    readonly reason: string;
}> {}
```

Minimal context forces subscribers to make additional API calls to fetch related data; payloads must contain sufficient, immutable context for immediate action.

Source: <root>/docs/events.md

### HIGH Vague event naming conventions

Wrong:

```typescript
// Order/events/OrderEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

export class OrderEvent extends DomainEvent<{ id: string }> {}
export class UpdateDataEvent extends DomainEvent<{ id: string }> {}
```

Correct:

```typescript
// Order/events/OrderCompletedEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

export class OrderCompletedEvent extends DomainEvent<{ id: string }> {}
export class PaymentProcessedEvent extends DomainEvent<{ id: string }> {}
```

Event names must be clear, descriptive, and use verbs in their past tense form at the end of the event name.

Source: <root>/docs/events.md
