import { createStore } from '#/infra/store/createStore';

import { type SoloMode } from '../services/applySoloLogic';

// How a solo is heard: solo-in-place, after-fader listen or pre-fader listen.
// Solo semantics live in this module (`services/applySoloLogic`), so the mode
// they read lives beside them. Runtime-only and memory-backed: the persisted
// choice is the Preferences `soloMode`, which `syncSoloModePreference` mirrors here.

export type SoloModeState = {
    soloMode: SoloMode;
};

export const defaultSoloModeState: SoloModeState = {
    soloMode: 'sip',
};

export const soloModeStore = createStore<SoloModeState>({
    initialData: defaultSoloModeState,
});
