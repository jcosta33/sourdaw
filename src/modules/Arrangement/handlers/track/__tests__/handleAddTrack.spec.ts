import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    addTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; name?: string; kind?: string }[] } | null>(),
    publishTrackAdded: vi.fn(),
}));

vi.mock('../../../useCases/addTrack', () => ({ addTrack: mocks.addTrack }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../useCases/publishTrackAdded', () => ({ publishTrackAdded: mocks.publishTrackAdded }));

import { handleAddTrack } from '../handleAddTrack';

describe('handleAddTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
    });

    it('is undoable', () => {
        expect(handleAddTrack.undoable).toBe(true);
    });

    it('honors an app-owned selection policy and publishes only after commit', async () => {
        const action: Parameters<typeof handleAddTrack.describe>[0] = {
            type: 'addTrack',
            payload: { name: 'Bass', kind: 'audio', select: false },
        };
        const described = handleAddTrack.describe(action);
        const trackId = action.payload.id;
        if (!trackId) {
            throw new Error('Expected describe to prepare a track id');
        }
        const createdTrack = { id: trackId, name: 'Bass', kind: 'audio' };
        mocks.addTrack.mockReturnValue(createdTrack);

        const result = await handleAddTrack.execute(action);

        // Execute finalizes the guard embedded in the inverse: an
        // unfinalized entityJson would make undo of addTrack conflict-fail
        // against isGeneratedMidiStateCurrent.
        const inverse = described?.inverseAction;
        if (!inverse || inverse.type !== 'discardCreatedTrack') {
            throw new Error('Expected a discardCreatedTrack inverse');
        }
        expect(inverse.payload.generatedMidiStateGuard?.entityJson).toBe(JSON.stringify(createdTrack));

        expect(mocks.addTrack).toHaveBeenCalledTimes(1);
        expect(mocks.addTrack).toHaveBeenCalledWith({
            id: trackId,
            name: 'Bass',
            kind: 'audio',
            select: false,
            color: action.payload.color,
            initialAlternativeId: action.payload.initialAlternativeId,
            suppressAddedEvent: true,
        });
        expect(trackId).toMatch(/^track-ai-/);
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();

        await result?.afterCommit?.();

        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId,
            name: 'Bass',
            kind: 'audio',
        });
    });

    it('preserves the default selection behavior for ordinary commands', async () => {
        const action: Parameters<typeof handleAddTrack.describe>[0] = {
            type: 'addTrack',
            payload: { name: 'Guitar', kind: 'audio' },
        };
        handleAddTrack.describe(action);
        const trackId = action.payload.id;
        if (!trackId) {
            throw new Error('Expected describe to prepare a track id');
        }
        mocks.addTrack.mockReturnValue({ id: trackId, name: 'Guitar', kind: 'audio' });

        await handleAddTrack.execute(action);

        expect(mocks.addTrack).toHaveBeenCalledWith({
            id: trackId,
            name: 'Guitar',
            kind: 'audio',
            color: action.payload.color,
            initialAlternativeId: action.payload.initialAlternativeId,
            suppressAddedEvent: true,
        });
    });

    it('pins per-execute creation inputs so redo reproduces identical content', () => {
        // Redo re-executes the original action. The color comes from an
        // advancing palette counter and the alternative/device ids from fresh
        // UUIDs — minted per execute they would make the recreated track
        // diverge from the discard guard, and the undo after a redo would
        // conflict. ensureStableCreationInputs pins them on the payload once.
        const action: Parameters<typeof handleAddTrack.describe>[0] = {
            type: 'addTrack',
            payload: { name: 'Keys', kind: 'midi' },
        };
        handleAddTrack.describe(action);
        const pinned = {
            color: action.payload.color,
            initialAlternativeId: action.payload.initialAlternativeId,
            initialDeviceId: action.payload.initialDeviceId,
        };
        expect(pinned.color).toEqual(expect.any(String));
        expect(pinned.initialAlternativeId).toEqual(expect.any(String));
        expect(pinned.initialDeviceId).toEqual(expect.any(String));

        handleAddTrack.describe(action);
        expect(action.payload.color).toBe(pinned.color);
        expect(action.payload.initialAlternativeId).toBe(pinned.initialAlternativeId);
        expect(action.payload.initialDeviceId).toBe(pinned.initialDeviceId);

        // Explicit inputs are never overwritten.
        const explicit: Parameters<typeof handleAddTrack.describe>[0] = {
            type: 'addTrack',
            payload: {
                name: 'Custom',
                kind: 'audio',
                color: '#123456',
                initialAlternativeId: 'alt-explicit',
            },
        };
        handleAddTrack.describe(explicit);
        expect(explicit.payload.color).toBe('#123456');
        expect(explicit.payload.initialAlternativeId).toBe('alt-explicit');
        expect(explicit.payload.initialDeviceId).toBeUndefined();
    });

    it('publishes only a track found in durable truth after an ambiguous commit', async () => {
        const action = {
            type: 'addTrack',
            payload: { id: 'created', name: 'Requested', kind: 'audio' },
        } as const;
        mocks.addTrack.mockReturnValue({ id: 'created', name: 'Requested', kind: 'audio' });
        const result = await handleAddTrack.execute(action);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'created', name: 'Committed', kind: 'audio' }],
        });

        await result?.afterAmbiguousCommit?.();

        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId: 'created',
            name: 'Committed',
            kind: 'audio',
        });
    });

    it('describes an inverse that removes the exact created track', () => {
        const action: Parameters<typeof handleAddTrack.describe>[0] = {
            type: 'addTrack',
            payload: { name: 'Keys', kind: 'midi' },
        };
        const described = handleAddTrack.describe(action);
        const trackId = action.payload.id;
        if (!trackId) {
            throw new Error('Expected describe to prepare a track id');
        }

        expect(described).toEqual({
            label: 'Add midi track "Keys"',
            inverseAction: {
                type: 'discardCreatedTrack',
                payload: {
                    trackId,
                    // The guard makes the discard inverse reapply-safe inside
                    // atomic batches; execute finalizes entityJson once the
                    // track lands.
                    generatedMidiStateGuard: {
                        entityJson: '',
                        midiByClipIdJson: '{}',
                    },
                },
            },
        });
        expect(trackId).toMatch(/^track-ai-/);
    });

    it('describes an inverse whose compensation is guarded for atomic batches', () => {
        // executeAppActionBatch's atomic guard requires the inverse handler's
        // canReapplyAfterDivergence to hold; without the guard on the discard
        // inverse, any atomic batch containing addTrack is rejected.
        const action: Parameters<typeof handleAddTrack.describe>[0] = {
            type: 'addTrack',
            payload: { name: 'Keys', kind: 'midi' },
        };
        const described = handleAddTrack.describe(action);
        const inverse = described.inverseAction;
        if (!inverse || inverse.type !== 'discardCreatedTrack') {
            throw new Error('Expected a discardCreatedTrack inverse');
        }
        expect(inverse.payload.generatedMidiStateGuard).toBeDefined();
    });

    it('does not claim compensation when the prepared id collides', () => {
        const action = {
            type: 'addTrack',
            payload: { id: 'existing', name: 'Keys', kind: 'midi' },
        } as const;
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'existing' }] });

        expect(handleAddTrack.describe(action).inverseAction).toBeNull();
        expect(handleAddTrack.isNoop?.(action)).toBe(true);
    });
});
