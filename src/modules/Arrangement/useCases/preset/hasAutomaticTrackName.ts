import { isDefaultTrackName } from '../../models/DefaultTrackName';
import { type Track } from '../../stores/trackStore';
import { getFactoryPresets } from '../soundPresetLibrary';

import { getUserPresets } from './presetStorage/getUserPresets';

/**
 * A track name is automatic until the user chooses one: either a default the
 * app assigned ("MIDI", "Audio 3"; `models/DefaultTrackName.ts`) or the name of
 * a catalog preset for this track kind, which a preset load or a preset-created
 * track assigns. DAWs let such a name follow the loaded preset; a user rename
 * always wins.
 */
export function hasAutomaticTrackName(track: Pick<Track, 'name' | 'kind'>): boolean {
    const { name } = track;
    return (
        isDefaultTrackName(name) ||
        [...getFactoryPresets(), ...getUserPresets()].some(
            (preset) => preset.trackKind === track.kind && preset.name === name
        )
    );
}
