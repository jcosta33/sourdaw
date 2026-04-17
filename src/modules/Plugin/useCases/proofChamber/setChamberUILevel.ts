import { chamberStore } from '../../stores/chamberStore';

/**
 * Updates the UI disclosure level for a specific ProofChamber instance.
 */
export function setChamberUILevel(id: string, level: 1 | 2 | 3 | 4 | 5): void {
    const state = chamberStore.value;
    if (!state || !state.instances[id]) {
        return;
    }

    const instance = state.instances[id]!;
    chamberStore.set({
        ...state,
        instances: {
            ...state.instances,
            [id]: {
                ...instance,
                uiLevel: level,
            },
        },
    });
}
