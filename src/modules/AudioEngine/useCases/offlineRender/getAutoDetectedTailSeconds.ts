import { trackStore } from '#/modules/Arrangement/stores';

import { estimateRenderTailSeconds } from '../../services/estimateRenderTailSeconds';

/**
 * Read the current project tracks and return the longest reverb/delay tail
 * in seconds. Used by the export dialog's "auto-detect tail" checkbox.
 */
export function getAutoDetectedTailSeconds(): number {
    const tracks = trackStore.value?.tracks ?? [];
    return estimateRenderTailSeconds(
        tracks.map((track) => ({
            devices: track.devices.map((device) => ({
                type: device.type,
                parameterValues: device.parameterValues,
                bypassed: device.bypassed,
            })),
        }))
    );
}
