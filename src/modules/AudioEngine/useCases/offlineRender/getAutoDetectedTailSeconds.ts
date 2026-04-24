import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { estimateRenderTailSeconds } from '../../services/estimateRenderTailSeconds';

/**
 * Read the current project tracks and return the longest reverb/delay tail
 * in seconds. Used by the export dialog's "auto-detect tail" checkbox.
 */
export function getAutoDetectedTailSeconds(): number {
    const tracks = getTrackStoreState()?.tracks ?? [];
    return estimateRenderTailSeconds(
        tracks.map((t) => ({
            devices: t.devices.map((d) => ({
                type: d.type,
                parameterValues: d.parameterValues,
                bypassed: d.bypassed,
            })),
        }))
    );
}
