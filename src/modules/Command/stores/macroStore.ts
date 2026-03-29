import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type Macro } from '../models/Macro';
import { type AppAction } from '../models/AppAction';

const STORAGE_KEY = 'sourdaw:macros';

const logger = Container.getInstance().get(Logger);

export type MacroStoreState = {
    macros: Macro[];
    recording: boolean;
    currentRecording: AppAction[];
};

const loadPersistedMacros = (): Macro[] => {
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

export const macroStore = new Store<MacroStoreState>(logger, {
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
