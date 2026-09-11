import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { agentAssetFileBoundary } from '../agentAssetFileBoundary';

import type { AgentAssetSagaReceipt, AgentWorkOwner } from '../../repositories/agentAssetSaga/agentAssetSagaWire';

const mocks = vi.hoisted(() => ({
    registerAgentAssetHandle: vi.fn(),
    importAgentAsset: vi.fn(),
    stageAgentAssetExport: vi.fn(),
    finalizeAgentAssetExport: vi.fn(),
    cleanupAgentAssetSaga: vi.fn(),
    openViaNative: vi.fn(),
    isNativeProjectRuntimeAvailable: vi.fn(),
}));

vi.mock('../../repositories/agentAssetSaga/registerAgentAssetHandle', () => ({
    registerAgentAssetHandle: mocks.registerAgentAssetHandle,
}));
vi.mock('../../repositories/agentAssetSaga/importAgentAsset', () => ({
    importAgentAsset: mocks.importAgentAsset,
}));
vi.mock('../../repositories/agentAssetSaga/stageAgentAssetExport', () => ({
    stageAgentAssetExport: mocks.stageAgentAssetExport,
}));
vi.mock('../../repositories/agentAssetSaga/finalizeAgentAssetExport', () => ({
    finalizeAgentAssetExport: mocks.finalizeAgentAssetExport,
}));
vi.mock('../../repositories/agentAssetSaga/cleanupAgentAssetSaga', () => ({
    cleanupAgentAssetSaga: mocks.cleanupAgentAssetSaga,
}));
vi.mock('../../repositories/nativeFileDialog/openViaNative', () => ({
    openViaNative: mocks.openViaNative,
}));
vi.mock('../isNativeProjectRuntimeAvailable', () => ({
    isNativeProjectRuntimeAvailable: mocks.isNativeProjectRuntimeAvailable,
}));

const owner: AgentWorkOwner = {
    runId: 'run-1',
    workId: 'work-1',
    leaseId: 'lease-1',
    cancellationGeneration: 0,
};

const VALID_HANDLE_ID = 'asset-handle-8f2b1c44-0f3d-4a51-9d2e-6c4b5a7e1f30';
const VALID_SAGA_ID = 'asset-saga-8f2b1c44-0f3d-4a51-9d2e-6c4b5a7e1f30';

function receipt(overrides: Partial<AgentAssetSagaReceipt> = {}): AgentAssetSagaReceipt {
    return {
        sagaId: VALID_SAGA_ID,
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
    };
}

