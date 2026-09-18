import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { isAgentAssetSagaReceipt } from '../agentAssetSagaWire';
import { cleanupAgentAssetSaga } from '../cleanupAgentAssetSaga';
import { finalizeAgentAssetExport } from '../finalizeAgentAssetExport';
import { importAgentAsset } from '../importAgentAsset';
import { registerAgentAssetHandle } from '../registerAgentAssetHandle';
import { stageAgentAssetExport } from '../stageAgentAssetExport';

import type { AgentAssetSagaReceipt, AgentWorkOwner } from '../agentAssetSagaWire';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
}));

const owner: AgentWorkOwner = {
    runId: 'run-77',
    workId: 'work-31',
    leaseId: 'lease-9',
    cancellationGeneration: 4,
};

const receipt = (overrides: Partial<AgentAssetSagaReceipt> = {}): AgentAssetSagaReceipt => ({
    sagaId: 'asset-saga-8f2b1c44-0f3d-4a51-9d2e-6c4b5a7e1f30',
    owner,
    operation: 'import',
    state: 'committed',
    compensation: 'not-needed',
    handleId: null,
    assetId: null,
    contentHash: null,
    metadata: null,
    failure: null,
    message: null,
    finalizeOwner: null,
    cleanupOwner: null,
    ...overrides,
});

describe('the agent asset saga bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(desktopInvoke).mockResolvedValue(receipt());
    });

    it('invokes each command with the arguments its registration names', async () => {
        // The seam orders a named record by `SOURDAW_COMMAND_ARGUMENTS`, so a key spelled
        // differently here is refused there rather than crossing the addon as `undefined`.
        const bytes = new Uint8Array([1, 2, 3]);

        await registerAgentAssetHandle('/samples/kick.wav', 'read', owner);
        await importAgentAsset('asset-handle-1', owner, { sampleRate: 44_100 });
        await stageAgentAssetExport('asset-handle-2', owner, 'a'.repeat(64), bytes);
        await finalizeAgentAssetExport('asset-saga-1', owner, { overwrite: true });
        await cleanupAgentAssetSaga(null, owner);

        expect(vi.mocked(desktopInvoke).mock.calls).toEqual([
            ['agent_asset_register_handle', { path: '/samples/kick.wav', mode: 'read', owner }],
            ['agent_asset_import', { handleId: 'asset-handle-1', owner, declared: { sampleRate: 44_100 } }],
            [
                'agent_asset_stage_export',
                { destinationHandleId: 'asset-handle-2', owner, expectedSha256: 'a'.repeat(64), data: bytes },
            ],
            ['agent_asset_finalize_export', { sagaId: 'asset-saga-1', owner, authorization: { overwrite: true } }],
            ['agent_asset_cleanup', { sagaId: null, owner }],
        ]);
    });

    it('returns the receipt owner untouched', async () => {
        const answered = receipt({ operation: 'stage-export', state: 'external-pending', compensation: 'available' });
        vi.mocked(desktopInvoke).mockResolvedValue(answered);

        const returned = await stageAgentAssetExport('asset-handle-2', owner, 'a'.repeat(64), new Uint8Array());

        expect(returned.owner).toEqual(owner);
        expect(returned.state).toBe('external-pending');
        expect(returned.compensation).toBe('available');
    });

    it('refuses a payload with no owner', async () => {
        const { owner: _omitted, ...withoutOwner } = receipt();
        vi.mocked(desktopInvoke).mockResolvedValue(withoutOwner);

        await expect(importAgentAsset('asset-handle-1', owner, {})).rejects.toThrow(
            'agent_asset_import returned an invalid saga receipt'
        );
    });

    it('rejects a payload missing any field a caller decides from', () => {
        expect(isAgentAssetSagaReceipt(receipt())).toBe(true);

        for (const field of ['sagaId', 'owner', 'state', 'compensation'] as const) {
            const { [field]: _omitted, ...incomplete } = receipt();
            expect(isAgentAssetSagaReceipt(incomplete), `${field} must be required`).toBe(false);
        }
    });
});
