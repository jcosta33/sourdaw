import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getTrackStoreState, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { addDeviceToStrip } from '#/modules/AudioEngine/useCases';

import { createDrumTrackStack } from '../createDrumTrackStack';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getTrackStoreState: vi.fn(),
        setTrackStoreState: vi.fn(),
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        addDeviceToStrip: vi.fn(),
    };
});

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('createDrumTrackStack', () => {
    beforeEach(() => {
        vi.mocked(getTrackStoreState).mockReset();
        vi.mocked(setTrackStoreState).mockReset();
        vi.mocked(addDeviceToStrip).mockReset();
    });

    it('should return null when track store is not ready', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(null);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createDrumTrackStack, { eventBus });

        expect(createDrumTrackStack()).toBeNull();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should create folder stack, wire toaster, emit track.added, and return parent id', () => {
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [], selectedTrackId: null });

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createDrumTrackStack, { eventBus });

        const parentId = createDrumTrackStack();

        expect(parentId).not.toBeNull();
        expect(setTrackStoreState).toHaveBeenCalled();
        expect(addDeviceToStrip).toHaveBeenCalledWith(parentId, expect.stringMatching(/^toaster-/), 'toaster');
        expect(eventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ trackId: parentId, kind: 'folder' })
        );
    });

    it('emits track.added for the parent and all 16 children (Finding #18)', () => {
        const committed: { tracks: Array<{ id: string; kind: string; parentId: string | null }> }[] = [];
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [], selectedTrackId: null });
        vi.mocked(setTrackStoreState).mockImplementation((next) => {
            committed.push(next as (typeof committed)[number]);
        });

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createDrumTrackStack, { eventBus });

        const parentId = createDrumTrackStack();

        // One parent + 16 children committed.
        const childIds = committed[0]!.tracks.filter((t) => t.parentId === parentId).map((t) => t.id);
        expect(childIds).toHaveLength(16);

        // A track.added fired for the parent and for every child, so downstream
        // subscribers can keep all 16 children bound to the parent.
        const addedIds = eventBus.emit.mock.calls
            .filter(([eventName]) => eventName === 'track.added')
            .map(([, payload]) => (payload as { trackId: string }).trackId);
        expect(addedIds).toContain(parentId);
        for (const childId of childIds) {
            expect(addedIds).toContain(childId);
        }
        expect(addedIds).toHaveLength(17);

        // Parent must be announced before any of its children resolve.
        const parentPos = addedIds.indexOf(parentId);
        const earliestChildPos = Math.min(...childIds.map((id) => addedIds.indexOf(id)));
        expect(parentPos).toBeLessThan(earliestChildPos);
    });
});
