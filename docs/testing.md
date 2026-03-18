# Testing

Reliable tests increase confidence and speed. This guide shows how to test the architecture effectively.

For event-driven flows, use patterns from [events](./events.md). For React components that suspend on data, wrap in `SuspenseGuard` as shown in [data fetching](./data-fetching.md).

---

## Test organization

```text
src/modules/Library/
├── _tests/                    # Test utilities and shared mocks
│   ├── LibraryDummy.ts
│   ├── getEventBus.mock.ts
│   └── WrapperQueryClient.tsx
├── useCases/
│   └── createLibrary.spec.ts
└── presentations/
    └── helpers/
        └── libraryValidator.spec.ts
```

**Co-location is key** - tests live next to the code they test.

---

## How to test your code

Our testing strategy focuses on verifying behavior at different layers of the application.

### Test naming convention

All test descriptions must follow a clear, descriptive convention. Each `it` block should start with either `should` or `should not`, followed by a concise explanation of the expected behavior. This makes test suites highly readable and immediately communicates the purpose of each test case.

**Examples:**

- `it('should return the user profile on success')`
- `it('should not allow creation of a duplicate record')`
- `it('should throw an error if the input is invalid')`

### 1. Test use cases

Test pure business logic found in use cases. This is the simplest and fastest form of testing. For more context on these concepts, see our [architecture](./architecture.md#use-cases) guide.

- **Goal**: Verify that given a specific input, the use case produces the correct output or side effect.
- **Method**: Import the use case function and call it directly in your test.

```typescript
// useCases/createLibrary.spec.ts

import { injectDependencies } from '#/helpers/DependencyInjector/injectDependencies';
import { Prophecy } from '#/helpers/Prophecy/Prophecy';

describe('createLibrary', () => {
    it('should create library and emit event on success', async () => {
        const prophecy = new Prophecy();
        const input = { name: 'test-library', type: 'design' };
        const mockLibrary = LibraryDummy.create(input);

        // Prophesize dependencies
        const createLibraryApiMock = prophecy.prophesize(createLibraryApi).mockResolvedValue(mockLibrary);
        const eventBusMock = prophecy.prophesize(EventBus);

        // Inject mocked dependencies
        injectDependencies(createLibrary, {
            createLibraryApi: createLibraryApiMock.reveal(),
            eventBus: eventBusMock.reveal(),
        });

        const result = await createLibrary(input);

        expect(result).toEqual(mockLibrary);
        expect(createLibraryApiMock).toHaveBeenCalledWith(input);
        expect(eventBusMock.emit).toHaveBeenCalledWith(new LibraryCreatedEvent(mockLibrary));
    });

    it('should throw error when repository fails', async () => {
        const prophecy = new Prophecy();
        const input = { name: 'test-library', type: 'design' };
        const error = new Error('API Error');

        const createLibraryApiMock = prophecy.prophesize(createLibraryApi).mockRejectedValue(error);
        const eventBusMock = prophecy.prophesize(EventBus);

        injectDependencies(createLibrary, {
            createLibraryApi: createLibraryApiMock.reveal(),
            eventBus: eventBusMock.reveal(),
        });

        await expect(createLibrary(input)).rejects.toThrow('API Error');
        expect(eventBusMock.emit).not.toHaveBeenCalled();
    });
});
```

### 2. Test repositories

Repositories are the bridge to external data sources. The goal is to verify that they call the correct data source (e.g., a GraphQL executor) with the correct parameters and correctly transform the raw response into a domain model.

- **Goal**: Verify the correct API endpoint is called and the data is transformed.
- **Method**: Mock the external dependency (like the GraphQL executor) and the transformer function. Call the repository and assert that the mocks were called with the expected arguments.

```typescript
// repositories/createLibraryApi.spec.ts

import { injectDependencies } from '#/helpers/DependencyInjector/injectDependencies';
import { Prophecy } from '#/helpers/Prophecy/Prophecy';

describe('createLibraryApi', () => {
    const BRAND_ID = 123;
    const ITEM_NAME = 'Test Library';
    const DUMMY_ITEM = LibraryDummy.create();
    const MOCKED_ITEM_FROM_API = LibraryApiResponseDummy.create();
    const CREATE_ITEM_INPUT: CreateLibraryApiInput = { brandId: BRAND_ID, name: ITEM_NAME };
    const MOCK_SIGNAL = new AbortController().signal;

    it('should call the executor with the correct parameters and return the transformed item', async () => {
        const prophecy = new Prophecy();
        const createLibraryExecutorMock = prophecy
            .prophesize(createLibraryExecutor)
            .mockResolvedValue({ data: { createLibrary: MOCKED_ITEM_FROM_API } });
        const libraryApiToModelMock = prophecy.prophesize(libraryApiToModel).mockResolvedValue(DUMMY_ITEM);

        injectDependencies(createLibraryApi, {
            createLibraryExecutor: createLibraryExecutorMock.reveal(),
            libraryApiToModel: libraryApiToModelMock.reveal(),
        });

        const result = await createLibraryApi(CREATE_ITEM_INPUT, MOCK_SIGNAL);

        expect(createLibraryExecutorMock).toHaveBeenCalledWith({
            input: {
                parentId: BRAND_ID.toString(),
                name: ITEM_NAME,
            },
        });
        expect(libraryApiToModelMock).toHaveBeenCalledWith(MOCKED_ITEM_FROM_API);
        expect(result).toEqual(DUMMY_ITEM);
    });

    it('should return null when creation fails', async () => {
        const prophecy = new Prophecy();
        const createLibraryExecutorMock = prophecy
            .prophesize(createLibraryExecutor)
            .mockResolvedValue({ data: { createLibrary: null } });

        injectDependencies(createLibraryApi, {
            createLibraryExecutor: createLibraryExecutorMock.reveal(),
        });

        const result = await createLibraryApi(CREATE_ITEM_INPUT, MOCK_SIGNAL);

        expect(result).toBeNull();
    });
});
```

### 3. Test transformers

Transformers are pure functions that map data from one shape to another (e.g., from an API response to a domain model). Testing them is a straightforward unit test.

- **Goal**: Verify that a source data object is correctly mapped to its target domain model.
- **Method**: Provide an input object representing the source data and assert that the output of the transformer function matches the expected shape and values.

```typescript
// transformers/libraryApiToModel.spec.ts

describe('libraryApiToModel', () => {
    it('should return a correct domain model from an API response', () => {
        const apiResponse: LibraryApiResponse = {
            id: '123',
            name: 'my-library',
            createdAt: new Date('2024-01-01T12:00:00Z'),
            creator: {
                email: 'creator@webdaw.com',
            },
            modifiedAt: null,
            modifier: null,
        };

        const expectedModel: Library = {
            id: 123,
            name: 'my-library',
            created: new Date('2024-01-01T12:00:00Z'),
            creator: 'creator@webdaw.com',
            modified: null,
            modifier: null,
        };

        // Mock for decodeBase64Id is usually needed here
        vi.mocked(decodeBase64Id).mockReturnValue({ identifier: 123 });

        const result = libraryApiToModel(apiResponse);

        expect(result).toEqual(expectedModel);
    });
});
```

### 4. Test components

Use React Testing Library to test components from a user's perspective. Assert that the correct content is rendered and that user interactions trigger the expected outcomes.

```tsx
// Library/presentations/components/LibraryList.spec.tsx

describe('LibraryList', () => {
    it('should render libraries when loaded', () => {
        const libraries = [LibraryDummy.create({ name: 'Library 1' })];

        render(
            <SuspenseGuard>
                <LibraryList libraries={libraries} />
            </SuspenseGuard>
        );

        expect(screen.getByText('Library 1')).toBeInTheDocument();
    });

    it('should handle library creation', async () => {
        const onCreateLibrary = vi.fn();

        render(<CreateLibraryDialog onSubmit={onCreateLibrary} />);

        fireEvent.change(screen.getByLabelText('Name'), {
            target: { value: 'New Library' },
        });
        fireEvent.click(screen.getByText('Create'));

        await waitFor(() => {
            expect(onCreateLibrary).toHaveBeenCalledWith({
                name: 'New Library',
                type: 'design',
            });
        });
    });

    it('should display the component with the correct data', () => {
        const mockBrand = BrandDummy.create();
        render(<BrandCard brand={mockBrand} />);
        expect(screen.getByText(mockBrand.name)).toBeInTheDocument();
    });
});
```

### 5. Test event subscriptions

Use the mock event bus to test how components or hooks react to domain events. You can find a complete guide on this pattern in the [events](./events.md) documentation.

- **Goal**: Verify that a component re-renders or a hook behaves correctly when a relevant event is published.
- **Method**: Render the component, publish an event using the mock bus, and assert the expected change.

```typescript
// events/subscribeToLibraryCreated.spec.ts

import { injectDependencies } from '#/helpers/DependencyInjector/injectDependencies';
import { Prophecy } from '#/helpers/Prophecy/Prophecy';

describe('subscribeToLibraryCreated', () => {
    it('should subscribe to the event bus and call the callback when the event is triggered', () => {
        const prophecy = new Prophecy();
        const callback = vi.fn();
        const dummyLibrary = LibraryDummy.create();
        const eventBusMock = prophecy.prophesize(EventBus);

        // Inject the mocked event bus
        injectDependencies(subscribeToLibraryCreated, {
            eventBus: eventBusMock.reveal(),
        });

        // Call the subscription helper
        subscribeToLibraryCreated(callback);

        // Verify that eventBus.on was called correctly
        expect(eventBusMock.on).toHaveBeenCalledWith(LibraryCreatedEvent, expect.any(Function));

        // Simulate the event being fired by calling the handler passed to eventBus.on
        const handler = (eventBusMock.on as any).mock.calls[0][1];
        handler({ payload: dummyLibrary });

        // Assert that the original callback was called with the event payload
        expect(callback).toHaveBeenCalledWith(dummyLibrary);
    });
});
```

---

## Further guidance and patterns

### Test organization

Tests should be co-located with the code they are testing. Shared test utilities, such as dummy data factories or mock setups, can be placed in a `_tests/` directory at the module root.

```text
src/modules/Library/
├── _tests/                    # Test utilities and shared mocks
│   ├── LibraryDummy.ts
│   ├── getEventBus.mock.ts
│   └── WrapperQueryClient.tsx
├── useCases/
│   └── createLibrary.spec.ts
└── presentations/
    └── helpers/
        └── libraryValidator.spec.ts
```

### Testing helpers and validation

Pure functions, like helpers and validation schemas, are excellent candidates for unit tests.

```typescript
// presentations/helpers/libraryListMutator.spec.ts

describe('libraryListMutator', () => {
    const DUMMY_LIBRARIES = LibrariesDummy.create({ length: 5 });
    const DUMMY_NEW_LIBRARY = LibraryDummy.create();

    it('should update the libraries list when a new library has been created', () => {
        const expectedLibraries = [...DUMMY_LIBRARIES, DUMMY_NEW_LIBRARY];

        const libraries = getLibraryListWithAddedLibrary(DUMMY_LIBRARIES, DUMMY_NEW_LIBRARY);

        expect(libraries).toEqual(expectedLibraries);
    });

    it('should update the libraries list when a library has been removed', () => {
        const libraryToRemove = DUMMY_LIBRARIES[2];
        const expectedLibraries = DUMMY_LIBRARIES.filter((library) => library.id !== libraryToRemove.id);

        const libraries = getLibraryListWithDeletedLibrary(DUMMY_LIBRARIES, libraryToRemove);

        expect(libraries).toEqual(expectedLibraries);
    });
});
```

### Validation testing

```typescript
// presentations/helpers/validateLibraryDeletionForm.spec.ts

describe('validateLibraryDeletionForm', () => {
    const libraryDeletionFormSchema = getLibraryDeletionFormSchema((key) => key);

    it('should validate a correct form input', async () => {
        const validInput = {
            confirmation: 'DeleteLibrary_form_confirmationText',
        };

        const result = await libraryDeletionFormSchema.validate(validInput);
        expect(result).toEqual(validInput);
    });

    it('should fail validation when confirmation text is not correct', async () => {
        const invalidInput = {
            confirmation: 'not good',
        };

        await expect(libraryDeletionFormSchema.validate(invalidInput)).rejects.toThrow(
            'DeleteLibrary_form_confirmationTextError'
        );
    });
});
```

### Test utilities

#### Dummy data factories

Create dummy data factories to generate consistent and realistic test data.

```typescript
// Library/_tests/LibraryDummy.ts

export const LibraryDummy = {
    create: (overrides?: Partial<Library>): Library => ({
        id: Math.floor(Math.random() * 1000),
        name: 'test-library',
        type: 'design',
        createdAt: new Date(),
        ...overrides,
    }),
};

export const LibrariesDummy = {
    create: ({ length }: { length: number }): Library[] =>
        Array.from({ length }, (_, index) =>
            LibraryDummy.create({
                id: index + 1,
                name: `library-${index + 1}`,
                type: 'design',
            })
        ),
};
```

#### Mocking utilities

Use `vi.mock` to provide controlled, fake implementations of dependencies like the event bus.

```typescript
// Library/_tests/getEventBus.mock.ts

export const onMock = vi.fn();
export const emitMock = vi.fn();
export const unsubscribeMock = vi.fn();

vi.mock('#/helpers/Event/EventBus', () => ({
    getEventBus: () => ({
        on: onMock.mockReturnValue(unsubscribeMock),
        emit: emitMock,
    }),
}));
```

#### Query client wrapper

When testing components that use TanStack Query, wrap them in a `QueryClientProvider` to provide the necessary context.

```tsx
// Library/_tests/WrapperQueryClient.tsx

export const WrapperQueryClient = ({ children }: { children: ReactNode }) => {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: { retry: false },
                    mutations: { retry: false },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
        </QueryClientProvider>
    );
};
```
