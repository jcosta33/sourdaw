import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assetTransfer: null as null | {
        stageDurableAsset: (
            file: File,
            name: string,
            leaseId: string,
            options?: { protectAcrossTransfer?: boolean }
        ) => Promise<{ hash: string; leaseId: string }>;
        stageLocalAsset: (file: File, name: string) => Promise<{ hash: string; leaseId: string }>;
        prepareDurableCleanupRecovery: (recoveryId: string, bindings: unknown[]) => Promise<{ status: string }>;
        completeDurableCleanupRecovery: (recoveryId: string) => Promise<{ status: string; reason?: string }>;
        releaseDurableStagedAsset: (leaseId: string, hash: string) => Promise<{ status: string; reason?: string }>;
    },
    decodeAudioFile: vi.fn(),
    detectTempo: vi.fn(() => 120),
    pickFiles: vi.fn<() => Promise<File[] | null>>(),
    stageDurableAsset: vi.fn(),
    stageLocalAsset: vi.fn(),
    prepareDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'prepared' }),
    completeDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'completed' }),
    releaseDurableStagedAsset: vi.fn().mockResolvedValue({ status: 'released' }),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectTempo: mocks.detectTempo,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: mocks.decodeAudioFile,
    releasePreviewAudioBuffer: vi.fn(),
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => mocks.assetTransfer,
}));
vi.mock('#/modules/Project/useCases', () => ({
    pickFiles: mocks.pickFiles,
}));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { tempo: 120 } },
}));

import { agentRunLifecycle } from '../../agentRunLifecycle';
import { prepareStemImport } from '../prepareStemImport';

