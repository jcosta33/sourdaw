import { type SoloModePreferenceAppliedPayload } from '../events/PreferencesEvents';

import { soloModePreferenceEvents } from './helpers/soloModePreferenceEvents';

export function onSoloModePreferenceApplied(
    handler: (payload: SoloModePreferenceAppliedPayload) => void | Promise<void>
): () => void {
    return soloModePreferenceEvents.on('preferences.soloModeApplied', handler);
}
