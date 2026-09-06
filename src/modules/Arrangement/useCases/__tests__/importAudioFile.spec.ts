import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '../../stores/trackStore';
import { importAudioFile } from '../importAudioFile';

const mocks = vi.hoisted(() => ({
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    executeAppActionBatch: vi.fn(),
    getAssetTransfer: vi.fn(),
    notifyUser: vi.fn(),
    transportValue: { value: null as { tempo: number } | null },
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: mocks.decodeAudioFile,
    discardDecodedAudioFile: mocks.discardDecodedAudioFile,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/useCases')>()),
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppActionBatch: mocks.executeAppActionBatch,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return mocks.transportValue.value;
        },
    },
}));

function createStagedTransfer() {
    return {
        stageLocalAsset: vi.fn().mockResolvedValue({ hash: 'hash-1', leaseId: 'lease-1' }),
        releaseStagedAsset: vi.fn(),
        promoteStagedAsset: vi.fn(),
    };
}

describe('importAudioFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        mocks.decodeAudioFile.mockResolvedValue({
            id: 'buffer-1',
            buffer: { duration: 1 } as AudioBuffer,
        });
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
        mocks.getAssetTransfer.mockReturnValue(null);
        mocks.transportValue.value = null;
    });

    it('commits one grouped add-track/add-clip batch with stable generated track fields', async () => {
        const transfer = createStagedTransfer();
        mocks.getAssetTransfer.mockReturnValue(transfer);
        const shouldContinue = vi.fn(() => true);

        await expect(importAudioFile(new File([], 'loop.wav'), { shouldContinue })).resolves.toBe('completed');

        expect(mocks.executeAppActionBatch).toHaveBeenCalledTimes(1);
        const [actions, options] = mocks.executeAppActionBatch.mock.calls[0]!;
        expect(actions).toHaveLength(2);
        expect(actions[0]).toMatchObject({
            type: 'addTrack',
            payload: {
                id: expect.stringMatching(/^track-/),
                name: 'loop',
                kind: 'audio',
                color: expect.any(String),
                initialAlternativeId: expect.stringMatching(/^alt-/),
                select: false,
            },
        });
        expect(actions[1]).toMatchObject({
            type: 'addClip',
            payload: {
                trackId: actions[0].payload.id,
                startBeat: 0,
                endBeat: 4,
                name: 'loop',
                type: 'audio',
                audioBufferId: 'buffer-1',
                assetHash: 'hash-1',
            },
        });
        expect(options).toMatchObject({
            groupId: expect.stringMatching(/^import-audio-/),
            groupLabel: 'Import audio: loop',
            source: 'manual',
            requireCompensation: true,
        });
        expect(options.shouldExecute).toBe(shouldContinue);
        expect(transfer.promoteStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
    });

    it('uses the current transport tempo and rounds the clip to a whole bar', async () => {
        mocks.transportValue.value = { tempo: 90 };
        mocks.decodeAudioFile.mockResolvedValue({
            id: 'buffer-1',
            buffer: { duration: 5 } as AudioBuffer,
        });

        await importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true });

        const actions = mocks.executeAppActionBatch.mock.calls[0]?.[0];
        expect(actions?.[1]).toMatchObject({ type: 'addClip', payload: { endBeat: 8 } });
    });

    it('reports decode failure only while the initiating project remains current', async () => {
        mocks.decodeAudioFile.mockRejectedValue(new Error('unsupported'));

        await expect(importAudioFile(new File([], 'corrupt.wav'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Failed to import "corrupt.wav" — unsupported format or corrupt file',
            'error'
        );
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();

        vi.clearAllMocks();
        mocks.decodeAudioFile.mockRejectedValue(new Error('unsupported'));
        await expect(importAudioFile(new File([], 'stale.wav'), { shouldContinue: () => false })).resolves.toBe(
            'superseded'
        );
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('discards decoded media when the project has no loaded track state', async () => {
        trackStore.set(null);

        await expect(importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );

        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('buffer-1');
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('releases prepared resources when the track store is cleared during staging', async () => {
        const transfer = createStagedTransfer();
        transfer.stageLocalAsset.mockImplementation(async () => {
            trackStore.set(null);
            return { hash: 'hash-1', leaseId: 'lease-1' };
        });
        mocks.getAssetTransfer.mockReturnValue(transfer);

        await importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true });

        expect(transfer.releaseStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.promoteStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('buffer-1');
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('discards decoded media when staging fails before a lease exists', async () => {
        const transfer = createStagedTransfer();
        transfer.stageLocalAsset.mockRejectedValue(new Error('hash failed'));
        mocks.getAssetTransfer.mockReturnValue(transfer);

        await importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true });

        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
        expect(transfer.promoteStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('buffer-1');
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Failed to import "loop.wav" — asset registration failed',
            'error'
        );
    });

    it('releases prepared resources when batch setup rejects before returning a typed result', async () => {
        const transfer = createStagedTransfer();
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.executeAppActionBatch.mockRejectedValue(new Error('snapshot setup failed'));

        await expect(importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );

        expect(transfer.releaseStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.promoteStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('buffer-1');
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Failed to import "loop.wav" — project state could not be updated',
            'error'
        );
    });

    it.each([
        [{ status: 'no-op', actions: [] }, 'the import made no project change'],
        [{ status: 'rejected', reason: 'rejected reason', actions: [] }, 'rejected reason'],
        [{ status: 'conflicted', reason: 'conflict reason', actions: [] }, 'conflict reason'],
        [{ status: 'cancelled', reason: 'cancelled reason', actions: [] }, 'cancelled reason'],
        [{ status: 'failed', reason: 'failed reason', actions: [] }, 'failed reason'],
    ])('releases prepared resources for a non-committing batch result %#', async (result, reason) => {
        const transfer = createStagedTransfer();
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.executeAppActionBatch.mockResolvedValue(result);

        await expect(importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );

        expect(transfer.releaseStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.promoteStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('buffer-1');
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining(reason), 'error');
    });

    it.each([
        { status: 'executed', actions: [] },
        { status: 'executed-with-warning', actions: [], warning: 'runtime warning' },
    ])('treats runtime-only batch result $status as an internal route failure', async (result) => {
        const transfer = createStagedTransfer();
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.executeAppActionBatch.mockResolvedValue(result);

        await importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true });

        expect(transfer.releaseStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.promoteStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('buffer-1');
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('runtime-only result'), 'error');
    });

    it('promotes and retains committed media while surfacing a history warning', async () => {
        const transfer = createStagedTransfer();
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'committed-with-warning',
            actions: [],
            warning: 'history was unavailable',
        });

        await importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true });

        expect(transfer.promoteStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Imported "loop.wav" with a project warning: history was unavailable',
            'warning'
        );
    });

    it('promotes and retains media conservatively when the project commit is ambiguous', async () => {
        const transfer = createStagedTransfer();
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'ambiguous', reason: 'commit uncertain', actions: [] });

        await importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true });

        expect(transfer.promoteStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Import of "loop.wav" may have committed: commit uncertain',
            'warning'
        );
    });

    it('retains committed media and reports asset finalization failure without rolling project state back', async () => {
        const transfer = createStagedTransfer();
        transfer.promoteStagedAsset.mockImplementation(() => {
            throw new Error('promotion failed');
        });
        mocks.getAssetTransfer.mockReturnValue(transfer);

        await expect(importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );

        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Imported "loop.wav", but its audio asset could not be finalized',
            'warning'
        );
    });

    it('reports both the history warning and asset finalization failure after a committed import', async () => {
        const transfer = createStagedTransfer();
        transfer.promoteStagedAsset.mockImplementation(() => {
            throw new Error('promotion failed');
        });
        mocks.getAssetTransfer.mockReturnValue(transfer);
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'committed-with-warning',
            actions: [],
            warning: 'history was unavailable',
        });

        await importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true });

        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenNthCalledWith(
            1,
            'Imported "loop.wav", but its audio asset could not be finalized',
            'warning'
        );
        expect(mocks.notifyUser).toHaveBeenNthCalledWith(
            2,
            'Imported "loop.wav" with a project warning: history was unavailable',
            'warning'
        );
    });

    it('returns superseded and suppresses feedback when batch authority expires', async () => {
        const transfer = createStagedTransfer();
        mocks.getAssetTransfer.mockReturnValue(transfer);
        let current = true;
        mocks.executeAppActionBatch.mockImplementation(async () => {
            current = false;
            return { status: 'cancelled', reason: 'authority revoked', actions: [] };
        });

        await expect(importAudioFile(new File([], 'stale.wav'), { shouldContinue: () => current })).resolves.toBe(
            'superseded'
        );

        expect(transfer.releaseStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.promoteStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith('buffer-1');
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('retains committed media but suppresses stale post-commit warning feedback', async () => {
        const transfer = createStagedTransfer();
        mocks.getAssetTransfer.mockReturnValue(transfer);
        let current = true;
        mocks.executeAppActionBatch.mockImplementation(async () => {
            current = false;
            return { status: 'committed-with-warning', actions: [], warning: 'history unavailable' };
        });

        await expect(importAudioFile(new File([], 'stale.wav'), { shouldContinue: () => current })).resolves.toBe(
            'superseded'
        );

        expect(transfer.promoteStagedAsset).toHaveBeenCalledWith('lease-1');
        expect(transfer.releaseStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
