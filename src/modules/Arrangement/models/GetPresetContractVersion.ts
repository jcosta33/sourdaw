import { getStableContractFingerprint } from './GetStableContractFingerprint';
import { type SoundPreset } from './SoundPreset';

/**
 * The version string one preset publishes. It fingerprints the whole preset, so a change to its
 * tags, chain or any parameter value is a change to the version every consumer reads.
 */
export function getPresetContractVersion(preset: SoundPreset): string {
    return `preset-v1:${getStableContractFingerprint(preset)}`;
}
