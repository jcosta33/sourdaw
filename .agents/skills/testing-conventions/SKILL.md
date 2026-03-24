---
name: testing-conventions
description: >
    Apply when writing tests for use cases, repositories, transformers, components, or event subscribers. Enforces Vitest + React Testing Library patterns: `Prophecy` for mocking dependencies, `injectDependencies` for useCases, `vi.mock(import(...))` for module mocking, co-locating tests, and following strict naming conventions. Apply even when the user says "test", "spec", "mock", "assert", or "verify".
---

## Setup

All tests must be co-located with the code they test.
Test descriptions must start with `should` or `should not`.

```text
src/modules/Arrangement/
├── _tests/                    # Test utilities and shared mocks
│   ├── TrackDummy.ts
│   └── getEventBus.mock.ts
├── useCases/
│   └── addTrack.spec.ts       # Co-located spec
```

## Core Patterns

### 1. Test use cases with Prophecy and injectDependencies

Use cases contain business logic and dispatch events. Mock repositories and the EventBus with the custom `Prophecy` tool.

```typescript
// src/modules/Arrangement/useCases/addTrack.spec.ts

import { injectDependencies } from '#/helpers/DependencyInjector/injectDependencies';
import { Prophecy } from '#/helpers/Prophecy/Prophecy';
import { addTrack } from './addTrack';
import { createTrackApi } from '../repositories/createTrackApi';
import { EventBus } from '#/helpers/Event/EventBus';
import { TrackAddedEvent } from '../events/TrackAddedEvent';
import { TrackDummy } from '../_tests/TrackDummy';

describe('addTrack', () => {
    it('should create a track and emit an event on success', async () => {
        const prophecy = new Prophecy();
        const input = { projectId: 'p1', name: 'Kick', kind: 'audio' as const };
        const mockTrack = TrackDummy.create(input);

        // Prophesize dependencies
        const createTrackApiMock = prophecy.prophesize(createTrackApi).mockResolvedValue(mockTrack);
        const eventBusMock = prophecy.prophesize(EventBus);

        // Inject mocked dependencies into the use case wrapper
        injectDependencies(addTrack, {
            createTrackApi: createTrackApiMock.reveal(),
            eventBus: eventBusMock.reveal(),
        });

        const result = await addTrack(input);

        expect(result).toEqual(mockTrack);
        expect(createTrackApiMock).toHaveBeenCalledWith(input);
        
        // Match the exact class instance emission for EventBus
        expect(eventBusMock.emit).toHaveBeenCalledWith(new TrackAddedEvent({
            trackId: mockTrack.id,
            name: mockTrack.name,
            kind: mockTrack.kind,
        }));
    });
});
```

### 2. Test React Components (DOM Testing)

Use `@testing-library/react` for UI component testing. Use ARIA attributes and roles to find targets (`getByRole`, `getByLabelText`) rather than `getByTestId` or `querySelector`. Add `SuspenseGuard` if testing Suspense-based components.

```tsx
// src/modules/Arrangement/presentations/components/TrackControls.spec.tsx

import { render, screen, fireEvent } from '@testing-library/react';
import { TrackControls } from './TrackControls';
import { vi } from 'vitest';

describe('TrackControls', () => {
    it('should call onToggleMute when the mute button is clicked', () => {
        const onToggleMute = vi.fn();
        
        render(
            <TrackControls 
                trackId="t1" 
                isMuted={false} 
                isSolo={false} 
                onToggleMute={onToggleMute} 
                onToggleSolo={vi.fn()} 
            />
        );

        // Use accessible name queries
        const muteButton = screen.getByRole('button', { name: 'Mute track' });
        
        // Check ARIA state
        expect(muteButton).toHaveAttribute('aria-pressed', 'false');
        
        fireEvent.click(muteButton);
        expect(onToggleMute).toHaveBeenCalledOnce();
    });
});
```

### 3. Dummy Data Factories

Never use scattered hardcoded objects. Create reusable Dummies in `_tests/` with default valid fields that can be partially overridden.

```typescript
// src/modules/Arrangement/_tests/TrackDummy.ts

import type { Track } from '../models/Track';

export const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => ({
        id: 'track-default-1',
        name: 'Default Track',
        kind: 'audio',
        color: '#ff0000',
        isMuted: false,
        isSoloed: false,
        isArmed: false,
        gainDb: 0,
        pan: 0,
        inputSource: null,
        pluginChain: [],
        ...overrides,
    }),
};
```

### 4. vi.mock() with import()

When mocking full module exports, follow Vitest best practices for async module mocking to preserve types.

```typescript
vi.mock('#/modules/Project/stores/projectStore', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Project/stores/projectStore')>();
    return {
        ...mod,
        useProjectStore: vi.fn(),
    };
});
```

## Common Mistakes

### CRITICAL Injecting inside hooks or non-useCases

`injectDependencies` works exclusively with `inject()`-wrapped use cases. Do not attempt to use `injectDependencies` on React hooks, UI components, or standard functions.

### CRITICAL Using non-semantic element queries

Wrong: `screen.getByText('M')` or `container.querySelector('.mute-btn')`
Correct: `screen.getByRole('button', { name: 'Mute track' })`

### HIGH Incomplete event payloads
When testing `eventBusMock.emit`, ensure you assert against the fully instantiated `DomainEvent` class, not a string or plain object, as the bus strictly keys off constructors.
