import { type SoundPreset } from '../../../models/SoundPreset';

import { readStoredPresets } from './helpers';

export function getUserPresets(): SoundPreset[] {
    return readStoredPresets();
}
