import { arrangementStore } from '../../stores/arrangementStore';

import { takeSnapshot } from './takeSnapshot';

export function syncCurrentArrangementToStore(): void {
    const state = arrangementStore.value;
    if (!state) {
        return;
    }

    const currentArrangement = state.arrangements.find((alpha) => alpha.id === state.activeArrangementId);
    if (!currentArrangement) {
        return;
    }

    const snapshot = takeSnapshot(state.activeArrangementId, currentArrangement.name);

    arrangementStore.set({
        ...state,
        arrangements: state.arrangements.map((alpha) => (alpha.id === state.activeArrangementId ? snapshot : alpha)),
    });
}
