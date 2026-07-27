import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    addTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string }[] } | null>(),
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
        handleAddTrack.describe(action);
        const trackId = action.payload.id;
        if (!trackId) {
            throw new Error('Expected describe to prepare a track id');
        }
        mocks.addTrack.mockReturnValue({ id: trackId, name: 'Bass', kind: 'audio' });

        const result = await handleAddTrack.execute(action);

        expect(mocks.addTrack).toHaveBeenCalledTimes(1);
        expect(mocks.addTrack).toHaveBeenCalledWith({
            id: trackId,
            name: 'Bass',
            kind: 'audio',
            select: false,
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
            suppressAddedEvent: true,
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
                payload: { trackId },
            },
        });
        expect(trackId).toMatch(/^track-ai-/);
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
