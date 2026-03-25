import { preferencesStore } from '../stores/preferencesStore';
import { type Preferences } from '../models/Preferences';

export function setTrackHeight(height: Preferences['trackHeight']): void {
    const prefs = preferencesStore.value;
    if (!prefs) {
        return;
    }
    preferencesStore.set({ ...prefs, trackHeight: height });
}
