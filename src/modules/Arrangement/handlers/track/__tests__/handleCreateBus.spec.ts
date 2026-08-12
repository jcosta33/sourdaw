import { beforeEach, describe, expect, it, vi } from 'vitest';

type AddTrackAction = {
    type: 'addTrack';
    payload: {
        color?: string;
        id?: string;
        initialAlternativeId?: string;
        kind: string;
        name: string;
    };
};

type AddTrackDescription = {
    label: string;
    inverseAction: { type: 'discardCreatedTrack'; payload: { trackId: string } };
};

const mocks = vi.hoisted(() => ({
    execute: vi.fn<(action: AddTrackAction) => unknown>(),
    describe: vi.fn<(action: AddTrackAction) => AddTrackDescription>(),
    getTrackStoreState: vi.fn(),
    isNoop: vi.fn<(action: AddTrackAction) => boolean>(),
}));

vi.mock('../handleAddTrack', () => ({
    handleAddTrack: {
        execute: mocks.execute,
        describe: mocks.describe,
        isNoop: mocks.isNoop,
    },
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

import { handleCreateBus } from '../handleCreateBus';

describe('handleCreateBus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.describe.mockReturnValue({
            label: 'Add bus track',
            inverseAction: { type: 'discardCreatedTrack', payload: { trackId: 'bus-1' } },
        });
        mocks.isNoop.mockReturnValue(false);
    });

    it('executes through the canonical add-track handler with a stable bus identity', async () => {
        const deferredEffects = { status: 'written' as const, afterCommit: vi.fn(), afterAmbiguousCommit: vi.fn() };
        mocks.execute.mockReturnValue(deferredEffects);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'bus-1',
                    color: 'oklch(0.7 0.1 200)',
                    activeAlternativeId: 'alt-created',
                },
            ],
        });
        const action = {
            type: 'createBus' as const,
            payload: { name: 'Reverb Bus', busId: 'bus-1' },
        };

        const result = await handleCreateBus.execute(action);

        const delegatedAction = mocks.execute.mock.calls[0]?.[0];
        expect(delegatedAction).toEqual({
            type: 'addTrack',
            payload: {
                id: 'bus-1',
                name: 'Reverb Bus',
                kind: 'bus',
            },
        });
        expect(action.payload).toEqual({
            name: 'Reverb Bus',
            busId: 'bus-1',
            color: 'oklch(0.7 0.1 200)',
            initialAlternativeId: 'alt-created',
        });
        expect(result).toBe(deferredEffects);

        mocks.execute.mockClear();
        await handleCreateBus.execute(action);
        expect(mocks.execute).toHaveBeenCalledWith({
            type: 'addTrack',
            payload: {
                id: 'bus-1',
                name: 'Reverb Bus',
                kind: 'bus',
                color: 'oklch(0.7 0.1 200)',
                initialAlternativeId: 'alt-created',
            },
        });
    });

    it('prepares one replay identity and preserves the add-track inverse', () => {
        const action: Parameters<typeof handleCreateBus.describe>[0] = {
            type: 'createBus',
            payload: { name: 'Drum Bus' },
        };

        const description = handleCreateBus.describe(action);
        const busId = action.payload.busId;
        if (!busId) {
            throw new Error('Expected describe to prepare a bus id');
        }

        expect(busId).toMatch(/^bus-ai-/);
        const delegatedAction = mocks.describe.mock.calls[0]?.[0];
        expect(delegatedAction).toEqual({
            type: 'addTrack',
            payload: {
                id: busId,
                name: 'Drum Bus',
                kind: 'bus',
            },
        });
        expect(description).toEqual({
            label: 'Create bus "Drum Bus"',
            inverseAction: { type: 'discardCreatedTrack', payload: { trackId: 'bus-1' } },
        });
    });

    it('delegates no-op detection for retry-safe receipts', () => {
        mocks.isNoop.mockReturnValue(true);
        const action = {
            type: 'createBus' as const,
            payload: { name: 'Parallel Bus', busId: 'bus-existing' },
        };

        expect(handleCreateBus.isNoop?.(action)).toBe(true);
        const delegatedAction = mocks.isNoop.mock.calls[0]?.[0];
        expect(delegatedAction).toEqual({
            type: 'addTrack',
            payload: {
                id: 'bus-existing',
                name: 'Parallel Bus',
                kind: 'bus',
            },
        });
    });

    it('is undoable without pre-commit abort compensation', () => {
        expect(handleCreateBus.undoable).toBe(true);
        expect(handleCreateBus.requiresAbortCompensation).toBe(false);
    });
});
