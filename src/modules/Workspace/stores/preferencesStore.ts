import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';
import { defaultPreferences, type Preferences } from '../models/Preferences';

const logger = Container.getInstance().get(Logger);

const storage = new LocalStorageStorage<Preferences>('webdaw-preferences');

// Merge stored data with defaults so new preference keys are always present
function mergeWithDefaults(): Preferences {
    const stored = storage.get();
    if (stored) {
        return { ...defaultPreferences, ...stored };
    }
    return defaultPreferences;
}

export const preferencesStore = new Store<Preferences>(logger, {
    storage,
    initialData: mergeWithDefaults(),
});
