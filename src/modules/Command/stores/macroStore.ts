import { createStore } from '#/infra/store/createStore';

import { type Macro } from '../models/Macro';
import { type AppAction } from '../useCases/commandQueries';

const STORAGE_KEY = 'sourdaw:macros';

export type MacroStoreState = {
    macros: Macro[];
    recording: boolean;
    currentRecording: AppAction[];
};

function loadPersistedMacros(): Macro[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored) as Macro[];
        }
    } catch {
        // Fallback to empty
    }
    return [];
};

export const macroStore = createStore<MacroStoreState>({
    initialData: { macros: loadPersistedMacros(), recording: false, currentRecording: [] },
});

macroStore.subscribe(() => {
    const state = macroStore.value;
    if (state) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.macros));
        } catch {
            // Storage full — silently degrade
        }
    }
});
