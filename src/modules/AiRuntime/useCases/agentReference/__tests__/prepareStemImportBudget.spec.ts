import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    decodeAudioFile: vi.fn(),
    detectTempo: vi.fn(() => 120),
    pickFiles: vi.fn<() => Promise<File[] | null>>(),
    stageLocalAsset: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectTempo: mocks.detectTempo,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: mocks.decodeAudioFile,
    releasePreviewAudioBuffer: vi.fn(),
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({ stageLocalAsset: mocks.stageLocalAsset }),
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
    });

    it('prepares executable PCM without committing a durable asset before confirmation receipt', async () => {
        mocks.pickFiles.mockResolvedValue([
            new File(['kick'], 'kick.wav', { type: 'audio/wav' }),
            new File(['snare'], 'snare.wav', { type: 'audio/wav' }),
        ]);
        mocks.decodeAudioFile.mockImplementation((file: File) =>
            Promise.resolve({
                id: `buffer-${file.name}`,
                buffer: { duration: 1, length: 48_000, numberOfChannels: 1 },
            })
        );

        await expect(prepareStemImport(undefined, () => true)).resolves.toMatchObject({
            status: 'prepared',
            stems: [
                { audioBufferId: 'buffer-kick.wav', sourceName: 'kick.wav' },
                { audioBufferId: 'buffer-snare.wav', sourceName: 'snare.wav' },
            ],
        });
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
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
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-budget-run')?.budgets.consumed).toEqual({});
        expect(agentRunLifecycle.get('stem-budget-run')?.budgetAttempts).toEqual([]);
    });
});
