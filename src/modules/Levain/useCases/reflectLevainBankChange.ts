import { type Track } from '#/modules/Arrangement/stores';
import { mirrorDeviceChainDelta, projectsToDifferentNativeBank } from '#/modules/AudioEngine/useCases';
import { logger } from '#/infra/logger/appLogger';

import { hydrateLevainStateFromDevice } from './hydrateLevainStateFromDevice';
import { projectLevainPresetParameters } from './projectLevainPresetParameters';

/** Replace only the addressed native instrument, using the same effective values as its worklet. */
export function reflectLevainBankChange(before: Track, current: Track, deviceId: string): void {
    const previous = before.devices.find(({ id }) => id === deviceId);
    const device = current.devices.find(({ id }) => id === deviceId);
    if (!previous || device?.type !== 'levain' || !projectsToDifferentNativeBank(previous, device)) {
        return;
    }
    const { patch } = hydrateLevainStateFromDevice(device);
    const replacement = {
        ...device,
        parameterValues: { ...device.parameterValues, ...projectLevainPresetParameters(patch) },
    };
    const after = {
        ...before,
        devices: before.devices.map((entry) => (entry.id === deviceId ? replacement : entry)),
    };
    void mirrorDeviceChainDelta({ before, after }).catch((error: unknown) => {
        logger.warn(`[Levain] the native bank change for track ${before.id} failed: ${String(error)}`);
    });
}
