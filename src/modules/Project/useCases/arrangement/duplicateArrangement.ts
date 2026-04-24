import { clearUndoHistory } from '#/modules/Command/stores';

import { arrangementStore } from '../../stores/arrangementStore';
import { type ArrangementSnapshot } from '../../stores/arrangementStore';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

import { loadSnapshot, syncCurrentArrangementToStore } from './helpers';

export function duplicateArrangement(id: string, newName?: string): void {
    const state = arrangementStore.value;
    if (!state) {
        return;
    }

    syncCurrentArrangementToStore(); // Ensure latest state is snapshotted

    const sourceArrangement = arrangementStore.value!.arrangements.find((a) => a.id === id);
    if (!sourceArrangement) {
        return;
    }

    // Deep clone to avoid mutating shared object references
    const clone = JSON.parse(JSON.stringify(sourceArrangement)) as ArrangementSnapshot;
    clone.id = `arr-${crypto.randomUUID().slice(0, 8)}`;
    clone.name = newName || `${sourceArrangement.name} (Copy)`;

    arrangementStore.set({
        arrangements: [...state.arrangements, clone],
        activeArrangementId: clone.id,
    });

    loadSnapshot(clone);
    clearUndoHistory();
    markDirty();
}
