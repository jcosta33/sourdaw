import { type SoundPreset } from '../../../models/SoundPreset';

import { readStoredPresets } from './readStoredPresets';

export function getUserPresets(): SoundPreset[] {
    return readStoredPresets();
}
