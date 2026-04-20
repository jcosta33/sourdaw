import { undoTreeStore } from '../../../stores/undoTree';

export function isUndoTreeEnabled(): boolean {
    return undoTreeStore.value?.enabled ?? false;
}
