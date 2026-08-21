import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { handleRestoreTrackAlternativeState } from '../handleRestoreTrackAlternativeState';

function makeClip(id: string, trackId = 't1') {
    return ClipDummy.create({ id, trackId });
}

// Returned through a function call rather than an inline object literal so the
// contract's narrow `{ readonly id: string }` alternative-identity type does not
// trip an excess-property check on the `name`/`clips` fields the live track
// actually carries.
function makeAlternative(id: string, name: string, clips: ReturnType<typeof makeClip>[]) {
    return { id, name, clips };
}

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackStoreState', () => ({
    setTrackStoreState: mocks.setTrackStoreState,
}));

function makeTrack(overrides: Record<string, unknown> = {}) {
    return {
        id: 't1',
        activeAlternativeId: 'alt1',
        clips: [makeClip('c1')],
        alternatives: [
            { id: 'alt1', name: 'Alt 1', clips: [makeClip('c1')] },
            { id: 'alt2', name: 'Alt 2', clips: [makeClip('c2')] },
        ],
        ...overrides,
    };
}

describe('handleRestoreTrackAlternativeState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('is not undoable — only ever dispatched by the undo engine', () => {
        expect(handleRestoreTrackAlternativeState.undoable).toBe(false);
    });

    it('writes the replacement alternatives, active id, and clips in one store write when the guard passes and the swap is valid', () => {
        const liveTrack = makeTrack();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack] });

        const replacementClips = [makeClip('c3')];
        const result = handleRestoreTrackAlternativeState.execute({
            type: 'restoreTrackAlternativeState',
            payload: {
                trackId: 't1',
                expected: {
                    alternatives: [{ id: 'alt1' }, { id: 'alt2' }],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
                replacement: {
                    alternatives: [
                        makeAlternative('alt1', 'Alt 1', [makeClip('c1')]),
                        makeAlternative('alt2', 'Alt 2', replacementClips),
                    ],
                    activeAlternativeId: 'alt2',
                    clips: replacementClips,
                },
            },
        });

        expect(result).toEqual({ status: 'written' });
        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        const newTrack = firstCall[0].tracks[0];
        expect(newTrack.alternatives.map((alternative: { id: string }) => alternative.id)).toEqual(['alt1', 'alt2']);
        expect(newTrack.activeAlternativeId).toBe('alt2');
        expect(newTrack.clips).toBe(replacementClips);
    });

    it('writes replacement clips through untouched when the active alternative is not changing', () => {
        const liveTrack = makeTrack();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack] });

        const result = handleRestoreTrackAlternativeState.execute({
            type: 'restoreTrackAlternativeState',
            payload: {
                trackId: 't1',
                expected: {
                    alternatives: [{ id: 'alt1' }, { id: 'alt2' }],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
                replacement: {
                    alternatives: [makeAlternative('alt1', 'Alt 1', liveTrack.clips)],
                    activeAlternativeId: 'alt1',
                    clips: liveTrack.clips,
                },
            },
        });

        expect(result).toEqual({ status: 'written' });
        const newTrack = mocks.setTrackStoreState.mock.calls[0]?.[0].tracks[0];
        expect(newTrack.activeAlternativeId).toBe('alt1');
        expect(newTrack.clips).toBe(liveTrack.clips);
    });

    it('conflicts and writes nothing when an alternative was added since capture', () => {
        const liveTrack = makeTrack({
            alternatives: [
                { id: 'alt1', name: 'Alt 1', clips: [makeClip('c1')] },
                { id: 'alt2', name: 'Alt 2', clips: [makeClip('c2')] },
                { id: 'alt3', name: 'Alt 3', clips: [] },
            ],
        });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack] });

        const result = handleRestoreTrackAlternativeState.execute({
            type: 'restoreTrackAlternativeState',
            payload: {
                trackId: 't1',
                expected: {
                    alternatives: [{ id: 'alt1' }, { id: 'alt2' }],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
                replacement: {
                    alternatives: [makeAlternative('alt1', 'Alt 1', [])],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('conflicts and writes nothing when an alternative was removed since capture', () => {
        const liveTrack = makeTrack({
            alternatives: [{ id: 'alt1', name: 'Alt 1', clips: [makeClip('c1')] }],
        });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack] });

        const result = handleRestoreTrackAlternativeState.execute({
            type: 'restoreTrackAlternativeState',
            payload: {
                trackId: 't1',
                expected: {
                    alternatives: [{ id: 'alt1' }, { id: 'alt2' }],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
                replacement: {
                    alternatives: [makeAlternative('alt1', 'Alt 1', [])],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('conflicts and writes nothing when the active alternative id changed since capture', () => {
        const liveTrack = makeTrack({ activeAlternativeId: 'alt2' });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack] });

        const result = handleRestoreTrackAlternativeState.execute({
            type: 'restoreTrackAlternativeState',
            payload: {
                trackId: 't1',
                expected: {
                    alternatives: [{ id: 'alt1' }, { id: 'alt2' }],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
                replacement: {
                    alternatives: [makeAlternative('alt1', 'Alt 1', [])],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('conflicts and writes nothing when the track no longer exists', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const result = handleRestoreTrackAlternativeState.execute({
            type: 'restoreTrackAlternativeState',
            payload: {
                trackId: 't1',
                expected: {
                    alternatives: [{ id: 'alt1' }, { id: 'alt2' }],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
                replacement: {
                    alternatives: [makeAlternative('alt1', 'Alt 1', [])],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('refuses to restore replacement clips that fail runtime clip validation, and writes nothing', () => {
        const liveTrack = makeTrack();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack] });

        const malformedClip = makeClip('bad');
        Reflect.deleteProperty(malformedClip, 'gain');

        // Active id must actually change (alt1 -> alt2) so the handler runs the clip
        // promotion validation at all — matching exactly when the forward handler runs it.
        const result = handleRestoreTrackAlternativeState.execute({
            type: 'restoreTrackAlternativeState',
            payload: {
                trackId: 't1',
                expected: {
                    alternatives: [{ id: 'alt1' }, { id: 'alt2' }],
                    activeAlternativeId: 'alt1',
                    clips: [],
                },
                replacement: {
                    alternatives: [
                        makeAlternative('alt1', 'Alt 1', [makeClip('c1')]),
                        makeAlternative('alt2', 'Alt 2', [malformedClip]),
                    ],
                    activeAlternativeId: 'alt2',
                    clips: [malformedClip],
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    describe('isNoop', () => {
        it('is true when the live state already matches the replacement', () => {
            const liveTrack = makeTrack();
            mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack] });

            const isNoop = handleRestoreTrackAlternativeState.isNoop?.({
                type: 'restoreTrackAlternativeState',
                payload: {
                    trackId: 't1',
                    expected: { alternatives: [], activeAlternativeId: null, clips: [] },
                    replacement: {
                        alternatives: [{ id: 'alt1' }, { id: 'alt2' }],
                        activeAlternativeId: 'alt1',
                        clips: [],
                    },
                },
            });

            expect(isNoop).toBe(true);
        });

        it('is false when the live state differs from the replacement', () => {
            const liveTrack = makeTrack();
            mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack] });

            const isNoop = handleRestoreTrackAlternativeState.isNoop?.({
                type: 'restoreTrackAlternativeState',
                payload: {
                    trackId: 't1',
                    expected: { alternatives: [], activeAlternativeId: null, clips: [] },
                    replacement: {
                        alternatives: [{ id: 'alt1' }],
                        activeAlternativeId: 'alt1',
                        clips: [],
                    },
                },
            });

            expect(isNoop).toBe(false);
        });
    });
});
