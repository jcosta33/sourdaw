import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { handleDeleteTrackAlternative } from '../handleDeleteTrackAlternative';

function makeClip(id: string, trackId = 't1') {
    return ClipDummy.create({ id, trackId });
}

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

describe('handleDeleteTrackAlternative', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
    });

    it('deletes the specified alternative', () => {
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

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        const newState = firstCall[0];
        expect(newState.tracks[0].alternatives).toHaveLength(1);
        expect(newState.tracks[0].alternatives[0].id).toBe('alt1');
        expect(result).toEqual({ status: 'written' });
    });

    it('passes sibling tracks through untouched when deleting on the target track', () => {
        const sibling = {
            id: 'sibling',
            activeAlternativeId: 'sib-alt',
            alternatives: [{ id: 'sib-alt', clips: [] }],
        };
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
                sibling,
            ],
        });

        handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        // The sibling is the same object reference — untouched by the map.
        expect(firstCall[0].tracks[1]).toBe(sibling);
    });

    it('falls back to another alternative if deleting the active one', () => {
        const alt2Clips = [makeClip('c2')];
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [makeClip('c1')] },
                        { id: 'alt2', clips: alt2Clips },
                    ],
                },
            ],
        });

        void handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        const newState = firstCall[0];
        const track = newState.tracks[0];
        expect(track.alternatives).toHaveLength(1);
        expect(track.activeAlternativeId).toBe('alt2');
        expect(track.clips).toEqual(alt2Clips);
    });

    it('rejects a malformed fallback clip when deleting the active alternative', () => {
        const fallbackClips = [makeClip('c2')];
        Object.defineProperty(fallbackClips, 0, { value: null });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: fallbackClips },
                    ],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it.each([
        [
            'a missing required field',
            () => {
                const clip = makeClip('partial');
                Reflect.deleteProperty(clip, 'gain');
                return clip;
            },
        ],
        ['a non-finite required field', () => makeClip('nonfinite', 't1')],
    ] as const)('rejects fallback clips with %s', (_label, createInvalidClip) => {
        const invalidClip = createInvalidClip();
        if (invalidClip.id === 'nonfinite') {
            invalidClip.endBeat = Number.POSITIVE_INFINITY;
        }
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [invalidClip] },
                    ],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects a foreign-owned fallback clip when deleting the active alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [makeClip('c2', 't2')] },
                    ],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects duplicate fallback clip ids when deleting the active alternative', () => {
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

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects a fallback clip id that collides with another live track', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [makeClip('c1')],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [makeClip('occupied')] },
                    ],
                },
                {
                    id: 't2',
                    activeAlternativeId: 'other-alt',
                    clips: [makeClip('occupied', 't2')],
                    alternatives: [{ id: 'other-alt', clips: [] }],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('refuses to delete if only one alternative remains', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', alternatives: [{ id: 'alt1' }] }],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
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

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('returns no-write when the requested alternative is missing', () => {
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

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'missing' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('honors fallbackAlternativeId over the first-in-list fallback when deleting the active alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt3',
                    clips: [],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [] },
                        { id: 'alt3', clips: [] },
                    ],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt3', fallbackAlternativeId: 'alt2' },
        });

        // The undo of createTrackAlternative restores the pre-create active
        // alternative, which is not necessarily first in the list.
        expect(result).toEqual({ status: 'written' });
        const newState = mocks.setTrackStoreState.mock.calls[0]?.[0];
        expect(newState.tracks[0].activeAlternativeId).toBe('alt2');
    });

    it('falls back to the first remaining alternative when no fallback id is provided', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt3',
                    clips: [],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [] },
                        { id: 'alt3', clips: [] },
                    ],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt3' },
        });

        expect(result).toEqual({ status: 'written' });
        const newState = mocks.setTrackStoreState.mock.calls[0]?.[0];
        expect(newState.tracks[0].activeAlternativeId).toBe('alt1');
    });

    it('returns no-write when the track store is unavailable', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it.each([
        ['not an array', 'garbage'],
        ['a non-object element', [{ id: 'alt1', clips: [] }, 'garbage']],
    ])('returns no-write when the alternatives collection is %s', (_label, alternatives) => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    alternatives,
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });
});
