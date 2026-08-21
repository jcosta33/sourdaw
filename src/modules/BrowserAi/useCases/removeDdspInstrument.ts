import { inject } from '#/infra/di/inject';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { ddspModelStorage } from '../repositories/ddspModelStorage';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { setStorageUsed, updateModelStatus } from '../stores/modelRegistryStore';

export const removeDdspInstrument = inject({ ddspModelStorage, getStorageStatus })(
    ({ ddspModelStorage, getStorageStatus }) =>
        async function removeDdspInstrument(instrumentId: DdspInstrumentId): Promise<void> {
            const instrument = resolveDdspInstrument(instrumentId);
            await ddspModelStorage.deleteDdspInstrumentArtifacts({
                id: instrument.id,
                version: instrument.artifactVersion,
                artifacts: instrument.artifacts,
            });
            updateModelStatus(instrument.id, { status: 'not-downloaded', downloadProgress: 0 });
            const status = await getStorageStatus();
            setStorageUsed(status.usedBytes);
        }
);
