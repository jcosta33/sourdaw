import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { type Clip } from '../../../models/Track';
import { handleSwitchTrackAlternative } from '../handleSwitchTrackAlternative';

type MockTrack = {
    id: string;
    kind?: string;
    activeAlternativeId: string;
    clips?: MockClip[];
    alternatives: Array<{ id: string; clips?: MockClip[] }>;
};

type MockClip = Clip;

function makeClip(id: string, trackId = 't1', overrides: Partial<Clip> = {}): Clip {
    return ClipDummy.create({ id, trackId, ...overrides });
}

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => { tracks: MockTrack[] } | null>(),
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
        const activeClips = [makeClip('c1')];
        const alt2Clips = [makeClip('c2')];
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: activeClips,
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
        expect(track.alternatives[0]?.clips).toEqual(activeClips);
        expect(result).toEqual({ status: 'written' });
    });

    it('passes sibling tracks through untouched when switching on the target track', () => {
        const sibling = {
            id: 'sibling',
            activeAlternativeId: 'sib-alt',
            clips: [makeClip('sib-clip', 'sibling')],
            alternatives: [{ id: 'sib-alt', clips: [makeClip('sib-clip', 'sibling')] }],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [makeClip('c2')] },
                    ],
                },
                sibling,
            ],
        });

        handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        const newState = mocks.setTrackStoreState.mock.calls[0]?.[0];
        if (!newState) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        // The sibling is the same object reference — untouched by the map.
        expect(newState.tracks[1]).toBe(sibling);
    });

    it('rejects a malformed selected-alternative clip without publishing', () => {
        const targetClips = [makeClip('c2')];
        Object.defineProperty(targetClips, 0, { value: null });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
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

    it.each([
        [
            'a missing required field',
            () => {
                const clip = makeClip('partial');
                Reflect.deleteProperty(clip, 'locked');
                return clip;
            },
        ],
        ['a non-finite required field', () => makeClip('nonfinite', 't1', { gain: Number.NaN })],
    ] as const)('rejects selected clips with %s', (_label, createInvalidClip) => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [createInvalidClip()] },
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

    it.each(['outgoing active clips', 'another saved alternative'] as const)(
        'rejects selected clip ids colliding with %s',
        (location) => {
            const otherAlternatives =
                location === 'another saved alternative' ? [{ id: 'alt3', clips: [makeClip('collision')] }] : [];
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    {
                        id: 't1',
                        activeAlternativeId: 'alt1',
                        clips: location === 'outgoing active clips' ? [makeClip('collision')] : [makeClip('c1')],
                        alternatives: [
                            { id: 'alt1', clips: [] },
                            { id: 'alt2', clips: [makeClip('collision')] },
                            ...otherAlternatives,
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
        }
    );

    it('rejects duplicate selected-alternative clip ids without publishing', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        {
                            id: 'alt2',
                            clips: [makeClip('duplicate'), makeClip('duplicate')],
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
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [makeClip('foreign', 't2')] },
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
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [makeClip('vca-clip')] },
                    ],
                },
                {
                    id: 'vca1',
                    kind: 'vca',
                    activeAlternativeId: 'vca-alt',
                    clips: [makeClip('vca-clip', 'vca1')],
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

    it('describe switches back to the pre-switch active alternative as the inverse', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', activeAlternativeId: 'alt1', alternatives: [{ id: 'alt1' }, { id: 'alt2' }] }],
        });

        const desc = handleSwitchTrackAlternative.describe({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });
    });

    it('describe returns a null inverse when the track is not found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const desc = handleSwitchTrackAlternative.describe({
            type: 'switchTrackAlternative',
            payload: { trackId: 'missing', alternativeId: 'alt2' },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('describe returns a null inverse when the active alternative id is empty', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', activeAlternativeId: '', alternatives: [{ id: 'alt1' }, { id: 'alt2' }] }],
        });

        const desc = handleSwitchTrackAlternative.describe({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it.each([
        ['alternatives is not an array', { id: 't1', activeAlternativeId: 'alt1', alternatives: 'nope' as unknown }],
        ['an alternative entry is null', { id: 't1', activeAlternativeId: 'alt1', alternatives: [null] }],
        ['an alternative id is empty', { id: 't1', activeAlternativeId: 'alt1', alternatives: [{ id: '' }] }],
        [
            'an alternative clips field is not an array',
            { id: 't1', activeAlternativeId: 'alt1', alternatives: [{ id: 'alt2', clips: 'nope' }] },
        ],
    ] as const)('rejects without publishing when %s', (_label, trackOverride) => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [trackOverride as MockTrack],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects when the requested alternative id appears more than once', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [makeClip('c2')] },
                        { id: 'alt2', clips: [makeClip('c3')] },
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

    it('rejects when the active alternative id appears more than once', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [makeClip('c2')] },
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

    it('rejects when the store has no state', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects when the track is missing', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 'ghost', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects when the target alternative id is missing from the alternatives list', () => {
        // targetAlternatives.length === 0 (not 1): the requested alternative
        // does not exist, so the switch cannot proceed.
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [{ id: 'alt1', clips: [] }],
                },
            ],
        });

        const result = handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'nonexistent' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it.each([
        ['not an array', 'garbage'],
        ['a non-object element', [{ id: 'alt1', clips: [] }, 'garbage']],
    ])('rejects when the alternatives collection is %s', (_label, alternatives) => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: alternatives as MockTrack['alternatives'],
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

    it('describe returns a null inverse when the track has no active alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', activeAlternativeId: '', clips: [], alternatives: [] }],
        });

        const desc = handleSwitchTrackAlternative.describe({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(desc.inverseAction).toBeNull();
    });
});
