import { type Preferences } from '../models/Preferences';
import { preferencesStore } from '../stores/preferencesStore';

export function setTrackHeight(height: Preferences['trackHeight']): void {
    const prefs = preferencesStore.value;
    if (!prefs) {
        return;
    }
    preferencesStore.trySet({ ...prefs, trackHeight: height });
}
