import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { handleDeleteTrackAlternative } from '../handleDeleteTrackAlternative';
import { handleRestoreTrackAlternativeState } from '../handleRestoreTrackAlternativeState';

function asRestoreTrackAlternativeState(action: AppAction | null | undefined) {
    if (!action || action.type !== 'restoreTrackAlternativeState') {
        throw new Error('expected a restoreTrackAlternativeState action');
    }
    return action;
}

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

    it('is undoable — deletion drops an alternative and may rewrite live clips, so it must be reversible', () => {
        expect(handleDeleteTrackAlternative.undoable).toBe(true);
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
        const action = {
            type: 'deleteTrackAlternative' as const,
            payload: { trackId: 't1', alternativeId: 'alt1' },
        };

        const result = handleDeleteTrackAlternative.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
        expect(handleDeleteTrackAlternative.describe(action).inverseAction).toBeNull();
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
        const action = {
            type: 'deleteTrackAlternative' as const,
            payload: { trackId: 't1', alternativeId: 'alt2' },
        };

        const result = handleDeleteTrackAlternative.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
        expect(handleDeleteTrackAlternative.describe(action).inverseAction).toBeNull();
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
        const action = {
            type: 'deleteTrackAlternative' as const,
            payload: { trackId: 't1', alternativeId: 'missing' },
        };

        const result = handleDeleteTrackAlternative.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
        expect(handleDeleteTrackAlternative.describe(action).inverseAction).toBeNull();
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
        const action = {
            type: 'deleteTrackAlternative' as const,
            payload: { trackId: 't1', alternativeId: 'alt2' },
        };

        const result = handleDeleteTrackAlternative.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
        expect(handleDeleteTrackAlternative.describe(action).inverseAction).toBeNull();
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
        const action = {
            type: 'deleteTrackAlternative' as const,
            payload: { trackId: 't1', alternativeId: 'alt2' },
        };

        const result = handleDeleteTrackAlternative.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
        expect(handleDeleteTrackAlternative.describe(action).inverseAction).toBeNull();
    });

    describe('undo round trip', () => {
        it('deleting the active alternative: describe+execute promote a fallback and rewrite clips; the inverse restores the deleted alternative, the original active id, and the original clips', () => {
            const alt1Clips = [makeClip('c1')];
            const alt2Clips = [makeClip('c2')];
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    {
                        id: 't1',
                        activeAlternativeId: 'alt1',
                        clips: alt1Clips,
                        alternatives: [
                            { id: 'alt1', name: 'Alt 1', clips: alt1Clips },
                            { id: 'alt2', name: 'Alt 2', clips: alt2Clips },
                        ],
                    },
                ],
            });
            const action = {
                type: 'deleteTrackAlternative' as const,
                payload: { trackId: 't1', alternativeId: 'alt1' },
            };

            // `describe()` runs before `execute()` in `executeAppAction`; the inverse's
            // `expected` object is only filled in once `execute()` writes.
            const described = handleDeleteTrackAlternative.describe(action);
            const executed = handleDeleteTrackAlternative.execute(action);
            expect(executed).toEqual({ status: 'written' });

            const postDeleteState = mocks.setTrackStoreState.mock.calls[0]?.[0];
            const postDeleteTrack = postDeleteState.tracks[0];
            expect(postDeleteTrack.alternatives).toHaveLength(1);
            expect(postDeleteTrack.alternatives[0].id).toBe('alt2');
            expect(postDeleteTrack.activeAlternativeId).toBe('alt2');
            expect(postDeleteTrack.clips).toEqual(alt2Clips);

            const inverseAction = asRestoreTrackAlternativeState(described.inverseAction);
            expect(inverseAction.payload.expected.activeAlternativeId).toBe('alt2');
            expect(inverseAction.payload.expected.alternatives.map((alternative) => alternative.id)).toEqual(['alt2']);
            expect(inverseAction.payload.replacement.activeAlternativeId).toBe('alt1');
            expect(inverseAction.payload.replacement.alternatives.map((alternative) => alternative.id)).toEqual([
                'alt1',
                'alt2',
            ]);

            // The undo engine dispatches the inverse against whatever the store holds
            // by then — simulate the store having advanced to the post-delete state.
            mocks.getTrackStoreState.mockReturnValue(postDeleteState);
            mocks.setTrackStoreState.mockClear();

            const restored = handleRestoreTrackAlternativeState.execute(inverseAction);
            expect(restored).toEqual({ status: 'written' });

            const restoredTrack = mocks.setTrackStoreState.mock.calls[0]?.[0].tracks[0];
            expect(restoredTrack.alternatives.map((alternative: { id: string }) => alternative.id)).toEqual([
                'alt1',
                'alt2',
            ]);
            expect(restoredTrack.activeAlternativeId).toBe('alt1');
            expect(restoredTrack.clips).toEqual(alt1Clips);
        });

        it('deleting a non-active alternative leaves the active id unchanged in both directions', () => {
            const alt1Clips = [makeClip('c1')];
            const alt2Clips = [makeClip('c2')];
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    {
                        id: 't1',
                        activeAlternativeId: 'alt1',
                        clips: alt1Clips,
                        alternatives: [
                            { id: 'alt1', name: 'Alt 1', clips: alt1Clips },
                            { id: 'alt2', name: 'Alt 2', clips: alt2Clips },
                        ],
                    },
                ],
            });
            const action = {
                type: 'deleteTrackAlternative' as const,
                payload: { trackId: 't1', alternativeId: 'alt2' },
            };

            const described = handleDeleteTrackAlternative.describe(action);
            const executed = handleDeleteTrackAlternative.execute(action);
            expect(executed).toEqual({ status: 'written' });

            const postDeleteState = mocks.setTrackStoreState.mock.calls[0]?.[0];
            const postDeleteTrack = postDeleteState.tracks[0];
            expect(postDeleteTrack.alternatives).toHaveLength(1);
            expect(postDeleteTrack.activeAlternativeId).toBe('alt1');
            expect(postDeleteTrack.clips).toEqual(alt1Clips);

            const inverseAction = asRestoreTrackAlternativeState(described.inverseAction);
            mocks.getTrackStoreState.mockReturnValue(postDeleteState);
            mocks.setTrackStoreState.mockClear();

            const restored = handleRestoreTrackAlternativeState.execute(inverseAction);
            expect(restored).toEqual({ status: 'written' });

            const restoredTrack = mocks.setTrackStoreState.mock.calls[0]?.[0].tracks[0];
            expect(restoredTrack.alternatives.map((alternative: { id: string }) => alternative.id)).toEqual([
                'alt1',
                'alt2',
            ]);
            expect(restoredTrack.activeAlternativeId).toBe('alt1');
            expect(restoredTrack.clips).toEqual(alt1Clips);
        });

        it('conflicts and writes nothing when an alternative was added between capture and restore', () => {
            const alt1Clips = [makeClip('c1')];
            const alt2Clips = [makeClip('c2')];
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    {
                        id: 't1',
                        activeAlternativeId: 'alt1',
                        clips: alt1Clips,
                        alternatives: [
                            { id: 'alt1', name: 'Alt 1', clips: alt1Clips },
                            { id: 'alt2', name: 'Alt 2', clips: alt2Clips },
                        ],
                    },
                ],
            });
            const action = {
                type: 'deleteTrackAlternative' as const,
                payload: { trackId: 't1', alternativeId: 'alt1' },
            };

            const described = handleDeleteTrackAlternative.describe(action);
            handleDeleteTrackAlternative.execute(action);
            const postDeleteState = mocks.setTrackStoreState.mock.calls[0]?.[0];
            const inverseAction = asRestoreTrackAlternativeState(described.inverseAction);

            // Something else (e.g. `createTrackAlternative`) ran between the delete and
            // the undo, adding a third alternative — the id-sequence guard must refuse.
            const driftedTrack = {
                ...postDeleteState.tracks[0],
                alternatives: [...postDeleteState.tracks[0].alternatives, { id: 'alt3', name: 'Alt 3', clips: [] }],
            };
            mocks.getTrackStoreState.mockReturnValue({ tracks: [driftedTrack] });
            mocks.setTrackStoreState.mockClear();

            const restored = handleRestoreTrackAlternativeState.execute(inverseAction);

            expect(restored).toEqual({ status: 'conflict' });
            expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
        });

        it('conflicts and writes nothing when the active alternative id changed between capture and restore', () => {
            const alt1Clips = [makeClip('c1')];
            const alt2Clips = [makeClip('c2')];
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    {
                        id: 't1',
                        activeAlternativeId: 'alt1',
                        clips: alt1Clips,
                        alternatives: [
                            { id: 'alt1', name: 'Alt 1', clips: alt1Clips },
                            { id: 'alt2', name: 'Alt 2', clips: alt2Clips },
                            { id: 'alt3', name: 'Alt 3', clips: [] },
                        ],
                    },
                ],
            });
            const action = {
                type: 'deleteTrackAlternative' as const,
                payload: { trackId: 't1', alternativeId: 'alt1' },
            };

            const described = handleDeleteTrackAlternative.describe(action);
            handleDeleteTrackAlternative.execute(action);
            const postDeleteState = mocks.setTrackStoreState.mock.calls[0]?.[0];
            const inverseAction = asRestoreTrackAlternativeState(described.inverseAction);

            // Something else switched the active alternative between the delete and the
            // undo, without adding or removing any alternative — the active-id guard
            // must still refuse, since the id-sequence compare alone would miss this.
            const driftedTrack = { ...postDeleteState.tracks[0], activeAlternativeId: 'alt3' };
            mocks.getTrackStoreState.mockReturnValue({ tracks: [driftedTrack] });
            mocks.setTrackStoreState.mockClear();

            const restored = handleRestoreTrackAlternativeState.execute(inverseAction);

            expect(restored).toEqual({ status: 'conflict' });
            expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
        });
    });
});
