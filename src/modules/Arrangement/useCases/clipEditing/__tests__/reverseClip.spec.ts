import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    resolveTempoAtBeat: vi.fn(
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

vi.mock('#/modules/Transport/useCases', () => ({
    resolveTempoAtBeat: mocks.resolveTempoAtBeat,
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
        mocks.resolveTempoAtBeat.mockImplementation(
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
        mocks.transportTempo = 120;
        mocks.tempoMapChanges = [{ beat: 0, tempo: 60, curve: 'instant' as const }];
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

        expect(mocks.resolveTempoAtBeat).toHaveBeenCalledWith(expect.objectContaining({ beat: 0, defaultTempo: 120 }));
        expect(publishedClip?.audioOffsetBeats).toBe(2);
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
});
