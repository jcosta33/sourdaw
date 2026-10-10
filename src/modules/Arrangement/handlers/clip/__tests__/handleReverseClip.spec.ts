import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';

import { handleRestoreReversedClip } from '../handleRestoreReversedClip';
import { handleReverseClip } from '../handleReverseClip';

const mocks = vi.hoisted(() => ({
    reverseClip: vi.fn(),
    getTrackStoreState: vi.fn(),
    captureClipPitchAnalysis: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    readTempoAtBeat: vi.fn<(input: { beat: number }) => number>(),
    transportTempo: 60,
    tempoMapChanges: [] as { beat: number; tempo: number; curve: 'instant' }[],
    updateClipInStore: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/reverseClip', () => ({
    reverseClip: mocks.reverseClip,
}));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('#/modules/Knead/useCases', () => ({
    captureClipPitchAnalysis: mocks.captureClipPitchAnalysis,
    restoreClipPitchAnalysis: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return { tempo: mocks.transportTempo };
        },
    },
    tempoMapStore: {
        get value() {
            return { changes: mocks.tempoMapChanges };
        },
    },
    readTempoAtBeat: ({ beat }: { beat: number }) => mocks.readTempoAtBeat({ beat }),
}));
vi.mock('../../../stores/updateClipInStore', () => ({
    updateClipInStore: mocks.updateClipInStore,
}));

