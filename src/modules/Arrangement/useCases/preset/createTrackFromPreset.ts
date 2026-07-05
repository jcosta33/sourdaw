import { type SoundPreset } from '../../models/SoundPreset';
import { addTrack } from '../addTrack';

import { loadPresetToTrack } from './presetLoading';

export function createTrackFromPreset(preset: SoundPreset): string | null {
    const track = addTrack({ name: preset.name, kind: preset.trackKind });
    if (!track) {
        return null;
    }

    loadPresetToTrack(track.id, preset);
    return track.id;
}
