import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
    addTrack: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    pushUndoEntry: vi.fn(),
    trackStoreValue: { tracks: [], selectedTrackId: null },
    trackStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
        set: mocks.trackStoreSet,
    },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mocks.addClip,
    addTrack: mocks.addTrack,
    removeClip: vi.fn(),
    removeTrack: vi.fn(),
    captureRetiredTakeLanes: vi.fn(() => []),
    restoreTakesForClip: vi.fn(),
    resolveBouncedClipEndBeat: (input: {
        startBeat: number;
        musicalEndBeat: number;
        renderedBuffer: AudioBuffer;
        timelineSecondsAtBeat: (beat: number) => number;
        projectSampleToBeat: (position: { samples: number; sampleRate: number }) => number;
    }) => {
        const sampleRate = input.renderedBuffer.sampleRate;
        const startSamples = Math.round(input.timelineSecondsAtBeat(input.startBeat) * sampleRate);
        const bufferEndBeat = input.projectSampleToBeat({
            samples: startSamples + input.renderedBuffer.length,
            sampleRate,
        });
        return Math.max(input.musicalEndBeat, bufferEndBeat);
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
}));

describe('renderToClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue = { tracks: [], selectedTrackId: null };
    });

    it('writes the buffer into the cache, creates a clip on the target track, and records an undo entry', async () => {
        const { renderToClip } = await import('../renderToClip');

        const buffer = { length: 44100, numberOfChannels: 2, sampleRate: 44100 } as unknown as AudioBuffer;
        mocks.addClip.mockReturnValue({ id: 'clip-new', trackId: 'track-1' });

        const result = renderToClip({
            targetTrackId: 'track-1',
            startBeat: 4,
            endBeat: 12,
            buffer,
            name: 'Rendered Mixdown',
        });

        expect(result).not.toBeNull();
        expect(result?.trackId).toBe('track-1');
        expect(result?.clipId).toBe('clip-new');
        expect(typeof result?.audioBufferId).toBe('string');
        expect(result?.audioBufferId.startsWith('rendered-')).toBe(true);

        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({ buffer, bufferId: result?.audioBufferId });
        expect(mocks.addClip).toHaveBeenCalledWith({
            trackId: 'track-1',
            startBeat: 4,
            endBeat: 12,
            name: 'Rendered Mixdown',
            type: 'audio',
            audioBufferId: result?.audioBufferId,
        });
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith('Render to clip', expect.any(Function), expect.any(Function), {
            restoresBufferIds: [result?.audioBufferId],
        });
    });

    it('creates a new audio track when targetTrackId is "new"', async () => {
        const { renderToClip } = await import('../renderToClip');

        const buffer = { length: 44100, numberOfChannels: 2, sampleRate: 44100 } as unknown as AudioBuffer;
        mocks.addTrack.mockReturnValue({ id: 'track-fresh', name: 'Rendered', kind: 'audio' });
        mocks.addClip.mockReturnValue({ id: 'clip-fresh', trackId: 'track-fresh' });

        const result = renderToClip({
            targetTrackId: 'new',
            startBeat: 0,
            endBeat: 8,
            buffer,
            name: 'Rendered',
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Rendered', kind: 'audio' });
        expect(result?.trackId).toBe('track-fresh');
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 'track-fresh', startBeat: 0, endBeat: 8 })
        );
    });

    it('places the clip through the end of a buffer that outlasts the musical selection', async () => {
        const { renderToClip } = await import('../renderToClip');

        // Beats 0–8 at the 120 BPM fallback are 4 seconds. Six seconds of audio
        // keeps two seconds of decay, which lands at beat 12.
        const sampleRate = 48_000;
        const buffer = createRenderedBuffer(6 * sampleRate, sampleRate);
        mocks.addClip.mockReturnValue({ id: 'clip-tail', trackId: 'track-1' });

        renderToClip({
            targetTrackId: 'track-1',
            startBeat: 0,
            endBeat: 8,
            buffer,
            name: 'Rendered Tail',
        });

        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 'track-1', startBeat: 0, endBeat: expect.closeTo(12, 5) })
        );

        const recordedUndo = mocks.pushUndoEntry.mock.calls[0];
        if (!recordedUndo) {
            throw new Error('expected a render-to-clip undo entry');
        }
        const redo: () => void = recordedUndo[2];
        mocks.addClip.mockClear();
        mocks.addClip.mockReturnValue({ id: 'clip-tail', trackId: 'track-1' });
        redo();
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 'track-1', startBeat: 0, endBeat: expect.closeTo(12, 5) })
        );
    });
});

function createRenderedBuffer(lengthSamples: number, sampleRate: number): AudioBuffer {
    const channel = new Float32Array(lengthSamples);
    return {
        duration: lengthSamples / sampleRate,
        length: lengthSamples,
        numberOfChannels: 1,
        sampleRate,
        getChannelData: () => channel,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    };
}