describe('handleReverseClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reverseClip.mockReturnValue(true);
        mocks.captureClipPitchAnalysis.mockReturnValue({});
        mocks.transportTempo = 60;
        mocks.tempoMapChanges = [];
        mocks.readTempoAtBeat.mockImplementation((_input: { beat: number }) => mocks.transportTempo);
        mocks.getCachedAudioBuffer.mockReturnValue({
            length: 32,
            sampleRate: 8,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'c1',
                            type: 'audio',
                            name: 'Verse',
                            audioBufferId: 'buffer-1',
                            startBeat: 0,
                            endBeat: 1,
                            audioOffsetBeats: 1,
                            fadeInBeats: 0.25,
                            fadeOutBeats: 1.5,
                        },
                    ],
                },
            ],
        });
    });

    it('executes reverseClip with the application-resolved buffer id', () => {
        const result = handleReverseClip.execute({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });

        expect(mocks.reverseClip).toHaveBeenCalledWith('c1', 'reversed-command-1');
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when reversal is rejected', () => {
        mocks.reverseClip.mockReturnValue(false);

        const result = handleReverseClip.execute({
            type: 'reverseClip',
            payload: { clipId: 'vca-clip', reversedBufferId: 'reversed-command-1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('describes a snapshot restore, not a second reverse', () => {
        mocks.captureClipPitchAnalysis.mockReturnValue({
            blobs: [{ id: 'b1', pitchCurveCents: [1, 2] }],
            contour: { points: [{ time: 0 }], sample_rate: 48000, hop_size: 256 },
        });

        const description = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });

        // Reversing again would mint a third buffer, append a second " (reversed)" and
        // clear the pitch analysis for good. The inverse restores all three instead —
        // and the fades the forward run mirrored.
        expect(description.inverseAction).toEqual({
            type: 'restoreReversedClip',
            payload: {
                clipId: 'c1',
                expectedAudioBufferId: 'reversed-command-1',
                audioBufferId: 'buffer-1',
                name: 'Verse',
                fadeInBeats: 0.25,
                fadeOutBeats: 1.5,
                audioOffsetBeats: 1,
                blobs: [{ id: 'b1', pitchCurveCents: [1, 2] }],
                contour: { points: [{ time: 0 }], sample_rate: 48000, hop_size: 256 },
            },
        });
        expect(description.redoAction).toEqual({
            type: 'restoreReversedClip',
            payload: {
                clipId: 'c1',
                expectedAudioBufferId: 'buffer-1',
                audioBufferId: 'reversed-command-1',
                name: 'Verse (reversed)',
                fadeInBeats: 1.5,
                fadeOutBeats: 0.25,
                audioOffsetBeats: 2,
            },
        });
    });

    it('restores audioOffsetBeats 0 when the clip never stored the field', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'c1',
                            type: 'audio',
                            name: 'Verse',
                            audioBufferId: 'buffer-1',
                            startBeat: 0,
                            endBeat: 2,
                            fadeInBeats: 0.25,
                            fadeOutBeats: 1.5,
                        },
                    ],
                },
            ],
        });

        const description = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });
        const inverse = description.inverseAction;
        if (!inverse) {
            throw new Error('expected inverseAction');
        }
        expect(inverse).toMatchObject({
            type: 'restoreReversedClip',
            payload: { audioOffsetBeats: 0 },
        });

        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'c1',
                            type: 'audio',
                            name: 'Verse (reversed)',
                            audioBufferId: 'reversed-command-1',
                            startBeat: 0,
                            endBeat: 2,
                            audioOffsetBeats: 2,
                            fadeInBeats: 1.5,
                            fadeOutBeats: 0.25,
                        },
                    ],
                },
            ],
        });

        if (inverse.type !== 'restoreReversedClip') {
            throw new Error('expected restoreReversedClip inverse');
        }

        handleRestoreReversedClip.execute(inverse);

        const updater = mocks.updateClipInStore.mock.calls[0]?.[1];
        expect(updater).toBeTypeOf('function');
        const restored = updater({
            id: 'c1',
            type: 'audio',
            name: 'Verse (reversed)',
            audioBufferId: 'reversed-command-1',
            startBeat: 0,
            endBeat: 2,
            audioOffsetBeats: 2,
            fadeInBeats: 1.5,
            fadeOutBeats: 0.25,
        });
        expect(restored).toMatchObject({ audioOffsetBeats: 0 });
    });

    it('restores the original audioOffsetBeats when undo applies the inverse restore', () => {
        const description = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });
        const inverse = description.inverseAction;
        if (!inverse) {
            throw new Error('expected inverseAction');
        }

        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'c1',
                            type: 'audio',
                            name: 'Verse (reversed)',
                            audioBufferId: 'reversed-command-1',
                            startBeat: 0,
                            endBeat: 1,
                            audioOffsetBeats: 2,
                            fadeInBeats: 1.5,
                            fadeOutBeats: 0.25,
                        },
                    ],
                },
            ],
        });

        if (inverse.type !== 'restoreReversedClip') {
            throw new Error('expected restoreReversedClip inverse');
        }

        handleRestoreReversedClip.execute(inverse);

        const updater = mocks.updateClipInStore.mock.calls[0]?.[1];
        expect(updater).toBeTypeOf('function');
        const restored = updater({
            id: 'c1',
            type: 'audio',
            name: 'Verse (reversed)',
            audioBufferId: 'reversed-command-1',
            startBeat: 0,
            endBeat: 1,
            audioOffsetBeats: 2,
            fadeInBeats: 1.5,
            fadeOutBeats: 0.25,
        });
        expect(restored).toMatchObject({
            audioBufferId: 'buffer-1',
            name: 'Verse',
            audioOffsetBeats: 1,
            fadeInBeats: 0.25,
            fadeOutBeats: 1.5,
        });
    });

    it('captures the pre-reverse loop anchor in the inverse and restores it exactly', () => {
        // Folded reviewer probe (round 5, persistence-roundtrip-fidelity):
        // looped clip L=4 anchored at 0, trimmed one beat — start 1, offset 1,
        // advance 1. The forward run restamps the anchor at the start, so the
        // inverse payload must carry the pre-reverse anchor or undo leaves the
        // clip reading region [1,5) where the original read [0,4). An
        // unanchored source stays pinned key-absent by the snapshot-restore
        // case above: its exact payload equality fails if the key appears.
        mocks.getCachedAudioBuffer.mockReturnValue({ length: 64, sampleRate: 8 });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'c1',
                            type: 'audio',
                            name: 'Verse',
                            audioBufferId: 'buffer-1',
                            startBeat: 1,
                            endBeat: 5,
                            audioOffsetBeats: 1,
                            fadeInBeats: 0.25,
                            fadeOutBeats: 1.5,
                            loopEnabled: true,
                            loopLength: 4,
                            loopOriginBeat: 0,
                        },
                    ],
                },
            ],
        });

        const description = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });
        expect(description.inverseAction).toMatchObject({
            type: 'restoreReversedClip',
            payload: { loopOriginBeat: 0 },
        });
        // Redo replays the forward restamp: the anchor goes to the start.
        expect(description.redoAction).toMatchObject({
            type: 'restoreReversedClip',
            payload: { loopOriginBeat: 1 },
        });

        // Post-reverse state, the figures the forward spec pins: remapped
        // offset 3, anchor restamped at start 1.
        const postReverseClip = {
            id: 'c1',
            type: 'audio' as const,
            name: 'Verse (reversed)',
            audioBufferId: 'reversed-command-1',
            startBeat: 1,
            endBeat: 5,
            audioOffsetBeats: 3,
            fadeInBeats: 1.5,
            fadeOutBeats: 0.25,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 1,
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [postReverseClip] }] });

        let restoredClip: typeof postReverseClip | undefined;
        mocks.updateClipInStore.mockImplementation(
            (_clipId: string, updater: (candidate: typeof postReverseClip) => typeof postReverseClip) => {
                restoredClip = updater(postReverseClip);
            }
        );

        const inverse = description.inverseAction;
        if (!inverse || inverse.type !== 'restoreReversedClip') {
            throw new Error('expected a restoreReversedClip inverse');
        }
        expect(handleRestoreReversedClip.execute(inverse)).toEqual({ status: 'written' });

        // The undo contract: the pre-reverse clip exactly, anchor included.
        expect(restoredClip!.loopOriginBeat).toBe(0);
        expect(
            resolveClipLoopOriginAdvance({
                startBeat: restoredClip!.startBeat,
                loopOriginBeat: restoredClip!.loopOriginBeat,
                loopEnabled: restoredClip!.loopEnabled === true,
            })
        ).toBe(1);
    });

    it('restores the original anchor and read when a double reverse is undone stepwise', () => {
        // Reverse×reverse: the offset remap is an involution, so buffer, fades
        // and offset return to their originals — but the forward restamp is
        // forced (the loop window must open at the mirrored head) and not
        // injective in the anchor, so a direct second reverse collapses a
        // nonzero advance to zero and reads [1,5) where the original read
        // [0,4). That corner is accepted; the anchor round-trips through the
        // inverse payloads, proven here on the finding's exact figures
        // (start 1, offset 1, anchor 0, L=4, 8-beat source).
        mocks.getCachedAudioBuffer.mockReturnValue({ length: 64, sampleRate: 8 });
        const originalClip = {
            id: 'c1',
            type: 'audio' as const,
            name: 'Verse',
            audioBufferId: 'buffer-1',
            startBeat: 1,
            endBeat: 5,
            audioOffsetBeats: 1,
            fadeInBeats: 0.25,
            fadeOutBeats: 1.5,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
        };
        const postFirstReverse = {
            ...originalClip,
            audioBufferId: 'reversed-command-1',
            name: 'Verse (reversed)',
            fadeInBeats: 1.5,
            fadeOutBeats: 0.25,
            audioOffsetBeats: 3,
            loopOriginBeat: 1,
        };
        const postSecondReverse = {
            ...postFirstReverse,
            audioBufferId: 'reversed-command-2',
            name: 'Verse (reversed) (reversed)',
            fadeInBeats: 0.25,
            fadeOutBeats: 1.5,
            audioOffsetBeats: 1,
            loopOriginBeat: 1,
        };

        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [originalClip] }] });
        const first = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [postFirstReverse] }] });
        const second = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-2' },
        });
        const firstInverse = first.inverseAction;
        const secondInverse = second.inverseAction;
        const firstRedo = first.redoAction;
        if (!firstInverse || firstInverse.type !== 'restoreReversedClip') {
            throw new Error('expected the first reverse to carry a restoreReversedClip inverse');
        }
        if (!secondInverse || secondInverse.type !== 'restoreReversedClip') {
            throw new Error('expected the second reverse to carry a restoreReversedClip inverse');
        }
        if (!firstRedo || firstRedo.type !== 'restoreReversedClip') {
            throw new Error('expected the first reverse to carry a restoreReversedClip redo');
        }

        let live = postSecondReverse;
        mocks.updateClipInStore.mockImplementation(
            (_clipId: string, updater: (candidate: typeof live) => typeof live) => {
                live = updater(live);
            }
        );

        // Undo the second reverse: back to the mirrored state, anchor 1 and all.
        // The store advances with each write; the undo guard reads it live.
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [postSecondReverse] }] });
        expect(handleRestoreReversedClip.execute(secondInverse)).toEqual({ status: 'written' });
        expect(live).toMatchObject({
            audioBufferId: 'reversed-command-1',
            audioOffsetBeats: 3,
            loopOriginBeat: 1,
        });

        // Undo the first reverse: the original read, region [0,4), restored.
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [postFirstReverse] }] });
        expect(handleRestoreReversedClip.execute(firstInverse)).toEqual({ status: 'written' });
        expect(live).toMatchObject({
            audioBufferId: 'buffer-1',
            name: 'Verse',
            audioOffsetBeats: 1,
            fadeInBeats: 0.25,
            fadeOutBeats: 1.5,
            loopOriginBeat: 0,
        });
        expect(
            resolveClipLoopOriginAdvance({
                startBeat: live.startBeat,
                loopOriginBeat: live.loopOriginBeat,
                loopEnabled: live.loopEnabled === true,
            })
        ).toBe(1);

        // Redo replays the first restamp: the mirrored state, again exactly.
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [originalClip] }] });
        expect(handleRestoreReversedClip.execute(firstRedo)).toEqual({ status: 'written' });
        expect(live).toMatchObject({
            audioBufferId: 'reversed-command-1',
            audioOffsetBeats: 3,
            loopOriginBeat: 1,
        });
    });

    it('remaps redo audioOffsetBeats through the stretched source window', () => {
        mocks.getCachedAudioBuffer.mockReturnValue({
            length: 64,
            sampleRate: 8,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'c1',
                            type: 'audio',
                            name: 'Verse',
                            audioBufferId: 'buffer-1',
                            startBeat: 0,
                            endBeat: 2,
                            audioOffsetBeats: 0,
                            stretchMode: 'timestretch',
                            stretchRatio: 2,
                            fadeInBeats: 0.25,
                            fadeOutBeats: 1.5,
                        },
                    ],
                },
            ],
        });

        const description = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
        });

        expect(description.redoAction).toMatchObject({
            type: 'restoreReversedClip',
            payload: { audioOffsetBeats: 4 },
        });
    });

    it('emits no inverse without a resolved buffer id', () => {
        expect(handleReverseClip.describe({ type: 'reverseClip', payload: { clipId: 'c1' } })).toEqual({
            label: 'Reverse clip',
            inverseAction: null,
        });
    });

    it('emits no inverse for a clip that carries no audio buffer', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'midi', name: 'Verse' }] }],
        });

        expect(
            handleReverseClip.describe({
                type: 'reverseClip',
                payload: { clipId: 'c1', reversedBufferId: 'reversed-command-1' },
            })
        ).toEqual({ label: 'Reverse clip', inverseAction: null });
    });

    it('is undoable', () => {
        expect(handleReverseClip.undoable).toBe(true);
    });
});
