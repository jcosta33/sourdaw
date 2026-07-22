import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSwitchTrackAlternative } from '../handleSwitchTrackAlternative';

type MockTrack = {
    id: string;
    kind?: string;
    activeAlternativeId: string;
    clips?: MockClip[];
    alternatives: Array<{ id: string; clips?: MockClip[] }>;
};

type MockClip = { id: string; trackId?: string };

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => { tracks: MockTrack[] }>(),
    setTrackStoreState: vi.fn<(state: { tracks: MockTrack[] }) => void>(),
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

describe('handleSwitchTrackAlternative', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
    });

    it('switches between alternatives saving active clips', () => {
        const alt2Clips = [{ id: 'c2', trackId: 't1' }];
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: alt2Clips },
                    ],
                },
            ],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        const newState = mocks.setTrackStoreState.mock.calls[0]?.[0];
        if (!newState) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        const track = newState.tracks[0];
        if (!track) {
            throw new Error('expected a track in the new state');
        }
        expect(track.activeAlternativeId).toBe('alt2');
        expect(track.clips).toEqual(alt2Clips);

        // Verify alt1 now contains the clips that were active
        expect(track.alternatives[0]?.clips).toEqual([{ id: 'c1', trackId: 't1' }]);
        expect(result).toEqual({ status: 'written' });
    });

    it('rejects a malformed selected-alternative clip without publishing', () => {
        const targetClips = [{ id: 'c2', trackId: 't1' }];
        Object.defineProperty(targetClips, 0, { value: null });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: targetClips },
                    ],
                },
            ],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects duplicate selected-alternative clip ids without publishing', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        {
                            id: 'alt2',
                            clips: [
                                { id: 'duplicate', trackId: 't1' },
                                { id: 'duplicate', trackId: 't1' },
                            ],
                        },
                    ],
                },
            ],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects a selected-alternative clip owned by another track', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [{ id: 'foreign', trackId: 't2' }] },
                    ],
                },
            ],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects a selected-alternative clip owned by a runtime VCA track', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [{ id: 'vca-clip', trackId: 't1' }] },
                    ],
                },
                {
                    id: 'vca1',
                    kind: 'vca',
                    activeAlternativeId: 'vca-alt',
                    clips: [{ id: 'vca-clip', trackId: 'vca1' }],
                    alternatives: [{ id: 'vca-alt', clips: [] }],
                },
            ],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('bails if switching to the already active alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', activeAlternativeId: 'alt1', alternatives: [{ id: 'alt1' }] }],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects an ineligible track without publishing', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [] },
                    ],
                },
            ],
        });
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('returns no-write when the requested alternative is missing', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', activeAlternativeId: 'alt1', alternatives: [{ id: 'alt1', clips: [] }] }],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'missing' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });
});
