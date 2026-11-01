import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';

import { reverseClip } from '../reverseClip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateClip: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    clearClipPitchAnalysis: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
    transportTempo: 60,
    tempoMapChanges: [] as { beat: number; tempo: number; curve: 'instant' }[],
    readTempoAtBeat: vi.fn(
        ({
            changes,
            defaultTempo,
        }: {
            changes: readonly { beat: number; tempo: number }[];
            beat: number;
            defaultTempo: number;
        }) => {
            if (changes.length === 0) {
                return defaultTempo;
            }
            let governing = changes[0]!.tempo;
            for (const change of changes) {
                if (change.beat <= 0) {
                    governing = change.tempo;
                }
            }
            return governing;
        }
    ),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Knead/useCases', () => ({
    clearClipPitchAnalysis: mocks.clearClipPitchAnalysis,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
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
            changes: mocks.tempoMapChanges,
            beat,
            defaultTempo: mocks.transportTempo,
        }),
    readSecondsAtBeat: ({ beat }: { beat: number }) => integratedSecondsAtBeat(beat),
}));

/** Song seconds at a beat through the mocked instant-step tempo map. */
function integratedSecondsAtBeat(beat: number): number {
    const steps = [...mocks.tempoMapChanges].sort((left, right) => left.beat - right.beat);
    let seconds = 0;
    let cursor = 0;
    let tempo = mocks.transportTempo;
    for (const step of steps) {
        if (step.beat >= beat) {
            break;
        }
        seconds += ((Math.max(cursor, step.beat) - cursor) * 60) / tempo;
        cursor = Math.max(cursor, step.beat);
        tempo = step.tempo;
    }
    return seconds + ((beat - cursor) * 60) / tempo;
}

type CanonicalClip = {
    id: string;
    type: 'audio';
    audioBufferId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    fadeInBeats: number;
    fadeOutBeats: number;
    audioOffsetBeats?: number;
    audioOffsetSeconds?: number;
    audioUnwrappedOffsetSeconds?: number;
    audioLoopStartSeconds?: number;
    audioLoopPassEntrySeconds?: number;
    audioLoopPassOriginBeat?: number;
    stretchMode?: 'off' | 'repitch' | 'timestretch';
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    loopOriginBeat?: number;
};

/** The first source second the live and offline readers play for a clip. */
function readerEntrySeconds(clip: CanonicalClip): number {
    const segment = projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: clip.loopLength ?? clip.endBeat - clip.startBeat,
        iterationStartBeat: clip.startBeat,
        iterationEndBeat: clip.endBeat,
        stretchRatio: clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1,
        tempoAtClipStart: mocks.readTempoAtBeat({
            changes: mocks.tempoMapChanges,
            beat: clip.startBeat,
            defaultTempo: mocks.transportTempo,
        }),
        secondsAtBeat: integratedSecondsAtBeat,
    })[0];
    if (!segment) {
        throw new Error('the readers project no segment for the clip');
    }
    return segment.sourceStartSeconds;
}

