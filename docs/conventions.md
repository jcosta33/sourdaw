# Conventions

This guide defines coding conventions and patterns for clarity, consistency, and maintainability.

## Prefer explicit control flow

All control flow must be explicit. Use guard clauses for early returns and always use block statements (`{...}`) for conditionals. Avoid clever shortcuts like short-circuit invocations (`&&`) or collapsed `if` statements. This practice improves readability and reduces the chance of logical errors.

- **Related Lint Rule**: [`curly`](https://eslint.org/docs/latest/rules/curly)

```typescript
// ✅ Good: Guard clauses and block conditionals
export const publishAsset = (asset: Asset): void => {
    if (!asset) {
        throw new Error('Missing brand');
    }

    if (asset.isArchived) {
        return;
    }

    if (asset.isPublished) {
        return;
    }

    publishAssetApi(asset.id);
};

// ❌ Bad: Short-circuit invocation and collapsed ifs
export const publishAsset = (asset: Asset): void => {
    if (!asset) throw new Error('Missing asset');
    asset && !asset.isArchived && !asset.isPublished && publishAssetApi(asset.id);
};
```

### Avoid clever JavaScriptisms

```typescript
// ❌ Bad: Chained ternaries obscure intent
const roleLabel = !user ? '—' : user.isAdmin ? 'Admin' : user.isEditor ? 'Editor' : 'User';

// ✅ Good: Clear branches with early returns/blocks
let roleLabel = '—';
if (user) {
    if (user.isAdmin) {
        roleLabel = 'Admin';
    } else if (user.isEditor) {
        roleLabel = 'Editor';
    } else {
        roleLabel = 'User';
    }
}
```

### Keep logic framework-agnostic

```tsx
// ✅ Good: Pure function + thin view wrapper
export const computeFinalPrice = ({ price, discount }: ProductCost): number => {
    return Math.max(0, price - discount);
};

export const Price = ({ price, discount }: ProductCost): ReactElement => {
    const value = computeFinalPrice({ price, discount });
    return <span>${value}</span>;
};

// ❌ Bad: Embedding domain logic in the component
export const Price = ({ price, discount }: ProductCost): ReactElement => {
    const value = Math.max(0, price - discount);
    return <span>${value}</span>;
};
```

### React anti-patterns

- **No `useEffect` for data fetching**: This is a critical pattern. Data fetching must be handled by [TanStack Query](./data-fetching.md).
- **No `useEffect` for derived state**: Compute derived state directly during rendering.
- **No manual memoization**: The [React Compiler](https://react.dev/learn/react-compiler) handles memoization automatically at build time. Do not use `useMemo`, `useCallback`, or `React.memo` manually -- the compiler inserts optimal memoization for you. Existing manual calls are harmless (the compiler skips already-memoized code) but should be removed when touching a file.
- **No `forwardRef`**: In React 19, `ref` is a regular prop. Destructure it directly instead of wrapping with `forwardRef`.
- **Prefer `use()` over `useContext`**: The `use()` hook replaces `useContext` for reading context. It can be called conditionally and also reads Promises for Suspense-based patterns.
- **No manual form state**: All forms must be managed with [React Hook Form](./forms.md) and a schema library like Zod.

```tsx
// ❌ Bad: Manual memoization (the React Compiler handles this automatically)
export const Parent = () => {
    const onClose = useCallback(() => modal.close(), []);
    const config = useMemo(() => ({ theme: 'dark' }), []);
    return <Dialog onClose={onClose} config={config} />;
};

// ✅ Good: Write plain code; the compiler memoizes what's needed
export const Parent = () => {
    const onClose = () => modal.close();
    const config = { theme: 'dark' };
    return <Dialog onClose={onClose} config={config} />;
};

// ❌ Bad: useEffect for derived state from props
export const Badge = ({ count }: { count: number }) => {
    const [isMany, setIsMany] = useState(false);
    useEffect(() => {
        setIsMany(count > 99);
    }, [count]);
    return <span>{isMany ? '99+' : String(count)}</span>;
};

// ✅ Good: derive during render
export const Badge = ({ count }: { count: number }) => {
    const label = count > 99 ? '99+' : String(count);
    return <span>{label}</span>;
};

// ❌ Bad: useEffect for data fetching
export const BrandDetails = ({ id }: { id: number }) => {
    const [data, setData] = useState<Brand | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);
        fetch(`/api/brands/${id}`)
            .then((r) => r.json())
            .then((json: Brand) => {
                if (isMounted) {
                    setData(json);
                    setIsLoading(false);
                }
            });
        return () => {
            isMounted = false;
        };
    }, [id]);

    if (isLoading) {
        return <Spinner />;
    }
    return <div>{data?.name}</div>;
};

// ✅ Good: TanStack Query for data fetching (non-suspense)
// Brand/presentations/hooks/useBrandDetails.ts

import { useQuery } from '@tanstack/react-query';

export const useBrandDetails = (id: number) => {
    const { data: brand, isLoading } = useQuery({
        queryKey: ['brand', id],
        queryFn: () => api.brands.getById(id),
    });

    return { brand, isLoading };
};

useBrandDetails.getKey = (id: number) => ['brand', id];

export const BrandDetails = ({ id }: { id: number }) => {
    const { brand, isLoading } = useBrandDetails(id);

    if (isLoading) {
        return <Spinner />;
    }
    return <div>{brand?.name}</div>;
};

// ✅ Good: Suspense-enabled TanStack Query
// Brand/presentations/hooks/useBrandDetailsSuspense.ts

import { useSuspenseQuery } from '@tanstack/react-query';

export const useBrandDetailsSuspense = (id: number) => {
    const { data: brand } = useSuspenseQuery({
        queryKey: ['brand', id],
        queryFn: () => api.brands.getById(id),
    });
    return { brand };
};

useBrandDetailsSuspense.getKey = (id: number) => ['brand', id];

export const BrandDetailsSuspense = ({ id }: { id: number }) => {
    const { brand } = useBrandDetailsSuspense(id);
    return <div>{brand.name}</div>;
};

// ❌ Bad: Managing forms with custom state
export const EmailForm = () => {
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
            setError('Invalid email');
            return;
        }
        submit({ email });
    };

    return (
        <form onSubmit={handleSubmit}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
            {error ? <span>{error}</span> : null}
            <button type="submit">Save</button>
        </form>
    );
};
```

## Naming conventions

### File names

```text
✅ Good
components/BrandCard.tsx        # PascalCase for components
views/BrandListView.tsx         # PascalCase for views
helpers/formatPrice.ts            # camelCase for utilities
models/Brand.ts                 # PascalCase for models
useCases/createBrand.ts         # camelCase for use cases

❌ Bad
components/brand-card.tsx       # kebab-case
components/brandcard.tsx        # lowercase
helpers/format_price.ts           # snake_case
```

### Variable and function names

```typescript
// ✅ Good: Descriptive, verbose names
const currentUserPermissions = getUserPermissions();
const isAssetPublished = asset.status === 'published';
const calculateTotalPriceWithTax = (basePrice: number) => basePrice * 1.2;

// ❌ Bad: Abbreviated, unclear names
const usrPerms = getUserPermissions();
const isPub = asset.status === 'published';
const calcTot = (p: number) => p * 1.2;
```

### Component and class names

- Components and classes must be `PascalCase`.
    - **Related Lint Rule**: [`@eslint-react/naming-convention/component-name`](https://eslint-react.xyz/docs/rules/naming-convention/component-name)

```typescript
// ✅ Good: PascalCase for components and classes
export const BrandCard = (): ReactElement => {
    /* */
};
export class BrandRepository {
    /* */
}
export class UserNotFoundError extends Error {
    /* */
}

// ❌ Bad: camelCase or other patterns
export const brandCard = (): ReactElement => {
    /* */
};
export class brandRepository {
    /* */
}
```

---

## React patterns

### Component typing

```typescript
// ✅ Good: Type the return value
import { type ReactElement } from 'react';

export const BrandCard = ({ name, price }: BrandCardProps): ReactElement => {
    return <div>{name} - ${price}</div>;
};

// ❌ Bad: Type the component itself
import { type FC } from 'react';

export const BrandCard: FC<BrandCardProps> = ({ name, price }) => {
    return <div>{name} - ${price}</div>;
};
```

### Ref handling (React 19)

In React 19, `ref` is a regular prop. Do not use `forwardRef`.

```tsx
// ✅ Good: ref as a regular prop (React 19)
type InputProps = {
    label: string;
    ref?: React.Ref<HTMLInputElement>;
};

export const Input = ({ label, ref }: InputProps): ReactElement => {
    return <input ref={ref} aria-label={label} />;
};

// ❌ Bad: forwardRef wrapper (deprecated in React 19)
export const Input = forwardRef<HTMLInputElement, { label: string }>(({ label }, ref) => {
    return <input ref={ref} aria-label={label} />;
});
```

### Import patterns

```typescript
// ✅ Good: Import specific types / methods
import { type ReactElement, type MouseEvent, useState, use } from 'react';

// ❌ Bad: Import React and use dot notation
import React from 'react';

export const BrandCard = (): React.ReactElement => {
    const [count, setCount] = React.useState(0);
    return <div>{count}</div>;
};
```

### Type-only imports and import order

- Use type-only imports (`import { type MyType }`) for all type imports. This is enforced by the linter.
    - **Related Lint Rule**: [`@typescript-eslint/consistent-type-imports`](https://typescript-eslint.io/rules/consistent-type-imports)
- Organize imports in the following order, with newlines between groups and alphabetical sorting within groups:
    1.  Built-in (e.g., `node:fs`, `node:path`, ...)
    2.  External (e.g., `react`, `@tanstack/react-query`)
    3.  Internal (`#/modules/...` or `#/helpers/...`)
    4.  Parent (`../`)
    5.  Sibling (`./`)
    6.  Index
    7.  Object
    - **Related Lint Rule**: [`import/order`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md)

```typescript
// ✅ Good
import { useState, type ReactElement } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getBrand } from '#/modules/Brand/useCases/getBrand';

// ❌ Bad: Mixed order and missing type-only imports
import { ReactElement } from 'react';
import { getBrand } from '../../../../../modules/Brand/useCases/getBrand';
import { useSuspenseQuery } from '@tanstack/react-query';
```

### Export patterns

```typescript
// ✅ Good: Named exports
export const BrandCard = (): ReactElement => {
    /* */
};
export const useBrand = (id: number) => {
    /* */
};
export const formatPrice = (price: number) => {
    /* */
};

// ❌ Bad: Default exports
const BrandCard = (): ReactElement => {
    /* */
};
export default BrandCard;

// ⚠️ Barrel exports: Prefer direct imports from files for internal code
```

### Import paths

- Use absolute imports with the `#/` alias for cross-module paths.
- Avoid deep relative imports like `../../../..`; prefer `#/modules/Domain/...` or `#/helpers/...`.

---

## Control flow patterns

### If statements

- Always use block statements (`{...}`) for all conditionals, even single-line ones.
    - **Related Lint Rule**: [`curly`](https://eslint.org/docs/latest/rules/curly)

```typescript
// ✅ Good: Block statements always
export const validateBrand = (brand: Brand): void => {
    if (!brand.name) {
        throw new Error('Brand name is required');
    }

    if (brand.price <= 0) {
        throw new Error('Brand price must be positive');
    }
};

// ❌ Bad: Collapsed if statements
export const validateBrand = (brand: Brand): void => {
    if (!brand.name) throw new Error('Brand name is required');
    if (brand.price <= 0) throw new Error('Brand price must be positive');
};
```

### Early returns over complex ternaries

```typescript
// ✅ Good: Early return pattern
export const BrandCard = ({ brand }: BrandCardProps): ReactElement => {
    if (!brand) {
        return <div>Loading...</div>;
    }

    if (brand.isDeleted) {
        return <div>Brand no longer available</div>;
    }

    if (!brand.isPublished) {
        return <div>Brand is not published</div>;
    }

    return (
        <div>
            <h3>{brand.name}</h3>
            <p>${brand.price}</p>
        </div>
    );
};

// ❌ Bad: Complex nested ternaries
export const BrandCard = ({ brand }: BrandCardProps): ReactElement => {
    return (
        <div>
            {!brand ? (
                <div>Loading...</div>
            ) : brand.isDeleted ? (
                <div>Brand no longer available</div>
            ) : !brand.isPublished ? (
                <div>Brand is not published</div>
            ) : (
                <div>
                    <h3>{brand.name}</h3>
                    <p>${brand.price}</p>
                </div>
            )}
        </div>
    );
};
```

### JSX conditional rendering

- Use early returns, full ternary operators (`condition ? <A /> : <B />`), or logical nullish operators for conditional rendering.
- Do not use the logical AND operator (`&&`) for conditional rendering, as it can lead to unexpected output (like rendering `0` or an empty string).
    - **Related Lint Rule**: [`@eslint-react/no-leaked-conditional-rendering`](https://eslint-react.xyz/docs/rules/no-leaked-conditional-rendering)

```typescript
// ✅ Good: Early returns and full ternaries
export const AssetActions = ({ asset, canEdit }: AssetActionsProps): ReactElement => {
    if (!canEdit) {
        return <div>View only</div>;
    }

    return (
        <div>
            <button>Edit</button>
            {asset.isPublished ? <button>Unpublish</button> : <button>Publish</button>}
            {asset.hasComments ? <span>Has comments</span> : null}
            {asset.pages.length > 0 ? <AssetPages pages={asset.pages} /> : undefined}
        </div>
    );
};

// ❌ Bad: Logical AND operators for conditional rendering
export const AssetActions = ({ asset, canEdit }: BrandActionsProps): ReactElement => {
    return (
        <div>
            {canEdit && <button>Edit</button>}
            {asset.hasComments && <span>Has comments</span>}
            {asset.pages.length > 0 && <AssetPages pages={asset.pages} />}
        </div>
    );
};

// ❌ Bad: Complex inline ternaries
export const AssetActions = ({ asset, canEdit }: BrandActionsProps): ReactElement => {
    return (
        <div>
            {canEdit ? (
                <div>
                    <button>Edit</button>
                    {asset.isPublished ? (
                        <button>Unpublish</button>
                    ) : (
                        <button>Publish</button>
                    )}
                </div>
            ) : (
                <div>View only</div>
            )}
        </div>
    );
};
```

### Event handler patterns

```typescript
// ✅ Good: Explicit conditional call
export const handleClick = (onClick?: () => void): void => {
    if (onClick) {
        onClick();
    }
};

// ❌ Bad: Short-circuit invocation
export const handleClick = (onClick?: () => void): void => {
    onClick && onClick();
};
```

---

## Performance patterns

### The React Compiler handles memoization

The [React Compiler](https://react.dev/learn/react-compiler) (v1.0, stable since October 2025) automatically memoizes components, values, and callbacks at build time. You no longer need to think about `useMemo`, `useCallback`, or `React.memo` -- just write plain code and the compiler optimizes it.

```typescript
// ✅ Good: Plain code; the compiler memoizes automatically
export const ProductCard = ({ product, discount }: ProductCardProps): ReactElement => {
    const [isExpanded, setIsExpanded] = useState(false);

    const discountedPrice = product.price * (1 - discount);
    const formattedPrice = `$${discountedPrice.toFixed(2)}`;
    const isOnSale = discount > 0;

    return (
        <div>
            <h3>{product.name}</h3>
            <p>{formattedPrice}</p>
            {isOnSale ? <span>On Sale!</span> : undefined}
            <button onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? 'Collapse' : 'Expand'}
            </button>
        </div>
    );
};

// ❌ Bad: Manual memoization is unnecessary with the React Compiler
export const ProductCard = ({ product, discount }: ProductCardProps): ReactElement => {
    const [isExpanded, setIsExpanded] = useState(false);

    const discountedPrice = useMemo(() =>
        product.price * (1 - discount), [product.price, discount]
    );

    const toggleExpanded = useCallback(() => {
        setIsExpanded(!isExpanded);
    }, [isExpanded]);

    return (
        <div>
            <h3>{product.name}</h3>
            <p>{`$${discountedPrice.toFixed(2)}`}</p>
            <button onClick={toggleExpanded}>
                {isExpanded ? 'Collapse' : 'Expand'}
            </button>
        </div>
    );
};
```

### Props identity

With the React Compiler, inline objects and arrays in JSX are automatically memoized when beneficial. Write naturally and let the compiler handle referential stability.

```tsx
// ✅ Good: The compiler handles identity automatically
<Chart config={{ data, options: { responsive: true } }} />;

// ✅ Also good: Extracting to a variable for readability is fine
const config = { data, options: { responsive: true } };
<Chart config={config} markers={DEFAULT_MARKERS} />;
```

### Language anti-patterns

```ts
// ❌ Bad: Truthy hacks and coercions
const name = user.name || 'Anonymous'; // Falls back on empty string
const count = +input; // Implicit number coercion
const enabled = !!maybeTruthy; // Double negation

// ✅ Good: Explicit semantics
const name = user.name ?? 'Anonymous'; // Nullish coalescing
const count = Number(input);
const enabled = Boolean(maybeTruthy);

// ❌ Bad: Defaulting via || in params
function greet(name) {
    name = name || 'world';
}
// ✅ Good: Default parameters
function greet(name = 'world') {}

// ❌ Bad: Short-circuit invocation and nested ternaries
onClick && onClick();
const label = a ? (b ? 'x' : c ? 'y' : 'z') : 'w';
// ✅ Good: Block conditionals and early returns
if (onClick) {
    onClick();
}
let label = 'w';
if (a) {
    label = b ? 'x' : c ? 'y' : 'z';
}
```

---

## Function patterns

### Function declarations

```typescript
// ✅ Good: Clear, descriptive function names
export const calculateProductPriceWithTax = ({ basePrice, taxRate }): number => {
    return basePrice * (1 + taxRate);
};

export const validateBrandCreationInput = (input: CreateBrandInput): void => {
    if (!input.name || input.name.length < 3) {
        throw new Error('Brand name must be at least 3 characters');
    }

    if (input.price <= 0) {
        throw new Error('Brand price must be positive');
    }
};

// ❌ Bad: Abbreviated, unclear names
export const calcPrice = (p: number, t: number): number => {
    return p * (1 + t);
};

export const validate = (input: any): void => {
    if (!input.n || input.n.length < 3) throw new Error('Name too short');
    if (input.p <= 0) throw new Error('Bad price');
};
```

## Conventional programming patterns

- Prefer conventional, framework-agnostic patterns over JavaScriptisms.
- Use explicit blocks over clever one-liners; avoid short-circuit calls and terse conditionals.
- Keep logic in pure functions and use cases; React remains a thin view.

```typescript
// Strategy pattern (choose implementation at runtime)
type SortStrategy = (brands: Brand[]) => Brand[];

const sortByName: SortStrategy = (brands) => [...brands].sort((a, b) => a.name.localeCompare(b.name));
const sortByDate: SortStrategy = (brands) => [...brands].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

export const getSortedBrands = (brands: Brand[], strategy: 'name' | 'date'): Brand[] => {
    if (strategy === 'name') {
        return sortByName(brands);
    }
    return sortByDate(brands);
};

// Singleton via DI container (already used for Store, Logger, EventBus)
let instance: Store<AppState>;
export const getAppStore = (): Store<AppState> => {
    if (!instance) {
        const logger = Container.getInstance().get(Logger);
        instance = new Store<AppState>(logger, {
            initialData: {
                /* ... */
            },
        });
    }
    return instance;
};

// Adapter pattern (transformer layer maps DTO → domain)
type ApiUser = { user_id: number; full_name: string };
type User = { id: number; name: string };
export const mapUserFromApiToModel = (api: ApiUser): User => ({ id: api.user_id, name: api.full_name });

// Observer pattern (domain events)
eventBus.on(UserRegisteredEvent, (event) => {
    auditUseCase.recordRegistration(event.payload.userId);
});
```

Guidelines:

- Avoid ternaries in complex logic; prefer early returns or helper variables/functions.
- Never use short-circuit invocation `(fn && fn())`.
- Keep patterns framework-agnostic; React is only for rendering and wiring.

## Lint-aligned conventions

- **Equality and basics**: Use `===`/`!==` (no loose equality); prefer `const`; prefer template strings; no `eval`; no `debugger`.
- **Curly braces**: Required for all conditionals and loops. ([`curly`](https://eslint.org/docs/latest/rules/curly))
- **TypeScript**: Use `import { type MyType }`. ([`@typescript-eslint/consistent-type-imports`](https://typescript-eslint.io/rules/consistent-type-imports))
- **Promises**: Always handle promises (`return`/`catch`/`await`). Avoid floating promises.
- **React**: No class components; no default React import; JSX uses double quotes; no `forwardRef` (use `ref` as a prop); no manual `useMemo`/`useCallback`/`React.memo` (the React Compiler handles memoization).
- **DOM**: Prefer `textContent` over `innerText`. ([`unicorn/prefer-dom-node-text-content`](https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/prefer-dom-node-text-content.md))
- **Imports**: Enforce group order and alphabetical sort. ([`import/order`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md))
- **Storage**: Do not use `localStorage` directly; persist via `Store` with `LocalStorageStorage`. This is enforced by a custom lint rule. ([`no-restricted-syntax`](https://eslint.org/docs/latest/rules/no-restricted-syntax))

### Parameter patterns

```typescript
// ✅ Good: Descriptive parameter names
export const createBrandNotification = ({ brandName, recipientEmail, notificationType }): void => {
    // Implementation
};

// ❌ Bad: Single letter or abbreviated parameters
export const createNotif = (n: string, e: string, t: string): void => {
    // Implementation
};

// ✅ Good: Single object with descriptive properties
export const updateAssetVisibility = ({ assetId, isPublic, notifyUsers, updateMetadata }): void => {
    // Implementation
};

// ❌ Bad: Multiple boolean parameters - unclear what each does
export const updateAsset = (assetId: string, isPublic: boolean, notify: boolean, updateMeta: boolean): void => {
    // Implementation
};

// ❌ Bad: Function call is unclear without checking the signature
updateAsset('asset-123', true, false, true); // What do these booleans mean?

// ✅ Good: Function call is self-documenting
updateAssetVisibility({
    assetId: 'asset-123',
    isPublic: true,
    notifyUsers: false,
    updateMetadata: true,
});
```

---

## Common patterns

```typescript
// ✅ Good: Following all conventions
import { type ReactElement, useState } from 'react';

type BrandCardProps = {
    brand: Brand;
    onBrandSelect: (brandId: string) => void;
};

export const BrandCard = ({ brand, onBrandSelect }: BrandCardProps): ReactElement => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!brand) {
        return <div>No brand data available</div>;
    }

    if (brand.isDeleted) {
        return <div>This brand has been removed</div>;
    }

    const handleBrandClick = () => {
        onBrandSelect(brand.id);
    };

    const formattedPrice = formatCurrency(brand.price);

    return (
        <div onClick={handleBrandClick}>
            <h3>{brand.name}</h3>
            <p>{formattedPrice}</p>
            {isExpanded ? (
                <div>{brand.description}</div>
            ) : undefined}
        </div>
    );
};
```
