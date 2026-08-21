import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { ddspModelStorage } from '../ddspModelStorage';

const instrument = DDSP_INSTRUMENT_CATALOG[0]!;
const storage = {
    id: instrument.id,
    version: instrument.artifactVersion!,
    artifacts: instrument.artifacts!,
};

function modelDataPort(): MessagePort {
    const channel = new MessageChannel();
    channel.port2.postMessage({ type: 'model-data', modelData: new ArrayBuffer(1) });
    channel.port2.close();
    return channel.port1;
}

function storageBridge() {
    return {
        readModel: vi.fn(),
        verifyModel: vi.fn(),
        deleteModel: vi.fn(),
    };
}

describe('ddspModelStorage readiness', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('is not ready when the versioned ready marker is absent', async () => {
        const bridge = storageBridge();
        bridge.readModel.mockResolvedValue(null);
        const sha256ArrayBuffer = vi.fn().mockResolvedValue('marker-sha');
        const logger = { warn: vi.fn() };
        injectDependencies(ddspModelStorage.checkDdspInstrumentReady, {
            logger,
            modelStorageWorkerBridge: bridge,
            sha256ArrayBuffer,
        });

        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
        expect(bridge.readModel).toHaveBeenCalledWith({
            family: 'ddsp',
            modelId: `${instrument.id}/${instrument.artifactVersion}/.ready.json`,
            expectedSizeBytes: expect.any(Number),
            expectedSha256: 'marker-sha',
        });
        expect(bridge.verifyModel).not.toHaveBeenCalled();
    });

    it('ignores an old ready marker rather than treating it as the requested version', async () => {
        const bridge = storageBridge();
        bridge.readModel.mockResolvedValue(null);
        const requested = { ...storage, version: 'next-checkpoint-version' };
        injectDependencies(ddspModelStorage.checkDdspInstrumentReady, {
            logger: { warn: vi.fn() },
            modelStorageWorkerBridge: bridge,
            sha256ArrayBuffer: vi.fn().mockResolvedValue('marker-sha'),
        });

        await expect(ddspModelStorage.checkDdspInstrumentReady(requested)).resolves.toBe(false);
        expect(bridge.readModel).toHaveBeenCalledWith(
            expect.objectContaining({ modelId: `${instrument.id}/next-checkpoint-version/.ready.json` })
        );
        expect(bridge.readModel).not.toHaveBeenCalledWith(
            expect.objectContaining({ modelId: `${instrument.id}/${instrument.artifactVersion}/.ready.json` })
        );
    });

    it('uses disjoint artifact and marker keys for distinct admitted versions', async () => {
        const bridge = storageBridge();
        bridge.readModel.mockResolvedValue(null);
        const next = { ...storage, version: 'next-checkpoint-version' };
        injectDependencies(ddspModelStorage.checkDdspInstrumentReady, {
            logger: { warn: vi.fn() },
            modelStorageWorkerBridge: bridge,
            sha256ArrayBuffer: vi.fn().mockResolvedValue('marker-sha'),
        });
        await ddspModelStorage.checkDdspInstrumentReady(storage);
        await ddspModelStorage.checkDdspInstrumentReady(next);
        expect(bridge.readModel.mock.calls.map(([input]) => input.modelId)).toEqual([
            `${instrument.id}/${storage.version}/.ready.json`,
            `${instrument.id}/${next.version}/.ready.json`,
        ]);
    });

    it('is not ready when a ready marker exists but an admitted artifact is missing', async () => {
        const bridge = storageBridge();
        bridge.readModel.mockResolvedValue(modelDataPort());
        bridge.verifyModel.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        injectDependencies(ddspModelStorage.checkDdspInstrumentReady, {
            logger: { warn: vi.fn() },
            modelStorageWorkerBridge: bridge,
            sha256ArrayBuffer: vi.fn().mockResolvedValue('marker-sha'),
        });

        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
        expect(bridge.verifyModel).toHaveBeenCalledTimes(storage.artifacts.length);
    });

    it.each(['size', 'hash'] as const)(
        'is not ready when worker verification rejects a corrupt artifact %s',
        async () => {
            const bridge = storageBridge();
            bridge.readModel.mockResolvedValue(modelDataPort());
            bridge.verifyModel.mockResolvedValue(false);
            injectDependencies(ddspModelStorage.checkDdspInstrumentReady, {
                logger: { warn: vi.fn() },
                modelStorageWorkerBridge: bridge,
                sha256ArrayBuffer: vi.fn().mockResolvedValue('marker-sha'),
            });

            await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
            expect(bridge.verifyModel).toHaveBeenCalledWith({
                family: 'ddsp',
                modelId: `${instrument.id}/${storage.version}/${storage.artifacts[0]!.path}`,
                expectedSizeBytes: storage.artifacts[0]!.sizeBytes,
                expectedSha256: storage.artifacts[0]!.sha256,
            });
        }
    );

    it('accepts only the exact marker and every exact admitted artifact verification', async () => {
        const bridge = storageBridge();
        bridge.readModel.mockResolvedValue(modelDataPort());
        bridge.verifyModel.mockResolvedValue(true);
        const sha256ArrayBuffer = vi.fn(async (bytes: ArrayBuffer) => {
            expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
                version: storage.version,
                artifacts: storage.artifacts.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })),
            });
            return 'marker-sha';
        });
        injectDependencies(ddspModelStorage.checkDdspInstrumentReady, {
            logger: { warn: vi.fn() },
            modelStorageWorkerBridge: bridge,
            sha256ArrayBuffer,
        });

        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(true);
        expect(bridge.verifyModel.mock.calls.map(([input]) => input)).toEqual(
            storage.artifacts.map((artifact) => ({
                family: 'ddsp',
                modelId: `${instrument.id}/${storage.version}/${artifact.path}`,
                expectedSizeBytes: artifact.sizeBytes,
                expectedSha256: artifact.sha256,
            }))
        );
    });
});

describe('ddspModelStorage deletion', () => {
    it('propagates a user-requested deletion failure', async () => {
        const bridge = storageBridge();
        bridge.deleteModel.mockRejectedValue(new Error('OPFS denied'));
        injectDependencies(ddspModelStorage.deleteDdspInstrumentArtifacts, { modelStorageWorkerBridge: bridge });

        await expect(ddspModelStorage.deleteDdspInstrumentArtifacts(storage)).rejects.toThrow('OPFS denied');
    });

    it('suppresses a best-effort failed-download cleanup deletion failure', async () => {
        const bridge = storageBridge();
        bridge.deleteModel.mockRejectedValue(new Error('OPFS denied'));
        injectDependencies(ddspModelStorage.deleteDdspInstrumentArtifacts, { modelStorageWorkerBridge: bridge });

        await expect(ddspModelStorage.cleanupDdspInstrumentArtifacts(storage)).resolves.toBeUndefined();
    });
});
