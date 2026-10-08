import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { reverseClip } from '../reverseClip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateClip: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    clearClipPitchAnalysis: vi.fn(),
    notifyUser: vi.fn(),
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
    readSecondsAtBeat: vi.fn<({ beat }: { beat: number }) => number>(),
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

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
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
    readSecondsAtBeat: ({ beat }: { beat: number }) => mocks.readSecondsAtBeat({ beat }),
}));

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
        mocks.readSecondsAtBeat.mockImplementation(({ beat }) => beat);
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

    it('mirrors the canonical source window through an interior tempo change on both channels', () => {
        // [0,2) at 60 BPM and [2,4) at 120 BPM lasts 3 seconds. At 2x
        // stretch, the original clip reads six source seconds from offset zero.
        const sampleRate = 8;
        const sourceSamples = 64;
        const original = [
            Float32Array.from({ length: sourceSamples }, (_, index) => index),
            Float32Array.from({ length: sourceSamples }, (_, index) => 1000 + index),
        ];
        const reversed = [new Float32Array(sourceSamples), new Float32Array(sourceSamples)];
        const clip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Stereo',
            startBeat: 0,
            endBeat: 4,
            audioOffsetSeconds: 0,
            audioOffsetBeats: 5, // stale alias must not override canonical zero
            stretchMode: 'timestretch' as const,
            stretchRatio: 2,
            fadeInBeats: 0.25,
            fadeOutBeats: 0.75,
        };
        let publishedClip: typeof clip | undefined;
        mocks.tempoMapChanges = [{ beat: 2, tempo: 120, curve: 'instant' }];
        mocks.readTempoAtBeat.mockImplementation(({ beat }) => (beat < 2 ? 60 : 120));
        mocks.readSecondsAtBeat.mockImplementation(({ beat }) => (beat <= 2 ? beat : 2 + (beat - 2) / 2));
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'track-1', clips: [clip] }] });
        mocks.updateClip.mockImplementation((_clipId: string, updater: (candidate: typeof clip) => typeof clip) => {
            publishedClip = updater(clip);
            return true;
        });
        mocks.getCachedAudioBuffer.mockReturnValue({
            numberOfChannels: 2,
            length: sourceSamples,
            sampleRate,
            getChannelData: (channel: number) => original[channel],
        });
        mockCtx.createBuffer.mockReturnValue({
            numberOfChannels: 2,
            length: sourceSamples,
            sampleRate,
            getChannelData: (channel: number) => reversed[channel],
        });

        expect(reverseClip('c1')).toBe(true);

        expect(mockCtx.createBuffer).toHaveBeenCalledWith(2, sourceSamples, sampleRate);
        expect(publishedClip).toMatchObject({
            startBeat: 0,
            endBeat: 4,
            audioOffsetSeconds: 2, // 8-second buffer - zero entry - six consumed seconds
            audioOffsetBeats: 2,
            fadeInBeats: 0.75,
            fadeOutBeats: 0.25,
        });
        // The runtime seeks to sample 16 in the reversed buffer and reads 48
        // samples. Its first and last frames are the original window's edges.
        for (let channel = 0; channel < 2; channel++) {
            expect(reversed[channel]?.[16]).toBe(original[channel]?.[47]);
            expect(reversed[channel]?.[63]).toBe(original[channel]?.[0]);
        }
    });

    it.each([
        { oldOffsetSeconds: -1, expectedOffsetSeconds: 6 },
        { oldOffsetSeconds: 7, expectedOffsetSeconds: -2 },
    ])(
        'keeps a signed mirrored source entry for $oldOffsetSeconds seconds',
        ({ oldOffsetSeconds, expectedOffsetSeconds }) => {
            const clip = {
                id: 'c1',
                type: 'audio',
                audioBufferId: 'buf1',
                name: 'Sample',
                startBeat: 0,
                endBeat: 3,
                audioOffsetSeconds: oldOffsetSeconds,
                audioOffsetBeats: 99,
            };
            let publishedClip: typeof clip | undefined;
            mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'track-1', clips: [clip] }] });
            mocks.updateClip.mockImplementation((_clipId: string, updater: (candidate: typeof clip) => typeof clip) => {
                publishedClip = updater(clip);
                return true;
            });
            mocks.getCachedAudioBuffer.mockReturnValue({
                numberOfChannels: 1,
                length: 64,
                sampleRate: 8,
                getChannelData: () => new Float32Array(64),
            });
            mockCtx.createBuffer.mockReturnValue({ getChannelData: () => new Float32Array(64) });

            expect(reverseClip('c1')).toBe(true);
            expect(publishedClip?.audioOffsetSeconds).toBe(expectedOffsetSeconds);
            expect(publishedClip?.audioOffsetBeats).toBe(expectedOffsetSeconds);
        }
    );

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
        mocks.readSecondsAtBeat.mockImplementation(({ beat }) => beat / 2);
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

    it('refuses a looped reverse before creating or publishing reversed audio', () => {
        const clip = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'buf1',
            name: 'Loop',
            startBeat: 0,
            endBeat: 6,
            loopEnabled: true,
            loopLength: 2,
            audioOffsetSeconds: 1,
        };
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'track-1', clips: [clip] }] });

        expect(reverseClip('c1')).toBe(false);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringMatching(/loop/i), 'error');
        expect(mockCtx.createBuffer).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateClip).not.toHaveBeenCalled();
        expect(mocks.clearClipPitchAnalysis).not.toHaveBeenCalled();
    });
});
