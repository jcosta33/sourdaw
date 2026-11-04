import { createEventBus } from '#/infra/events/createEventBus';

import { type SoloModePreferenceAppliedPayload } from '../../events/PreferencesEvents';

type PreferencesEvents = {
    'preferences.soloModeApplied': SoloModePreferenceAppliedPayload;
};

export const soloModePreferenceEvents = createEventBus<PreferencesEvents>();
