import { autoSaveHandle } from './autoSaveHandle';

export function stopActiveAutoSave(): void {
    if (autoSaveHandle.stopAutoSave) {
        autoSaveHandle.stopAutoSave();
        autoSaveHandle.stopAutoSave = null;
    }
}
