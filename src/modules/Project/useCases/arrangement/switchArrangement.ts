import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { arrangementStore } from '../../stores/arrangementStore';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

import { loadSnapshot } from './loadSnapshot';
import { syncCurrentArrangementToStore } from './syncCurrentArrangementToStore';

export function switchArrangement(id: string): void {
    const state = arrangementStore.value;
    if (!state || state.activeArrangementId === id) {
        return;
    }

    const target = state.arrangements.find((alpha) => alpha.id === id);
    if (!target) {
        return;
    }

    stopPlayback(); // Stop playback to avoid glitches

    // Save current
    syncCurrentArrangementToStore();

    // Load target
    loadSnapshot(target);

    // Clear undo history because IDs might have been reused or destroyed
    clearUndoHistory();

    arrangementStore.set({
        ...arrangementStore.value!,
        activeArrangementId: id,
    });

    markDirty();
}
