import { chamberStore } from '../../stores/chamberStore';
import { createDefaultChamberState } from '../../models/ProofChamberState';

/**
 * Ensures a ProofChamber device instance is tracked in the store and sets it as active.
 */
export function registerChamberInstance(id: string): void {
    const state = chamberStore.value;
    if (!state) {
        return;
    }

    if (!state.instances[id]) {
        chamberStore.set({
            ...state,
            activeInstanceId: id,
            instances: {
                ...state.instances,
                [id]: createDefaultChamberState(id),
            },
        });
    } else {
        chamberStore.set({ ...state, activeInstanceId: id });
    }
}
