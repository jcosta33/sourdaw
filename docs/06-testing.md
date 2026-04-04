# Testing

Reliable tests increase confidence and speed. This guide shows how to test the architecture effectively.

For event-driven flows, use patterns from [events](./04-events.md). For React components that suspend on data, wrap them in a `SuspenseGuard`.

---

## Test organization

```text
src/modules/Arrangement/
├── _tests/                    # Test utilities and shared mocks
│   ├── TrackDummy.ts
│   ├── getEventBus.mock.ts
│   └── WrapperQueryClient.tsx
├── useCases/
│   └── addTrack.spec.ts
└── presentations/
    └── helpers/
        └── trackValidator.spec.ts
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
// useCases/addTrack.spec.ts

import { addTrack } from './addTrack';
import { addTrackApi } from '../repositories/addTrackApi';

vi.mock('../repositories/addTrackApi');
vi.mock('#/helpers/Event/EventBus', () => import('../_tests/getEventBus.mock'));

describe('addTrack', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should create track and emit event on success', async () => {
        const input = { name: 'Lead Vocals', kind: 'audio' as const };
        const mockTrack = TrackDummy.create(input);

        vi.mocked(addTrackApi).mockResolvedValue(mockTrack);

        const result = await addTrack(input);

        expect(result).toEqual(mockTrack);
        expect(vi.mocked(addTrackApi)).toHaveBeenCalledWith(input);
        expect(emitMock).toHaveBeenCalledWith(new TrackAddedEvent(mockTrack));
    });

    it('should throw error when repository fails', async () => {
        const input = { name: 'Lead Vocals', kind: 'audio' as const };

        vi.mocked(addTrackApi).mockRejectedValue(new Error('API Error'));

        await expect(addTrack(input)).rejects.toThrow('API Error');
        expect(emitMock).not.toHaveBeenCalled();
    });
});
```

### 2. Test repositories

Repositories are the bridge to external data sources. The goal is to verify that they call the correct data source (e.g., a GraphQL executor) with the correct parameters and correctly transform the raw response into a domain model.

- **Goal**: Verify the correct API endpoint is called and the data is transformed.
- **Method**: Mock the external dependency (like the GraphQL executor) and the transformer function. Call the repository and assert that the mocks were called with the expected arguments.

```typescript
// repositories/addTrackApi.spec.ts

import { addTrackApi } from './addTrackApi';
import { addTrackExecutor } from '../executors/addTrackExecutor';
import { trackApiToModel } from '../transformers/trackApiToModel';

vi.mock('../executors/addTrackExecutor');
vi.mock('../transformers/trackApiToModel');

describe('addTrackApi', () => {
    const PROJECT_ID = 'proj-123';
    const ITEM_NAME = 'Lead Vocals';
    const DUMMY_ITEM = TrackDummy.create();
    const MOCKED_ITEM_FROM_API = TrackApiResponseDummy.create();
    const CREATE_ITEM_INPUT: AddTrackApiInput = { projectId: PROJECT_ID, name: ITEM_NAME, kind: 'audio' };
    const MOCK_SIGNAL = new AbortController().signal;

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should call the executor with the correct parameters and return the transformed item', async () => {
        vi.mocked(addTrackExecutor).mockResolvedValue({ data: { addTrack: MOCKED_ITEM_FROM_API } });
        vi.mocked(trackApiToModel).mockReturnValue(DUMMY_ITEM);

        const result = await addTrackApi(CREATE_ITEM_INPUT, MOCK_SIGNAL);

        expect(vi.mocked(addTrackExecutor)).toHaveBeenCalledWith({
            input: {
                projectId: PROJECT_ID,
                name: ITEM_NAME,
                kind: 'audio',
            },
        });
        expect(vi.mocked(trackApiToModel)).toHaveBeenCalledWith(MOCKED_ITEM_FROM_API);
        expect(result).toEqual(DUMMY_ITEM);
    });

    it('should return null when creation fails', async () => {
        vi.mocked(addTrackExecutor).mockResolvedValue({ data: { addTrack: null } });

        const result = await addTrackApi(CREATE_ITEM_INPUT, MOCK_SIGNAL);

        expect(result).toBeNull();
    });
});
```

### 3. Test transformers

Transformers are pure functions that map data from one shape to another (e.g., from an API response to a domain model). Testing them is a straightforward unit test.

- **Goal**: Verify that a source data object is correctly mapped to its target domain model.
- **Method**: Provide an input object representing the source data and assert that the output of the transformer function matches the expected shape and values.

```typescript
// transformers/trackApiToModel.spec.ts

describe('trackApiToModel', () => {
    it('should return a correct domain model from an API response', () => {
        const apiResponse: TrackApiResponse = {
            id: 'track-123',
            name: 'Lead Vocals',
            kind: 'audio',
            color: '#ff0000',
            createdAt: new Date('2024-01-01T12:00:00Z'),
        };

        const expectedModel: Track = {
            id: 'track-123',
            name: 'Lead Vocals',
            kind: 'audio',
            color: '#ff0000',
            createdAt: new Date('2024-01-01T12:00:00Z'),
        };

        const result = trackApiToModel(apiResponse);

        expect(result).toEqual(expectedModel);
    });
});
```

### 4. Test components

Use React Testing Library to test components from a user's perspective. Assert that the correct content is rendered and that user interactions trigger the expected outcomes.

