---
name: domain-architecture
description: Apply when creating or refactoring modules. Enforces strict UI to Business to IO dependency flow, contract-based cross-module boundaries, and pure TypeScript use cases.
---

## Setup

```typescript
// Brand/useCases/getBrandById.ts
import { inject } from '#/helpers/DependencyInjector/inject';
import { getBrandByIdApi } from '../repositories/getBrandByIdApi';
import { type Brand } from '../models/Brand';

type GetBrandByIdOutput = Promise<Brand | null>;

export const getBrandById = inject({ getBrandByIdApi }, ({ getBrandByIdApi }) => {
    return async function (id: number, signal: AbortSignal): GetBrandByIdOutput {
        const data = await getBrandByIdApi(id, signal);

        if (!data) {
            return null;
        }

        if (data.isArchived) {
            return null;
        }

        return data;
    };
});
```

## Core patterns

### Cross-module DTOs

```typescript
// Guideline/useCases/getGuidelineSummary.ts
import { getBrand } from '#/modules/Brand/useCases/getBrand';
import { type BrandDto } from '#/modules/Brand/useCases/getBrand';

type GuidelineBrandSummary = { brandId: number; isPublished: boolean };

export const transformBrandToGuidelineSummary = (brand: BrandDto): GuidelineBrandSummary => ({
    brandId: brand.id,
    isPublished: brand.isPublished,
});

type GetGuidelineSummaryOutput = Promise<GuidelineBrandSummary | null>;

export const getGuidelineSummary = async (brandId: number): GetGuidelineSummaryOutput => {
    const brand = await getBrand({ id: brandId });
    return transformBrandToGuidelineSummary(brand);
};
```

When a use case is consumed by another module, it must export an explicit DTO type from the `useCases/` folder rather than exposing its internal domain model.

### Domain errors

```typescript
// Brand/errors/BrandNotFoundError.ts
export class BrandNotFoundError extends Error {
    readonly name = 'BrandNotFoundError';

    constructor(readonly brandId: number) {
        super(`Brand ${brandId} not found`);
    }
}
```

Repositories throw domain errors. Other modules import them from the `errors/` contract folder to `instanceof`-check without coupling to internals:

```typescript
// Guideline/useCases/getGuidelineSummary.ts
import { BrandNotFoundError } from '#/modules/Brand/errors/BrandNotFoundError';

try {
    const brand = await getBrand({ id: guideline.brandId });
} catch (error) {
    if (error instanceof BrandNotFoundError) {
        return null;
    }
    throw error;
}
```

### Presentations consuming use cases via hooks

```typescript
// Brand/presentations/hooks/useBrand.ts
import { useSuspenseQuery } from '@tanstack/react-query';
import { getBrandById } from '#/modules/Brand/useCases/getBrandById';

export const useBrand = (id: number) => {
    const { data: brand } = useSuspenseQuery({
        queryKey: useBrand.getKey(id),
        queryFn: () => getBrandById(id),
    });

    return { brand };
};

useBrand.getKey = (id: number) => ['brand', id];
```

The presentation layer connects to business operations exclusively through framework-agnostic use cases wrapped in TanStack Query hooks.

## Common mistakes

### CRITICAL Cross-module imports from non-contract folders

Wrong:

```typescript
// Guideline/useCases/doSomethingWithBrand.ts
import { type Brand } from '#/modules/Brand/models/Brand';
// It is a repository import, not a use case import
import { getBrandByIdApi } from '#/modules/Brand/repositories/getBrandByIdApi';

type DoSomethingWithBrandOutput = Promise<Brand>;

export const doSomethingWithBrand = (id: number): DoSomethingWithBrandOutput => {
    return getBrandByIdApi(id, new AbortController().signal);
};
```

Correct:

```typescript
// Guideline/useCases/doSomethingWithBrand.ts
import { getBrandById } from '#/modules/Brand/useCases/getBrandById';

export const doSomethingWithBrand = async (id: number) => {
    return getBrandById(id, new AbortController().signal);
};
```

Importing directly from a foreign module's `models/` or `repositories/` tightly couples domains; integration must exclusively happen through contract folders like `useCases/`, `events/`, or `errors/`.

Source: <root>/docs/architecture.md

### HIGH Presentation layer bypassing the business layer

Wrong:

```typescript
// Brand/presentations/views/BrandView.tsx
import { type ReactElement } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
// It is a repository import, not a use case import
import { getBrandByIdApi } from '#/modules/Brand/repositories/getBrandByIdApi';

export const BrandView = ({ id }: { id: number }): ReactElement => {
    const { data } = useSuspenseQuery({
        queryKey: ['brand', id],
        queryFn: () => getBrandByIdApi(id, new AbortController().signal),
    });

    return <div>{data?.name}</div>;
};
```

Correct:

```typescript
// Brand/presentations/views/BrandView.tsx
import { type ReactElement } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getBrandById } from '#/modules/Brand/useCases/getBrandById';

const useGetBrandById = () => {
    const { data } = useSuspenseQuery({
        queryKey: useGetBrandById.getKey(id),
        queryFn: () => getBrandById(id),
    });
    return data;
};
useGetBrandById.getKey = (id: number) => ['brand', id];

export const BrandView = ({ id }: { id: number }): ReactElement => {
    const brand = useGetBrandById(id);

    return <div>{data?.name}</div>;
};
```

Directly importing a repository into the presentation layer skips business rules and violates the strict `presentations -> useCases -> repositories` dependency flow.

Source: <root>/docs/architecture.md

### HIGH Leaking generated GraphQL types into use cases

Wrong:

```typescript
// Product/useCases/getProduct.ts
import { inject } from '#/helpers/DependencyInjector/inject';
import { getProductApi } from '../repositories/getProductApi';
import { type ProductQuery } from '../repositories/graphql/_generated/product.generated';

type GetProductOutput = Promise<ProductQuery | null>;

export const getProduct = inject({ getProductApi }, ({ getProductApi }) => {
    return function (id: number, signal: AbortSignal): GetProductOutput {
        return getProductApi(id, signal);
    };
});
```

Correct:

```typescript
// Product/useCases/getProduct.ts
import { inject } from '#/helpers/DependencyInjector/inject';
import { getProductApi } from '../repositories/getProductApi';
import { type Product } from '../models/Product';

type GetProductOutput = Promise<Product | null>;

export const getProduct = inject({ getProductApi }, ({ getProductApi }) => {
    return function (id: number, signal: AbortSignal): GetProductOutput {
        return getProductApi(id, signal);
    };
});
```

Auto-generated GraphQL types are tightly coupled to the schema and must be mapped to clean domain models within repositories/transformers before returning to use cases.

Source: <root>/docs/gql.md
