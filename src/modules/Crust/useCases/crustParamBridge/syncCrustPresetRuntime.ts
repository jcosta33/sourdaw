import { DEFAULT_CRUST_PATCH, type CrustPatch } from '../../models/CrustPatch';
import { CRUST_PRESET_PARAMETER_ORDER } from '../../models/CrustPresetParameterOrder';
import { crustPresetPreviewAuthority } from '../createCrustParameterGesture';

import { algorithmFromStyle } from './algorithmFromStyle';
import { crustBridgeDeps, decodeCrustStyle, encodeCrustValue, paramBatcher } from './helpers';
import { hydrateCrustPatchFromProject } from './hydrateCrustPatchFromProject';

export function syncCrustPresetRuntime(
    trackId: string,
    deviceId: string,
    parameters: Readonly<Record<string, number | null>>,
    metadata: Pick<CrustPatch, 'name' | 'streamingPreset'>,
    isCurrent: () => boolean
): void {
    if (!isCurrent()) {
        return;
    }
    for (const key of CRUST_PRESET_PARAMETER_ORDER) {
        paramBatcher.cancel(`${deviceId}:${key}`);
    }
    crustPresetPreviewAuthority.discard(deviceId);
    hydrateCrustPatchFromProject(deviceId, undefined, metadata);

    if (!isCurrent()) {
        return;
    }
    const style = decodeCrustStyle(parameters.style) ?? DEFAULT_CRUST_PATCH.style;
    const algorithm = algorithmFromStyle(style) ?? DEFAULT_CRUST_PATCH.algorithm;
    for (const key of CRUST_PRESET_PARAMETER_ORDER) {
        const defaultValue = key === 'algorithm' ? algorithm : DEFAULT_CRUST_PATCH[key];
        const value = parameters[key] ?? encodeCrustValue(key, defaultValue);
        if (typeof value !== 'number') {
            throw new Error(`Crust has no encoded default for ${key}`);
        }
        crustBridgeDeps.updateDeviceParam(trackId, deviceId, key, value);
    }
}
