import { inject } from '#/infra/di/inject';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { ddspModelStorage } from '../repositories/ddspModelStorage';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { withDdspInstrumentLock } from '../repositories/withDdspInstrumentLock';
import { setStorageUsed, updateModelStatus } from '../stores/modelRegistryStore';

export const removeDdspInstrument = inject({
    ddspModelStorage,
    getStorageStatus,
    inferenceWorkerBridge,
    withDdspInstrumentLock,
})(
    ({ ddspModelStorage, getStorageStatus, inferenceWorkerBridge, withDdspInstrumentLock }) =>
        async function removeDdspInstrument(instrumentId: DdspInstrumentId): Promise<void> {
            const instrument = resolveDdspInstrument(instrumentId);
            await withDdspInstrumentLock(instrument.id, 'exclusive', async () => {
                await inferenceWorkerBridge.releaseDdspSession(`${instrument.id}:${instrument.artifactVersion}`);
                try {
                    await ddspModelStorage.removeDdspInstrumentGenerations({ id: instrument.id });
                } finally {
                    updateModelStatus(instrument.id, { status: 'not-downloaded', downloadProgress: 0 });
                    const status = await getStorageStatus();
                    setStorageUsed(status.usedBytes);
                }
            });
        }
);
