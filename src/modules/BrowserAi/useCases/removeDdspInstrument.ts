import { inject } from '#/infra/di/inject';

import { type DdspInstrument } from '../models/BrowserModel';
import { ddspModelStorage } from '../repositories/ddspModelStorage';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { setStorageUsed, updateModelStatus } from '../stores/modelRegistryStore';

type AdmittedDdspInstrument = Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
    artifactVersion: string;
    artifacts: NonNullable<DdspInstrument['artifacts']>;
};

export const removeDdspInstrument = inject({ ddspModelStorage, getStorageStatus })(
    ({ ddspModelStorage, getStorageStatus }) =>
        async function removeDdspInstrument(instrument: AdmittedDdspInstrument): Promise<void> {
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
