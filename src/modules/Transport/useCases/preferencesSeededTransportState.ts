import { preferencesStore } from '#/modules/Preferences/stores';

import { type TransportState, defaultTransportState } from '../models/TransportState';

/**
 * The transport state a NEW project starts from, with the Recording
 * preferences (Preferences → General → Recording) seeded into the count-in
 * and pre-roll fields.
 *
 * The preference is the default the transport adopts at new-project time
 * only — never a global override and never re-applied on project switch:
 * loaded projects keep their own saved transport values because the hydrate
 * path (`restoreTransportSnapshot`) does not go through this function.
 */
export function preferencesSeededTransportState(): TransportState {
    const prefs = preferencesStore.value;
    if (!prefs) {
        return defaultTransportState;
    }
    return {
        ...defaultTransportState,
        countInEnabled: prefs.recordCountIn > 0,
        countInBars: prefs.recordCountIn > 0 ? prefs.recordCountIn : defaultTransportState.countInBars,
        preRollEnabled: prefs.preRollEnabled,
        preRollBars: prefs.preRollBars,
    };
}
