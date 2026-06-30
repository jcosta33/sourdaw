import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '../../stores/trackStore';
import { importAudioFile } from '../importAudioFile';

const mocks = vi.hoisted(() => ({
    decodeAudioFile: vi.fn(),
    getAssetTransfer: vi.fn(),
    addClip: vi.fn(),
    pushUndoEntry: vi.fn(),
    notifyUser: vi.fn(),
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
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('../clip/addClip', () => ({
    addClip: mocks.addClip,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('importAudioFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
        mocks.decodeAudioFile.mockResolvedValue({
            id: 'buf-1',
            buffer: { duration: 1 } as AudioBuffer,
        });
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
});