describe('the agent asset file boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isNativeProjectRuntimeAvailable.mockReturnValue(true);
    });

    it('T1 exposes exactly the five boundary members', () => {
        expect(Object.keys(agentAssetFileBoundary).sort()).toEqual(
            ['cleanup', 'finalizeExport', 'importAsset', 'pickAndRegister', 'stageExport'].sort()
        );
    });

    it('T2 refuses to pick when the native runtime is unavailable, without opening a dialog', async () => {
        mocks.isNativeProjectRuntimeAvailable.mockReturnValue(false);

        const result = await agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read' });

        expect(result).toEqual({ status: 'refused', reason: 'native-runtime-unavailable' });
        expect(mocks.openViaNative).not.toHaveBeenCalled();
        expect(mocks.registerAgentAssetHandle).not.toHaveBeenCalled();
    });

    it('T3 refuses with no-selection when the dialog is dismissed', async () => {
        mocks.openViaNative.mockResolvedValue(null);

        const result = await agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read' });

        expect(result).toEqual({ status: 'refused', reason: 'no-selection' });
        expect(mocks.registerAgentAssetHandle).not.toHaveBeenCalled();
    });

    it('T4 registers every selected path in order and never leaks a path into the result', async () => {
        const firstPath = '/samples/kick.wav';
        const secondPath = '/samples/snare.wav';
        mocks.openViaNative.mockResolvedValue([firstPath, secondPath]);
        const firstReceipt = receipt({ handleId: 'asset-handle-11111111-1111-4111-8111-111111111111' });
        const secondReceipt = receipt({ handleId: 'asset-handle-22222222-2222-4222-8222-222222222222' });
        mocks.registerAgentAssetHandle.mockResolvedValueOnce(firstReceipt).mockResolvedValueOnce(secondReceipt);

        const result = await agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read-write', multiple: true });

        expect(mocks.registerAgentAssetHandle.mock.calls).toEqual([
            [firstPath, 'read-write', owner],
            [secondPath, 'read-write', owner],
        ]);
        expect(result).toEqual({
            status: 'granted',
            handles: [
                { handleId: firstReceipt.handleId, receipt: firstReceipt },
                { handleId: secondReceipt.handleId, receipt: secondReceipt },
            ],
        });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(firstPath);
        expect(serialized).not.toContain(secondPath);
    });

    it.each(['/Users/x/a.wav', 'asset-handle-../etc', 'asset-handle-', '', 'C:\\x'])(
        'T5 refuses malformed handle id %s before calling the bridge',
        async (malformedHandleId) => {
            const result = await agentAssetFileBoundary.importAsset({ handleId: malformedHandleId, owner });

            expect(result).toEqual({ status: 'refused', reason: 'malformed-handle-id' });
            expect(mocks.importAgentAsset).not.toHaveBeenCalled();
        }
    );

    it('T6 imports a valid handle id, defaulting declared metadata to an empty object', async () => {
        const answered = receipt({ operation: 'import' });
        mocks.importAgentAsset.mockResolvedValue(answered);

        const result = await agentAssetFileBoundary.importAsset({ handleId: VALID_HANDLE_ID, owner });

        expect(mocks.importAgentAsset).toHaveBeenCalledWith(VALID_HANDLE_ID, owner, {});
        expect(result).toEqual({ status: 'receipt', receipt: answered });
        expect((result as { receipt: AgentAssetSagaReceipt }).receipt).toBe(answered);
    });

    it('T6 forwards declared metadata when supplied', async () => {
        const answered = receipt({ operation: 'import' });
        mocks.importAgentAsset.mockResolvedValue(answered);
        const declared = { sampleRate: 44_100 };

        await agentAssetFileBoundary.importAsset({ handleId: VALID_HANDLE_ID, owner, declared });

        expect(mocks.importAgentAsset).toHaveBeenCalledWith(VALID_HANDLE_ID, owner, declared);
    });

    it('T7 refuses a malformed destination handle id before calling the bridge', async () => {
        const result = await agentAssetFileBoundary.stageExport({
            destinationHandleId: '/Users/x/a.wav',
            owner,
            expectedSha256: 'a'.repeat(64),
            data: new Uint8Array([1]),
        });

        expect(result).toEqual({ status: 'refused', reason: 'malformed-handle-id' });
        expect(mocks.stageAgentAssetExport).not.toHaveBeenCalled();
    });

    it('T7 stages a valid export with the same Uint8Array instance, in argument order', async () => {
        const answered = receipt({ operation: 'stage-export', state: 'external-pending' });
        mocks.stageAgentAssetExport.mockResolvedValue(answered);
        const data = new Uint8Array([1, 2, 3]);
        const expectedSha256 = 'b'.repeat(64);

        const result = await agentAssetFileBoundary.stageExport({
            destinationHandleId: VALID_HANDLE_ID,
            owner,
            expectedSha256,
            data,
        });

        expect(mocks.stageAgentAssetExport).toHaveBeenCalledWith(VALID_HANDLE_ID, owner, expectedSha256, data);
        expect(mocks.stageAgentAssetExport.mock.calls[0]?.[3]).toBe(data);
        expect(result).toEqual({ status: 'receipt', receipt: answered });
    });

    it('T8 refuses a malformed saga id before calling the bridge', async () => {
        const result = await agentAssetFileBoundary.finalizeExport({
            sagaId: 'asset-saga-not-a-uuid',
            owner,
            authorization: { overwrite: true },
        });

        expect(result).toEqual({ status: 'refused', reason: 'malformed-saga-id' });
        expect(mocks.finalizeAgentAssetExport).not.toHaveBeenCalled();
    });

    it('T8 finalizes a valid saga id', async () => {
        const answered = receipt({ operation: 'finalize-export' });
        mocks.finalizeAgentAssetExport.mockResolvedValue(answered);
        const authorization = { overwrite: false };

        const result = await agentAssetFileBoundary.finalizeExport({ sagaId: VALID_SAGA_ID, owner, authorization });

        expect(mocks.finalizeAgentAssetExport).toHaveBeenCalledWith(VALID_SAGA_ID, owner, authorization);
        expect(result).toEqual({ status: 'receipt', receipt: answered });
    });

    it('T9 passes a null saga id through to cleanup', async () => {
        const answered = receipt({ operation: 'cleanup', sagaId: VALID_SAGA_ID });
        mocks.cleanupAgentAssetSaga.mockResolvedValue(answered);

        const result = await agentAssetFileBoundary.cleanup({ sagaId: null, owner });

        expect(mocks.cleanupAgentAssetSaga).toHaveBeenCalledWith(null, owner);
        expect(result).toEqual({ status: 'receipt', receipt: answered });
    });

    it('T9 refuses a malformed non-null saga id', async () => {
        const result = await agentAssetFileBoundary.cleanup({ sagaId: 'not-a-saga-id', owner });

        expect(result).toEqual({ status: 'refused', reason: 'malformed-saga-id' });
        expect(mocks.cleanupAgentAssetSaga).not.toHaveBeenCalled();
    });

    it('T9 passes a valid non-null saga id through to cleanup', async () => {
        const answered = receipt({ operation: 'cleanup' });
        mocks.cleanupAgentAssetSaga.mockResolvedValue(answered);

        const result = await agentAssetFileBoundary.cleanup({ sagaId: VALID_SAGA_ID, owner });

        expect(mocks.cleanupAgentAssetSaga).toHaveBeenCalledWith(VALID_SAGA_ID, owner);
        expect(result).toEqual({ status: 'receipt', receipt: answered });
    });

    it('T10 carries no path field on any member input', () => {
        expectTypeOf<Parameters<typeof agentAssetFileBoundary.pickAndRegister>[0]>().not.toHaveProperty('path');
        expectTypeOf<Parameters<typeof agentAssetFileBoundary.importAsset>[0]>().not.toHaveProperty('path');
        expectTypeOf<Parameters<typeof agentAssetFileBoundary.stageExport>[0]>().not.toHaveProperty('path');
        expectTypeOf<Parameters<typeof agentAssetFileBoundary.finalizeExport>[0]>().not.toHaveProperty('path');
        expectTypeOf<Parameters<typeof agentAssetFileBoundary.cleanup>[0]>().not.toHaveProperty('path');
    });
});
