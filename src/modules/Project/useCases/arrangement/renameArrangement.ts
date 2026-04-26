import { arrangementStore } from '../../stores/arrangementStore';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

export function renameArrangement(id: string, name: string): void {
    const state = arrangementStore.value;
    if (!state) {
        return;
    }

    arrangementStore.set({
        ...state,
        arrangements: state.arrangements.map((alpha) => (alpha.id === id ? { ...alpha, name } : alpha)),
    });
    markDirty();
}