```tsx
// Track/presentations/components/TrackList.spec.tsx

describe('TrackList', () => {
    it('should render tracks when loaded', () => {
        const tracks = [TrackDummy.create({ name: 'Drums' })];

        render(
            <SuspenseGuard>
                <TrackList tracks={tracks} />
            </SuspenseGuard>
        );

        expect(screen.getByText('Drums')).toBeInTheDocument();
    });

    it('should handle track creation', async () => {
        const onAddTrack = vi.fn();

        render(<AddTrackDialog onSubmit={onAddTrack} />);

        fireEvent.change(screen.getByLabelText('Name'), {
            target: { value: 'New Synth' },
        });
        fireEvent.click(screen.getByText('Add'));

        await waitFor(() => {
            expect(onAddTrack).toHaveBeenCalledWith({
                name: 'New Synth',
                kind: 'midi',
            });
        });
    });

    it('should display the component with the correct data', () => {
        const mockTrack = TrackDummy.create();
        render(<TrackHeader track={mockTrack} />);
        expect(screen.getByText(mockTrack.name)).toBeInTheDocument();
    });
});
```

### 5. Test event subscriptions

Use the mock event bus to test how components or hooks react to domain events. You can find a complete guide on this pattern in the [events](./04-events.md) documentation.

- **Goal**: Verify that a component re-renders or a hook behaves correctly when a relevant event is published.
- **Method**: Render the component, publish an event using the mock bus, and assert the expected change.

```typescript
// events/subscribeToTrackAdded.spec.ts

import { subscribeToTrackAdded } from './subscribeToTrackAdded';

vi.mock('#/helpers/Event/EventBus', () => import('../_tests/getEventBus.mock'));

describe('subscribeToTrackAdded', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should subscribe to the event bus and call the callback when the event is triggered', () => {
        const callback = vi.fn();
        const dummyTrack = TrackDummy.create();

        // Call the subscription helper
        subscribeToTrackAdded(callback);

        // Verify that eventBus.on was called correctly
        expect(onMock).toHaveBeenCalledWith(TrackAddedEvent, expect.any(Function));

        // Simulate the event being fired by calling the handler passed to eventBus.on
        const handler = onMock.mock.calls[0][1];
        handler({ payload: dummyTrack });

        // Assert that the original callback was called with the event payload
        expect(callback).toHaveBeenCalledWith(dummyTrack);
    });
});
```

---

## Further guidance and patterns

### Test organization

Tests should be co-located with the code they are testing. Shared test utilities, such as dummy data factories or mock setups, can be placed in a `_tests/` directory at the module root.

```text
src/modules/Arrangement/
├── _tests/                    # Test utilities and shared mocks
│   ├── TrackDummy.ts
│   ├── getEventBus.mock.ts
│   └── WrapperQueryClient.tsx
├── useCases/
│   └── addTrack.spec.ts
└── presentations/
    └── helpers/
        └── trackValidator.spec.ts
```

### Testing helpers and validation

Pure functions, like helpers and validation schemas, are excellent candidates for unit tests.

```typescript
// presentations/helpers/trackListMutator.spec.ts

describe('trackListMutator', () => {
    const DUMMY_TRACKS = TracksDummy.create({ length: 5 });
    const DUMMY_NEW_TRACK = TrackDummy.create();

    it('should update the tracks list when a new track has been added', () => {
        const expectedTracks = [...DUMMY_TRACKS, DUMMY_NEW_TRACK];

        const tracks = getTrackListWithAddedTrack(DUMMY_TRACKS, DUMMY_NEW_TRACK);

        expect(tracks).toEqual(expectedTracks);
    });

    it('should update the tracks list when a track has been removed', () => {
        const trackToRemove = DUMMY_TRACKS[2];
        const expectedTracks = DUMMY_TRACKS.filter((track) => track.id !== trackToRemove.id);

        const tracks = getTrackListWithDeletedTrack(DUMMY_TRACKS, trackToRemove);

        expect(tracks).toEqual(expectedTracks);
    });
});
```

### Validation testing

```typescript
// presentations/helpers/validateTrackDeletionForm.spec.ts

describe('validateTrackDeletionForm', () => {
    const trackDeletionFormSchema = getTrackDeletionFormSchema((key) => key);

    it('should validate a correct form input', async () => {
        const validInput = {
            confirmation: 'DeleteTrack_form_confirmationText',
        };

        const result = await trackDeletionFormSchema.validate(validInput);
        expect(result).toEqual(validInput);
    });

    it('should fail validation when confirmation text is not correct', async () => {
        const invalidInput = {
            confirmation: 'not good',
        };

        await expect(trackDeletionFormSchema.validate(invalidInput)).rejects.toThrow(
            'DeleteTrack_form_confirmationTextError'
        );
    });
});
```

### Test utilities

#### Dummy data factories

Create dummy data factories to generate consistent and realistic test data.

```typescript
// Track/_tests/TrackDummy.ts

export const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => ({
        id: `track-${Math.floor(Math.random() * 1000)}`,
        name: 'Lead Vocals',
        kind: 'audio',
        color: '#ff0000',
        createdAt: new Date(),
        ...overrides,
    }),
};

export const TracksDummy = {
    create: ({ length }: { length: number }): Track[] =>
        Array.from({ length }, (_, index) =>
            TrackDummy.create({
                id: `track-${index + 1}`,
                name: `Track ${index + 1}`,
                kind: 'audio',
            })
        ),
};
```

#### Mocking utilities

Use `vi.mock` to provide controlled, fake implementations of dependencies like the event bus.

```typescript
// Track/_tests/getEventBus.mock.ts

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
// Track/_tests/WrapperQueryClient.tsx

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
