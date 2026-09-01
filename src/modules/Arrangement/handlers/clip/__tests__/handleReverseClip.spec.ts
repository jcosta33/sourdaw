import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRestoreReversedClip } from '../handleRestoreReversedClip';
import { handleReverseClip } from '../handleReverseClip';

const mocks = vi.hoisted(() => ({
    reverseClip: vi.fn(),
    getTrackStoreState: vi.fn(),
    captureClipPitchAnalysis: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    readTempoAtBeat: vi.fn(({ defaultTempo }: { defaultTempo: number }) => defaultTempo),
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
    readTempoAtBeat: ({ beat }: { beat: number }) =>
        mocks.readTempoAtBeat({
            beat,
            defaultTempo: mocks.transportTempo,
        }),
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
        mocks.readTempoAtBeat.mockImplementation(({ defaultTempo }: { defaultTempo: number }) => defaultTempo);
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
