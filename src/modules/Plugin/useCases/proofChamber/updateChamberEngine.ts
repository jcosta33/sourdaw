import { chamberStore } from '../../stores/chamberStore';
import type { ProofChamberEngineState } from '../../models/ProofChamberState';

/**
 * Updates the engine parameters for a specific ProofChamber instance.
 */
export function updateChamberEngine(
    id: string,
    updater: (engine: ProofChamberEngineState) => ProofChamberEngineState
): void {
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
                engineState: updater(instance.engineState),
            },
        },
    });
}
