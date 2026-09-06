import { versionControlStore } from '../../stores/versionControlStore';

import { createProjectVersion } from './createProjectVersion';

export function autoSaveVersion(): boolean {
    const state = versionControlStore.value;
    if (!state || state.autoSaveInterval <= 0) {
        return false;
    }

    return createProjectVersion(`Auto-save ${new Date().toLocaleTimeString()}`, 'Automatic checkpoint', ['auto-save']);
}
