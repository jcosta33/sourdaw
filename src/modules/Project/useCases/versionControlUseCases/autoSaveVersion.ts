import { versionControlStore } from '../../stores/versionControlStore';
import { createProjectVersion } from './createProjectVersion';

export function autoSaveVersion(): void {
    const state = versionControlStore.value;
    if (!state || state.autoSaveInterval <= 0) {
        return;
    }

    createProjectVersion(`Auto-save ${new Date().toLocaleTimeString()}`, 'Automatic checkpoint', ['auto-save']);
}
