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
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
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
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith('Render to clip', expect.any(Function), expect.any(Function));
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
});
