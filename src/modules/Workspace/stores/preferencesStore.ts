import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import { defaultPreferences, type Preferences } from "../models/Preferences";

const logger = Container.getInstance().get(Logger);

const PREFS_KEY = "webdaw-preferences";

const loadFromStorage = (): Preferences => {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) return { ...defaultPreferences, ...JSON.parse(raw) };
    } catch {
        // ignore
    }
    return defaultPreferences;
};

export const preferencesStore = new Store<Preferences>(logger, {
    initialData: loadFromStorage(),
});

preferencesStore.subscribe((value) => {
    if (value) {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(value));
        } catch {
            // ignore
        }
    }
});
