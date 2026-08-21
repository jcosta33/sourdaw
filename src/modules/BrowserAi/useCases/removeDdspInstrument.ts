import { inject } from '#/infra/di/inject';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { removeDdspInstrumentGenerations } from '../repositories/removeDdspInstrumentGenerations';
import { withDdspInstrumentLock } from '../repositories/withDdspInstrumentLock';
import { setStorageUsed, updateModelStatus } from '../stores/modelRegistryStore';

/** Removes every tracked generation. A failed cleanup still makes ready state false. */
export const removeDdspInstrument = inject({
    getStorageStatus,
    removeDdspInstrumentGenerations,
    withDdspInstrumentLock,
})(
    ({ getStorageStatus, removeDdspInstrumentGenerations, withDdspInstrumentLock }) =>
        async function removeDdspInstrument(instrumentId: DdspInstrumentId): Promise<void> {
            const instrument = resolveDdspInstrument(instrumentId);
            await withDdspInstrumentLock(instrument.id, 'exclusive', async () => {
                try {
                    await removeDdspInstrumentGenerations({ id: instrument.id });
                } finally {
                    updateModelStatus(instrument.id, { status: 'not-downloaded', downloadProgress: 0 });
                    const status = await getStorageStatus();
                    setStorageUsed(status.usedBytes);
                }
            });
        }
);