describe('prepareStemImport budget admission', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        vi.clearAllMocks();
        mocks.assetTransfer = {
            stageDurableAsset: mocks.stageDurableAsset,
            stageLocalAsset: mocks.stageLocalAsset,
            prepareDurableCleanupRecovery: mocks.prepareDurableCleanupRecovery,
            completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
            releaseDurableStagedAsset: mocks.releaseDurableStagedAsset,
        };
    });

    it('leaves every category unchanged when a later stem-preparation limit rejects admission', async () => {
        agentRunLifecycle.create({
            runId: 'stem-budget-run',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'revision-a',
            budgets: { limits: { localAnalysis: 2, downloadBytes: 3, storageBytes: 8 }, consumed: {} },
        });
        mocks.pickFiles.mockResolvedValue([
            new File([new Uint8Array(2)], 'kick.wav', { type: 'audio/wav' }),
            new File([new Uint8Array(2)], 'snare.wav', { type: 'audio/wav' }),
        ]);

        await expect(
            prepareStemImport(
                undefined,
                ({ analysisCount, downloadBytes, storageBytes }) =>
                    agentRunLifecycle.reserveBudgetBatch({
                        runId: 'stem-budget-run',
                        attempts: [
                            {
                                attemptId: 'stem-preparation:localAnalysis',
                                category: 'localAnalysis',
                                estimate: analysisCount,
                                provenance: 'versioned-estimate',
                            },
                            {
                                attemptId: 'stem-preparation:downloadBytes',
                                category: 'downloadBytes',
                                estimate: downloadBytes,
                                provenance: 'versioned-estimate',
                            },
                            {
                                attemptId: 'stem-preparation:storageBytes',
                                category: 'storageBytes',
                                estimate: storageBytes,
                                provenance: 'versioned-estimate',
                            },
                        ],
                    }).status === 'reserved'
            )
        ).rejects.toThrow('The selected stem preparation exceeds the user budget.');

        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.stageDurableAsset).not.toHaveBeenCalled();
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-budget-run')?.budgets.consumed).toEqual({});
        expect(agentRunLifecycle.get('stem-budget-run')?.budgetAttempts).toEqual([]);
    });

    it('retains each caller-keyed durable asset hash and lease in the prepared stem contract', async () => {
        const files = [
            new File(['kick'], 'kick.wav', { type: 'audio/wav' }),
            new File(['snare'], 'snare.wav', { type: 'audio/wav' }),
        ];
        mocks.pickFiles.mockResolvedValue(files);
        mocks.decodeAudioFile.mockImplementation((file: File) =>
            Promise.resolve({
                id: `buffer-${file.name}`,
                buffer: { duration: 1, length: 48_000, numberOfChannels: 2 },
            })
        );
        mocks.stageDurableAsset.mockImplementation((_file: File, name: string, leaseId: string) =>
            Promise.resolve({ hash: `hash-${name}`, leaseId })
        );

        const result = await prepareStemImport(undefined, () => true);

        expect(result.status).toBe('prepared');
        if (result.status !== 'prepared') {
            throw new TypeError('Expected prepared stem resources');
        }
        expect(result.stems).toEqual([
            expect.objectContaining({
                sourceName: 'kick.wav',
                audioBufferId: 'buffer-kick.wav',
                assetHash: 'hash-kick.wav',
                assetLeaseId: expect.stringMatching(/^asset-stage-stem-/u),
            }),
            expect.objectContaining({
                sourceName: 'snare.wav',
                audioBufferId: 'buffer-snare.wav',
                assetHash: 'hash-snare.wav',
                assetLeaseId: expect.stringMatching(/^asset-stage-stem-/u),
            }),
        ]);
        expect(mocks.stageDurableAsset).toHaveBeenCalledTimes(2);
        expect(mocks.stageDurableAsset.mock.calls[0]).toEqual([
            files[0],
            'kick.wav',
            expect.stringMatching(/^asset-stage-stem-/u),
            { protectAcrossTransfer: true },
        ]);
        expect(mocks.stageDurableAsset.mock.calls[1]).toEqual([
            files[1],
            'snare.wav',
            expect.stringMatching(/^asset-stage-stem-/u),
            { protectAcrossTransfer: true },
        ]);
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
    });

    it('preserves the preparation error while a transient durable cleanup remains retryable', async () => {
        const files = [new File(['kick'], 'kick.wav'), new File(['snare'], 'snare.wav')];
        mocks.pickFiles.mockResolvedValue(files);
        mocks.decodeAudioFile
            .mockResolvedValueOnce({
                id: 'buffer-kick.wav',
                buffer: { duration: 1, length: 48_000, numberOfChannels: 2 },
            })
            .mockRejectedValueOnce(new Error('decode primary failure'));
        mocks.stageDurableAsset.mockResolvedValue({ hash: 'hash-kick.wav', leaseId: 'asset-stage-kick' });
        mocks.completeDurableCleanupRecovery.mockResolvedValueOnce({
            status: 'failed',
            reason: 'transaction-aborted',
        });

        await expect(prepareStemImport(undefined, () => true)).rejects.toThrow('decode primary failure');
        expect(mocks.prepareDurableCleanupRecovery).toHaveBeenCalledWith('stem-cleanup:["asset-stage-kick"]', [
            { leaseId: 'asset-stage-kick', expectedHash: 'hash-kick.wav' },
        ]);
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledWith('stem-cleanup:["asset-stage-kick"]');
    });

    it('reopens every prepared lease and hash after the settled-owner transfer is recreated', async () => {
        const files = [new File(['kick'], 'kick.wav'), new File(['snare'], 'snare.wav')];
        const durable = new Map<string, { hash: string; file: File; name: string }>();
        function createTransfer() {
            const sessionOnly = new Map<string, { hash: string; file: File; name: string }>();
            return {
                stageLocalAsset: async (file: File, name: string) => {
                    const leaseId = `session-${name}`;
                    const hash = `hash-${name}`;
                    sessionOnly.set(leaseId, { hash, file, name });
                    return { hash, leaseId };
                },
                stageDurableAsset: async (file: File, name: string, leaseId: string) => {
                    const hash = `hash-${name}`;
                    durable.set(leaseId, { hash, file, name });
                    return { hash, leaseId };
                },
                reopenDurableStagedAsset: async (leaseId: string, expectedHash: string) => {
                    const stored = durable.get(leaseId);
                    return stored?.hash === expectedHash
                        ? {
                              status: 'opened' as const,
                              leaseId,
                              hash: stored.hash,
                              blob: stored.file,
                              name: stored.name,
                          }
                        : { status: 'failed' as const, reason: 'unknown-lease' as const };
                },
                prepareDurableCleanupRecovery: async () => ({ status: 'prepared' as const }),
                completeDurableCleanupRecovery: async () => ({ status: 'completed' as const }),
                releaseDurableStagedAsset: async () => ({ status: 'released' as const }),
            };
        }
        mocks.pickFiles.mockResolvedValue(files);
        mocks.decodeAudioFile.mockImplementation((file: File) =>
            Promise.resolve({
                id: `buffer-${file.name}`,
                buffer: { duration: 1, length: 48_000, numberOfChannels: 2 },
            })
        );
        const preparingTransfer = createTransfer();
        mocks.assetTransfer = preparingTransfer;

        const prepared = await prepareStemImport(undefined, () => true);
        expect(prepared.status).toBe('prepared');
        if (prepared.status !== 'prepared') {
            throw new TypeError('Expected prepared stem resources');
        }
        const recreated = createTransfer();
        mocks.assetTransfer = recreated;

        for (const stem of prepared.stems) {
            expect(stem.assetLeaseId).toBeDefined();
            expect(stem.assetHash).toBeDefined();
            await expect(
                recreated.reopenDurableStagedAsset(stem.assetLeaseId!, stem.assetHash!)
            ).resolves.toMatchObject({
                status: 'opened',
                leaseId: stem.assetLeaseId,
                hash: stem.assetHash,
            });
        }
    });
});
