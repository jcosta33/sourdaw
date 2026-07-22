import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handleCreateTrackAlternative } from '../handleCreateTrackAlternative';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackStoreState: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackStoreState', () => ({
    setTrackStoreState: mocks.setTrackStoreState,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('handleCreateTrackAlternative', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup a basic state with one track and one alternative
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'clip1' }],
                    alternatives: [{ id: 'alt1', name: 'Alt 1', clips: [] }],
                },
            ],
        });
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('creates a new empty alternative and switches to it', () => {
        const result = handleCreateTrackAlternative.execute({
            type: 'createTrackAlternative',
            payload: { trackId: 't1', name: 'New Alt', duplicateActive: false },
        });

        expect(mocks.setTrackStoreState).toHaveBeenCalledTimes(1);
        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to be called');
        }
        const newState = firstCall[0];
        const track = newState.tracks[0];

        expect(track.alternatives).toHaveLength(2);
        expect(track.alternatives[1].name).toBe('New Alt');
        expect(track.alternatives[1].clips).toHaveLength(0);
        expect(track.activeAlternativeId).toBe(track.alternatives[1].id);

        // Verify current clips were saved to previous alternative
        expect(track.alternatives[0].clips).toEqual([{ id: 'clip1' }]);
        expect(result).toEqual({ status: 'written' });
    });

    it('rejects an ineligible track before allocating ids or publishing', () => {
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const result = handleCreateTrackAlternative.execute({
            type: 'createTrackAlternative',
            payload: { trackId: 't1', name: 'Blocked', duplicateActive: true },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('returns no-write when the resolved track is absent from the current snapshot', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const result = handleCreateTrackAlternative.execute({
            type: 'createTrackAlternative',
            payload: { trackId: 't1', name: 'Missing', duplicateActive: false },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects a non-string name before allocating, cloning, or publishing', () => {
        const cloneProbe = vi.fn(() => 'clip1');
        const clip = {};
        Object.defineProperty(clip, 'id', { enumerable: true, get: cloneProbe });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [clip],
                    alternatives: [{ id: 'alt1', name: 'Alt 1', clips: [] }],
                },
            ],
        });
        const action = {
            type: 'createTrackAlternative' as const,
            payload: { trackId: 't1', name: 'Invalid', duplicateActive: true },
        };
        Object.defineProperty(action.payload, 'name', { value: 42 });
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const result = handleCreateTrackAlternative.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(randomUuid).not.toHaveBeenCalled();
        expect(cloneProbe).not.toHaveBeenCalled();
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects a non-boolean duplicate flag before allocating, cloning, or publishing', () => {
        const cloneProbe = vi.fn(() => 'clip1');
        const clip = {};
        Object.defineProperty(clip, 'id', { enumerable: true, get: cloneProbe });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [clip],
                    alternatives: [{ id: 'alt1', name: 'Alt 1', clips: [] }],
                },
            ],
        });
        const action = {
            type: 'createTrackAlternative' as const,
            payload: { trackId: 't1', name: 'Invalid', duplicateActive: true },
        };
        Object.defineProperty(action.payload, 'duplicateActive', { value: 'yes' });
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const result = handleCreateTrackAlternative.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(randomUuid).not.toHaveBeenCalled();
        expect(cloneProbe).not.toHaveBeenCalled();
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('creates a new duplicated alternative and switches to it', () => {
        void handleCreateTrackAlternative.execute({
            type: 'createTrackAlternative',
            payload: { trackId: 't1', name: 'Dupe', duplicateActive: true },
        });

        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to be called');
        }
        const newState = firstCall[0];
        const track = newState.tracks[0];

        expect(track.alternatives).toHaveLength(2);
        expect(track.alternatives[1].clips).toHaveLength(1);
        expect(track.alternatives[1].clips[0].id).toMatch(/^clip-/);
        expect(track.activeAlternativeId).toBe(track.alternatives[1].id);
    });

    it('is undoable', () => {
        expect(handleCreateTrackAlternative.undoable).toBe(true);
    });
});
