import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '../../stores/trackStore';
import { importAudioFile } from '../importAudioFile';

const mocks = vi.hoisted(() => ({
    decodeAudioFile: vi.fn(),
    getAssetTransfer: vi.fn(),
    addClip: vi.fn(),
    pushUndoEntry: vi.fn(),
    notifyUser: vi.fn(),
    transportValue: { value: null as { tempo: number } | null },
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    decodeAudioFile: mocks.decodeAudioFile,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('../clip/addClip', () => ({
    addClip: mocks.addClip,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    transportStore: {
        get value() {
            return mocks.transportValue.value;
        },
    },
}));

describe('importAudioFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
        mocks.decodeAudioFile.mockResolvedValue({
            id: 'buf-1',
            buffer: { duration: 1 } as AudioBuffer,
        });
        mocks.getAssetTransfer.mockReturnValue(null);
    });

    it('does not drop a concurrent track edit that lands during the asset-hash await', async () => {
        // addLocalAsset is the awaited yield point (a real hashBlob is async).
        // Hold it open, inject a concurrent trackStore write, then resolve.
        let releaseHash: (hash: string) => void = () => {};
        const hashGate = new Promise<string>((resolve) => {
            releaseHash = resolve;
        });
        mocks.getAssetTransfer.mockReturnValue({
            addLocalAsset: vi.fn(() => hashGate),
        });

        const importPromise = importAudioFile(new File([], 'kick.wav'));

        // Let the import advance to the addLocalAsset await.
        await Promise.resolve();
        await Promise.resolve();

        // A concurrent write commits while the hash is in flight.
        trackStore.set({
            tracks: [{ id: 'concurrent-track' } as never],
            selectedTrackId: null,
        });

        releaseHash('hash-1');
        await importPromise;

        const ids = trackStore.value?.tracks.map((t) => t.id) ?? [];
        // The concurrently-added track must survive the import write.
        expect(ids).toContain('concurrent-track');
        // The imported audio track is also present (2 tracks total).
        expect(trackStore.value?.tracks).toHaveLength(2);
    });

    it('imports a file into an empty project creating a new bar-aligned audio track', async () => {
        await importAudioFile(new File([], 'loop.wav'));

        // A single new audio track is created and a clip placed on it.
        expect(trackStore.value?.tracks).toHaveLength(1);
        expect(mocks.addClip).toHaveBeenCalledTimes(1);
        const clip = mocks.addClip.mock.calls[0]?.[0] as {
            trackId: string;
            startBeat: number;
            endBeat: number;
            type: string;
            name: string;
        };
        expect(clip.type).toBe('audio');
        expect(clip.name).toBe('loop');
        expect(clip.startBeat).toBe(0);
        // The clip length is rounded up to a whole bar (multiple of 4 beats).
        expect(clip.endBeat % 4).toBe(0);
        expect(clip.endBeat).toBeGreaterThanOrEqual(4);
        // An undo entry is recorded so the import can be undone.
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        expect(typeof mocks.pushUndoEntry.mock.calls[0]?.[1]).toBe('function');
    });

    it('aborts with an error notification when decoding fails', async () => {
        mocks.decodeAudioFile.mockRejectedValue(new Error('unsupported'));

        await importAudioFile(new File([], 'corrupt.wav'));

        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('corrupt.wav'), 'error');
        expect(trackStore.value?.tracks).toHaveLength(0);
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('records an undo function that restores the pre-import track state', async () => {
        const before = trackStore.value;
        await importAudioFile(new File([], 'loop.wav'));

        const undo = mocks.pushUndoEntry.mock.calls[0]?.[1] as () => void;
        undo();

        // Undo must rewind the store to the snapshot captured before the import.
        expect(trackStore.value).toEqual(before);
    });

    it('records a redo function that reapplies the post-import track state', async () => {
        await importAudioFile(new File([], 'loop.wav'));

        const snapshotAfterImport = trackStore.value;
        // Simulate a later unrelated change.
        trackStore.set({ tracks: [], selectedTrackId: null });

        const redo = mocks.pushUndoEntry.mock.calls[0]?.[2] as () => void;
        redo();

        expect(trackStore.value).toEqual(snapshotAfterImport);
    });

    it('aborts silently when the track store has not loaded before decode', async () => {
        trackStore.set(null);

        await importAudioFile(new File([], 'loop.wav'));

        // decode ran, but there is no state to write into
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('aborts silently when the track store is cleared during the asset-hash await', async () => {
        // Hold the hash await open, clear the store mid-flight, then resolve.
        let releaseHash: (hash: string) => void = () => {};
        const hashGate = new Promise<string>((resolve) => {
            releaseHash = resolve;
        });
        mocks.getAssetTransfer.mockReturnValue({
            addLocalAsset: vi.fn(() => hashGate),
        });

        const importPromise = importAudioFile(new File([], 'kick.wav'));
        await Promise.resolve();
        await Promise.resolve();

        // Store torn down while the hash is in flight.
        trackStore.set(null);
        releaseHash('hash-1');
        await importPromise;

        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('falls back to a 120 BPM tempo when the transport store is empty', async () => {
        // transportStore.value is null by default (not mocked) → tempo ?? 120.
        await importAudioFile(new File([], 'loop.wav'));

        const clip = mocks.addClip.mock.calls[0]?.[0] as { endBeat: number };
        // duration 1s at 120 BPM = 2 beats → ceil(2/4)*4 = 4 beats.
        expect(clip.endBeat).toBe(4);
    });
});
