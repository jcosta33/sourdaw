import { trackStore } from '#/modules/Arrangement/stores';

import { estimateRenderTailSeconds, type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';

type DeviceTailLookup = (deviceType: string) => TailDeclarationLike | undefined;

type GetAutoDetectedTailSecondsInput = {
    /**
     * Resolves a device type to its declared tail. Injected rather than looked
     * up here: the descriptors live in Arrangement's models, and AudioEngine
     * importing Arrangement's use-case barrel closes a module cycle (Arrangement's
     * freeze/bounce use cases already import AudioEngine). The caller, which sits
     * downstream of both, supplies the lookup.
     */
    tailForDeviceType: DeviceTailLookup;
};

/**
 * Read the current project tracks and return the longest device tail in
 * seconds. Used by the export dialog's "auto-detect tail" checkbox.
 *
 * This is the seam that carries each device's declared tail from its
 * descriptor into the pure estimator.
 */
export function getAutoDetectedTailSeconds({ tailForDeviceType }: GetAutoDetectedTailSecondsInput): number {
    const tracks = trackStore.value?.tracks ?? [];
    return estimateRenderTailSeconds(
        tracks.map((track) => ({
            devices: track.devices.map((device) => ({
                type: device.type,
                parameterValues: device.parameterValues,
                bypassed: device.bypassed,
                tail: tailForDeviceType(device.type),
            })),
        }))
    );
}
