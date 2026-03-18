---
applyTo: "**/*.{ts,tsx}"
---

# Typescript code

## Rules

- methods with more than 2 parameters should use object input and destructuring.

---
applyTo: "**/*.spec.{ts,tsx}"
---
# Test Files (Vitest + React)

## Quick example

```ts
import { dependency } from '/dependency'

vi.mock(import('/dependency'));

describe('Dependency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dependency).mockReturnValue({});
  });
})
```

## Rules

- import mocks: `vi.mock('file')` => `vi.mock(import('file'))`
  - do not use the the mockFactory, unless absolutly needed
  - always place imports at the top, even for mocked dependencies.
- do not mock `react-i18n`, `react-query` and `react-form-hooks` and /helper methods
- add wrapper for `ReactQueryProvider` when component or hook is using `react-query`
- check if there are Dummy classes to create input Dto's and use them.
- Do not use any comments, except to explain an exception.

## Quick Autofix Patterns (Copilot: apply when violations are detected)
	
- Replace:
```ts
vi.mock('x')
```
  with:
```ts
vi.mock(import('x'))
```

- Move any `vi.mock(...)` that appear before imports to **after** the last import.

- Turn Spies into Mocks.

- If React Query is used without a provider, wrap the rendered UI:
```tsx
const queryClient = new QueryClient();
const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
render(ui, { wrapper });
```

- Replace ad-hoc object literals with available Dummy/Factory calls.

- Remove stray comments that don’t justify an exception.
