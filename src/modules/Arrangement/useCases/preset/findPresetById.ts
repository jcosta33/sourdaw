import { type SoundPreset } from '../../models/SoundPreset';
import { getFactoryPresets } from '../soundPresetLibrary';

import { getUserPresets } from './presetStorage/getUserPresets';

/** Resolves one catalog identity only when no factory/user collision can change its authority. */
export function findPresetById(presetId: string): SoundPreset | null {
    const matches = [...getFactoryPresets(), ...getUserPresets()].filter((preset) => preset.id === presetId);
    return matches.length === 1 ? (matches[0] ?? null) : null;
}
