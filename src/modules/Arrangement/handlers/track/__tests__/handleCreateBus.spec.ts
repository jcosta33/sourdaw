import { beforeEach, describe, expect, it, vi } from 'vitest';

type AddTrackAction = {
    type: 'addTrack';
    payload: {
        color?: string;
        gain?: number;
        id?: string;
        initialAlternativeId?: string;
        kind: string;
        name: string;
    };
};

type AddTrackDescription = {
    label: string;
    inverseAction: {
        type: 'discardCreatedTrack';
        payload: {
            trackId: string;
            generatedMidiStateGuard?: { entityJson: string; midiByClipIdJson: string };
        };
    };
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
            payload: { name: 'Reverb Bus', busId: 'bus-1', initialGain: 1 },
        };

        const result = await handleCreateBus.execute(action);

        const delegatedAction = mocks.execute.mock.calls[0]?.[0];
        expect(delegatedAction).toEqual({
            type: 'addTrack',
            payload: {
                id: 'bus-1',
                name: 'Reverb Bus',
                kind: 'bus',
                gain: 1,
            },
        });
        expect(action.payload).toEqual({
            name: 'Reverb Bus',
            busId: 'bus-1',
            initialGain: 1,
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
                gain: 1,
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
            inverseAction: {
                type: 'discardCreatedTrack',
                payload: {
                    trackId: 'bus-1',
                    generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '{}' },
                },
            },
        });
    });

    it('captures the exact created bus snapshot into the discard inverse', async () => {
        const createdBus = {
            id: 'bus-1',
            name: 'Reverb Bus',
            kind: 'bus',
            gain: 1,
            color: 'oklch(0.7 0.1 200)',
            activeAlternativeId: 'alt-created',
            clips: [],
            devices: [],
            sends: [],
        };
        mocks.execute.mockReturnValue({ status: 'written' });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [createdBus] });
        const action: Parameters<typeof handleCreateBus.describe>[0] = {
            type: 'createBus',
            payload: { name: 'Reverb Bus', busId: 'bus-1', initialGain: 1 },
        };
        const description = handleCreateBus.describe(action);

        await handleCreateBus.execute(action);

        expect(description.inverseAction).toEqual({
            type: 'discardCreatedTrack',
            payload: {
                trackId: 'bus-1',
                generatedMidiStateGuard: {
                    entityJson: JSON.stringify(createdBus),
                    midiByClipIdJson: '{}',
                },
            },
        });
    });

    it('conflicts when a written add-track result has no committed bus snapshot', async () => {
        mocks.execute.mockReturnValue({ status: 'written' });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        const action = {
            type: 'createBus' as const,
            payload: { name: 'Missing Bus', busId: 'bus-1' },
        };

        expect(await handleCreateBus.execute(action)).toEqual({ status: 'conflict' });
    });

    it('rejects application-owned name and protected-route guard conflicts before adding a bus', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'room', name: 'Drum Room', outputId: 'bass' },
                { id: 'collaborator-bus', name: 'DRUM-BUS', outputId: 'master' },
            ],
        });
        const guardedAction = {
            type: 'createBus' as const,
            payload: {
                name: 'Drum Bus',
                busId: 'bus-1',
                expectedAbsentTrackNames: ['Drum Bus', 'Parallel Compression'],
                expectedTrackOutputs: [{ trackId: 'room', outputId: 'master' }],
            },
        };

        expect(await handleCreateBus.execute(guardedAction)).toEqual({ status: 'conflict' });
        expect(mocks.execute).not.toHaveBeenCalled();

        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'room', name: 'Drum Room', outputId: 'master' }] });
        mocks.execute.mockReturnValue({ status: 'written' });
        expect(await handleCreateBus.execute(guardedAction)).toEqual({ status: 'conflict' });
        expect(mocks.execute).toHaveBeenCalledOnce();
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