describe('reverseClip', () => {
    let mockCtx: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'c1',
        });
        mocks.transportTempo = 60;
        mocks.tempoMapChanges = [];
        mocks.readTempoAtBeat.mockImplementation(
            ({
                changes,
                defaultTempo,
            }: {
                changes: readonly { beat: number; tempo: number }[];
                beat: number;
                defaultTempo: number;
            }) => {
                if (changes.length === 0) {
                    return defaultTempo;
                }
                let governing = changes[0]!.tempo;
                for (const change of changes) {
                    if (change.beat <= 0) {
                        governing = change.tempo;
                    }
                }
                return governing;
            }
        );
        mockCtx = {
            createBuffer: vi.fn(),
        };

        // Use regular function to satisfy 'constructor' check
        globalThis.OfflineAudioContext = function () {
            return mockCtx;
        } as any;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reverses an audio clip buffer and updates its ID', () => {
        vi.spyOn(Date, 'now').mockReturnValue(12345);

        const mockClip = { id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' };
        const events: string[] = [];
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.cacheAudioBuffer.mockImplementation(() => {
            events.push('cache');
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                events.push('publish');
                return true;
            }
        );

        const originalData = new Float32Array(100);
        originalData[0] = 1.0;
        originalData[99] = 0.5;

        const reversedData = new Float32Array(100);

        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 100,
            sampleRate: 44100,
            getChannelData: vi.fn(() => originalData),
        });

        const reversedBuffer = {
            numberOfChannels: 1,
            length: 100,
            getChannelData: vi.fn(() => reversedData),
        };
        mockCtx.createBuffer.mockReturnValue(reversedBuffer);

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(true);
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf1' });
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({
            buffer: reversedBuffer,
            bufferId: 'reversed-buf1-12345',
        });
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        expect(events).toEqual(['cache', 'publish']);
        expect(publishedClip?.audioBufferId).toBe('reversed-buf1-12345');
        expect(publishedClip?.name).toBe('Sample (reversed)');

        // Verify the math
        expect(reversedData[0]).toBe(0.5);
        expect(reversedData[99]).toBe(1.0);
    });

    it('mirrors the clip fades so the reversed audio keeps its drawn edges', () => {
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            fadeInBeats: 0.5,
            fadeOutBeats: 2,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 4,
            sampleRate: 44100,
            getChannelData: vi.fn(() => new Float32Array(4)),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 4,
            getChannelData: vi.fn(() => new Float32Array(4)),
        });

        reverseClip('c1');

        // The fade-in at the original head now sits at the reversed tail, and the
        // fade-out at the original tail now opens the clip.
        expect(publishedClip?.fadeInBeats).toBe(2);
        expect(publishedClip?.fadeOutBeats).toBe(0.5);
    });

    it('keeps a zero audioOffsetBeats after reverse and still swaps fades', () => {
        // 4 beats of source at 60 BPM, 8 samples/beat — clip uses the whole buffer.
        const sampleRate = 8;
        const sourceSamples = 32;
        const originalData = new Float32Array(sourceSamples);
        const reversedData = new Float32Array(sourceSamples);
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 0,
            endBeat: 4,
            audioOffsetBeats: 0,
            fadeInBeats: 0.5,
            fadeOutBeats: 2,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => originalData),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => reversedData),
        });

        reverseClip('c1');

        expect(publishedClip?.audioOffsetBeats).toBe(0);
        expect(publishedClip?.fadeInBeats).toBe(2);
        expect(publishedClip?.fadeOutBeats).toBe(0.5);
    });

    it('restamps the loop anchor at the clip own start because the reversed buffer is a fresh media basis', () => {
        // An 8-beat buffer at 60 BPM (sampleRate 8), looped clip L=4 trimmed by
        // one beat: start 1, offset 1, anchor 0. Carrying the anchor would mix
        // the old basis's advance into the new one (region [2,6) over the
        // mirrored window [3,7)).
        const sampleRate = 8;
        const sourceSamples = 64;
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 1,
            endBeat: 5,
            audioOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => new Float32Array(sourceSamples)),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => new Float32Array(sourceSamples)),
        });

        reverseClip('c1');

        expect(publishedClip?.audioOffsetBeats).toBe(3);
        // The anchor reads the fresh basis: the clip's own start, advance zero,
        // so the loop window opens at the mirrored window head.
        expect(publishedClip?.loopOriginBeat).toBe(1);
    });

    it('restamps an untrimmed anchored clip to its unchanged start, advance zero before and after', () => {
        // Untrimmed, the anchor derives advance zero before and after — the
        // pre/post agreement the anchor law promises. The clip spans [0,5)
        // with L=4: the mirrored window head is S − 0 − 5 = 3, and the
        // restamped anchor is the clip's own start, 0.
        const sampleRate = 8;
        const sourceSamples = 64;
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 0,
            endBeat: 5,
            audioOffsetBeats: 0,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => new Float32Array(sourceSamples)),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => new Float32Array(sourceSamples)),
        });

        reverseClip('c1');

        expect(publishedClip?.audioOffsetBeats).toBe(3);
        expect(publishedClip?.loopOriginBeat).toBe(0);
    });

    it('keeps the loop anchor key absent when reversing an unanchored source', () => {
        const sampleRate = 8;
        const sourceSamples = 64;
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 1,
            endBeat: 5,
            audioOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 4,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => new Float32Array(sourceSamples)),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => new Float32Array(sourceSamples)),
        });

        reverseClip('c1');

        expect(publishedClip).toBeDefined();
        expect('loopOriginBeat' in publishedClip!).toBe(false);
    });

    it('remaps audioOffsetBeats so the reversed playback window is the original clip window backwards', () => {
        // 60 BPM → 1 s/beat. sampleRate 8 → 8 samples/beat. 32-sample buffer = 4 beats.
        const sampleRate = 8;
        const sourceSamples = 32;
        const originalData = new Float32Array(sourceSamples);
        for (let index = 0; index < sourceSamples; index++) {
            originalData[index] = index;
        }
        const reversedData = new Float32Array(sourceSamples);
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 0,
            endBeat: 1,
            audioOffsetBeats: 1,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => originalData),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => reversedData),
        });

        reverseClip('c1');

        // Whole buffer is still mirrored; the window moves to the mirrored passage.
        expect(reversedData[0]).toBe(31);
        expect(publishedClip?.audioOffsetBeats).toBe(2);
        const playbackStartSample = (publishedClip?.audioOffsetBeats ?? 0) * sampleRate;
        const originalWindowLastSample = 1 * sampleRate + 1 * sampleRate - 1;
        expect(reversedData[playbackStartSample]).toBe(originalData[originalWindowLastSample]);
    });

    it('remaps a zero-offset right-trimmed clip to a nonzero playback offset', () => {
        const sampleRate = 8;
        const sourceSamples = 32;
        const originalData = new Float32Array(sourceSamples);
        for (let index = 0; index < sourceSamples; index++) {
            originalData[index] = index;
        }
        const reversedData = new Float32Array(sourceSamples);
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 0,
            endBeat: 2,
            audioOffsetBeats: 0,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => originalData),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => reversedData),
        });

        reverseClip('c1');

        expect(publishedClip?.audioOffsetBeats).toBe(2);
        const playbackStartSample = (publishedClip?.audioOffsetBeats ?? 0) * sampleRate;
        const originalWindowLastSample = 0 * sampleRate + 2 * sampleRate - 1;
        expect(reversedData[playbackStartSample]).toBe(originalData[originalWindowLastSample]);
    });

    it('uses endBeat minus startBeat for clip length when startBeat is not zero', () => {
        const sampleRate = 8;
        const sourceSamples = 32;
        const originalData = new Float32Array(sourceSamples);
        for (let index = 0; index < sourceSamples; index++) {
            originalData[index] = index;
        }
        const reversedData = new Float32Array(sourceSamples);
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 4,
            endBeat: 5,
            audioOffsetBeats: 1,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => originalData),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => reversedData),
        });

        reverseClip('c1');

        expect(publishedClip?.audioOffsetBeats).toBe(2);
        const playbackStartSample = (publishedClip?.audioOffsetBeats ?? 0) * sampleRate;
        const originalWindowLastSample = 1 * sampleRate + 1 * sampleRate - 1;
        expect(reversedData[playbackStartSample]).toBe(originalData[originalWindowLastSample]);
    });

    it('remaps a stretched clip window by source beats consumed at the stretch ratio', () => {
        // 60 BPM → 1 s/beat. sampleRate 8 → 8 samples/beat. 64-sample buffer = 8 beats.
        const sampleRate = 8;
        const sourceSamples = 64;
        const originalData = new Float32Array(sourceSamples);
        for (let index = 0; index < sourceSamples; index++) {
            originalData[index] = index;
        }
        const reversedData = new Float32Array(sourceSamples);
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 0,
            endBeat: 2,
            audioOffsetBeats: 0,
            stretchMode: 'timestretch' as const,
            stretchRatio: 2,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => originalData),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => reversedData),
        });

        reverseClip('c1');

        expect(reversedData[0]).toBe(63);
        expect(publishedClip?.audioOffsetBeats).toBe(4);
    });

    it('uses unstretched clip length when stretchMode is off', () => {
        const sampleRate = 8;
        const sourceSamples = 64;
        const originalData = new Float32Array(sourceSamples);
        const reversedData = new Float32Array(sourceSamples);
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 0,
            endBeat: 2,
            audioOffsetBeats: 0,
            stretchMode: 'off' as const,
            stretchRatio: 2,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => originalData),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => reversedData),
        });

        reverseClip('c1');

        expect(publishedClip?.audioOffsetBeats).toBe(6);
    });

    it('uses unstretched clip length when stretchMode is absent', () => {
        const sampleRate = 8;
        const sourceSamples = 64;
        const originalData = new Float32Array(sourceSamples);
        const reversedData = new Float32Array(sourceSamples);
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 0,
            endBeat: 2,
            audioOffsetBeats: 0,
            stretchRatio: 2,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => originalData),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => reversedData),
        });

        reverseClip('c1');

        expect(publishedClip?.audioOffsetBeats).toBe(6);
    });

    it('remaps audioOffsetBeats using the tempo map at the clip start beat', () => {
        const sampleRate = 8;
        const sourceSamples = 32;
        const originalData = new Float32Array(sourceSamples);
        const reversedData = new Float32Array(sourceSamples);
        const mockClip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Sample',
            startBeat: 0,
            endBeat: 1,
            audioOffsetBeats: 1,
        };
        let publishedClip: typeof mockClip | undefined;
        mocks.transportTempo = 60;
        mocks.tempoMapChanges = [{ beat: 0, tempo: 120, curve: 'instant' as const }];
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                publishedClip = updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            sampleRate,
            getChannelData: vi.fn(() => originalData),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: sourceSamples,
            getChannelData: vi.fn(() => reversedData),
        });

        reverseClip('c1');

        expect(mocks.readTempoAtBeat).toHaveBeenCalledWith(expect.objectContaining({ beat: 0, defaultTempo: 60 }));
        expect(publishedClip?.audioOffsetBeats).toBe(6);
    });

    it('clears the clip pitch contour after a successful reverse because the audio changed', () => {
        const mockClip = { id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.updateClip.mockImplementation(
            (_clipId: string, updater: (candidate: typeof mockClip) => typeof mockClip) => {
                updater(mockClip);
                return true;
            }
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 4,
            sampleRate: 44100,
            getChannelData: vi.fn(() => new Float32Array(4)),
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 4,
            getChannelData: vi.fn(() => new Float32Array(4)),
        });

        reverseClip('c1');

        expect(mocks.clearClipPitchAnalysis).toHaveBeenCalledWith('c1');
    });

    it('keeps the pitch contour when the clip cannot be reversed', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'c1', type: 'midi' }] }],
        });

        reverseClip('c1');

        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });

    it('does not publish cache or contour effects when the eligible update is not committed', () => {
        const mockClip = { id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [mockClip] }],
        });
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 1,
            length: 4,
            sampleRate: 44100,
            getChannelData: vi.fn(() => new Float32Array(4)),
        });
        mockCtx.createBuffer.mockReturnValue({
            getChannelData: vi.fn(() => new Float32Array(4)),
        });
        mocks.updateClip.mockReturnValue(false);

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(false);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });

    it('bails if clip is not found or not audio', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'c1', type: 'midi' }] }],
        });

        reverseClip('c1');
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('rejects an ineligible owner before Web Audio, cache, update, or contour effects', () => {
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' }] }],
        });

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(false);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mockCtx.createBuffer).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });

    it('rejects when the track store has not loaded', () => {
        mocks.getTrackState.mockReturnValue(null);

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(false);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('rejects when the source buffer is not cached', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf1', name: 'Sample' }] }],
        });
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        const didWrite = reverseClip('c1');

        expect(didWrite).toBe(false);
        expect(mockCtx.createBuffer).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    describe('canonical source entry', () => {
        function reverseWithBuffer(clip: CanonicalClip, sourceSamples: number, sampleRate = 8) {
            const originalData = new Float32Array(sourceSamples);
            for (let index = 0; index < sourceSamples; index++) {
                originalData[index] = index;
            }
            const reversedData = new Float32Array(sourceSamples);
            let publishedClip: CanonicalClip | undefined;
            mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'track-1', clips: [clip] }] });
            mocks.updateClip.mockImplementation(
                (_clipId: string, updater: (candidate: CanonicalClip) => CanonicalClip) => {
                    publishedClip = updater(clip);
                    return true;
                }
            );
            mocks.getCachedAudioBuffer.mockReturnValue({
                numberOfChannels: 1,
                length: sourceSamples,
                sampleRate,
                getChannelData: vi.fn(() => originalData),
            });
            mockCtx.createBuffer.mockReturnValue({
                numberOfChannels: 1,
                length: sourceSamples,
                getChannelData: vi.fn(() => reversedData),
            });
            const didWrite = reverseClip('c1', 'reversed-1');
            return { didWrite, publishedClip, originalData, reversedData };
        }

        const baseClip = {
            id: 'c1',
            type: 'audio' as const,
            audioBufferId: 'buf1',
            name: 'Sample',
            fadeInBeats: 0,
            fadeOutBeats: 0,
        };

        it('mirrors the entry across a tempo change so the readers play the original window backwards', () => {
            // 120 BPM to beat 2, then 60: the span [1, 3) is 0.5 s + 1 s of song
            // time. Entering at 0.5 s the readers leave at 2 s, so in the 4 s
            // mirrored buffer the passage opens at 4 − 2 = 2 s. A flat reading at
            // either tempo (1 s or 2 s of span) lands elsewhere.
            mocks.transportTempo = 120;
            mocks.tempoMapChanges = [
                { beat: 0, tempo: 120, curve: 'instant' },
                { beat: 2, tempo: 60, curve: 'instant' },
            ];
            const clip: CanonicalClip = {
                ...baseClip,
                startBeat: 1,
                endBeat: 3,
                audioOffsetBeats: 9,
                audioOffsetSeconds: 0.5,
            };

            const { didWrite, publishedClip, originalData, reversedData } = reverseWithBuffer(clip, 32);

            expect(didWrite).toBe(true);
            expect(publishedClip?.audioOffsetSeconds).toBeCloseTo(2, 12);
            expect(readerEntrySeconds(publishedClip!)).toBeCloseTo(2, 12);
            // The first reversed sample the readers play is the last sample of
            // the window they played forwards, which ended at source second 2.
            expect(reversedData[2 * 8]).toBe(originalData[2 * 8 - 1]);
            for (const key of [
                'audioUnwrappedOffsetSeconds',
                'audioLoopStartSeconds',
                'audioLoopPassEntrySeconds',
                'audioLoopPassOriginBeat',
            ]) {
                expect(Object.hasOwn(publishedClip!, key)).toBe(false);
            }
        });

        it('mirrors the window the stretched readers consume, not the timeline span', () => {
            // Two beats at 60 BPM read 1 s of source at ratio 0.5: [0.5, 1.5)
            // mirrors to [2.5, 3.5) in the 4 s buffer.
            const clip: CanonicalClip = {
                ...baseClip,
                startBeat: 0,
                endBeat: 2,
                audioOffsetSeconds: 0.5,
                stretchMode: 'timestretch',
                stretchRatio: 0.5,
            };

            const { publishedClip } = reverseWithBuffer(clip, 32);

            expect(publishedClip?.audioOffsetSeconds).toBeCloseTo(2.5, 12);
            expect(readerEntrySeconds(publishedClip!)).toBeCloseTo(2.5, 12);
        });

        it('restamps every present provenance field at the mirrored head of the fresh basis', () => {
            // A looped clip [2, 6) entering at 1 s reads to 5 s; the 8 s buffer
            // mirrors that passage to open at 3 s, and the loop grid opens there.
            const clip: CanonicalClip = {
                ...baseClip,
                startBeat: 2,
                endBeat: 6,
                audioOffsetSeconds: 1,
                audioUnwrappedOffsetSeconds: 0.75,
                audioLoopStartSeconds: 0.5,
                audioLoopPassEntrySeconds: 0.9,
                audioLoopPassOriginBeat: 1,
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 1,
            };

            const { publishedClip } = reverseWithBuffer(clip, 64);

            expect(publishedClip).toMatchObject({
                audioOffsetSeconds: 3,
                audioUnwrappedOffsetSeconds: 3,
                audioLoopStartSeconds: 3,
                audioLoopPassEntrySeconds: 3,
                audioLoopPassOriginBeat: 2,
                loopOriginBeat: 2,
            });
            expect(readerEntrySeconds(publishedClip!)).toBeCloseTo(3, 12);
        });

        it('restores the original entry when the mirrored clip is reversed again', () => {
            mocks.transportTempo = 120;
            mocks.tempoMapChanges = [
                { beat: 0, tempo: 120, curve: 'instant' },
                { beat: 2, tempo: 60, curve: 'instant' },
            ];
            const clip: CanonicalClip = { ...baseClip, startBeat: 1, endBeat: 3, audioOffsetSeconds: 0.5 };

            const first = reverseWithBuffer(clip, 32).publishedClip!;
            const second = reverseWithBuffer(first, 32).publishedClip!;

            expect(second.audioOffsetSeconds).toBeCloseTo(0.5, 12);
        });

        it('refuses a canonical entry it cannot mirror rather than keeping the old entry', () => {
            const clip: CanonicalClip = {
                ...baseClip,
                startBeat: 0,
                endBeat: 1,
                audioOffsetSeconds: Number.NaN,
            };

            const { didWrite } = reverseWithBuffer(clip, 32);

            expect(didWrite).toBe(false);
            expect(mocks.updateClip).not.toHaveBeenCalled();
            expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        });

        it('keeps a beat-only clip free of canonical fields', () => {
            const clip: CanonicalClip = { ...baseClip, startBeat: 0, endBeat: 1, audioOffsetBeats: 1 };

            const { publishedClip } = reverseWithBuffer(clip, 32);

            expect(publishedClip?.audioOffsetBeats).toBe(2);
            expect(Object.hasOwn(publishedClip!, 'audioOffsetSeconds')).toBe(false);
        });
    });
});
