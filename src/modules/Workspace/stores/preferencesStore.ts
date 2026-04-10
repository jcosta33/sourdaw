import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';
import { defaultPreferences, type Preferences } from '../useCases/workspaceQueries';

const storage = createLocalStorage<Preferences>('sourdaw-preferences');

// Merge stored data with defaults so new preference keys are always present
function mergeWithDefaults(): Preferences {
    const stored = storage.get();
    if (stored) {
        return { ...defaultPreferences, ...stored };
    }
    return defaultPreferences;
}

export const preferencesStore = createStore<Preferences>({
    storage,
    initialData: mergeWithDefaults(),
});
