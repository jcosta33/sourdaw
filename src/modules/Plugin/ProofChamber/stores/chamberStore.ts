import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type ProofChamberPluginState, type ProofChamberEngineState, createDefaultChamberState } from '../models/ProofChamberState';

const logger = Container.getInstance().get(Logger);

export interface ChamberStoreState {
    activeInstanceId: string | null;
    instances: Record<string, ProofChamberPluginState>;
}

export const chamberStore = new Store<ChamberStoreState>(logger, {
    initialData: {
        activeInstanceId: null,
        instances: {},
    },
});

export function registerChamberInstance(id: string): void {
    const state = chamberStore.value;
    if (!state) return;
    
    if (!state.instances[id]) {
        chamberStore.set({
            ...state,
            activeInstanceId: id,
            instances: {
                ...state.instances,
                [id]: createDefaultChamberState(id),
            }
        });
    } else {
        chamberStore.set({ ...state, activeInstanceId: id });
    }
}

export function updateChamberEngine(id: string, updater: (engine: ProofChamberEngineState) => ProofChamberEngineState): void {
    const state = chamberStore.value;
    if (!state || !state.instances[id]) return;
    
    const instance = state.instances[id]!;
    
    chamberStore.set({
        ...state,
        instances: {
            ...state.instances,
            [id]: {
                ...instance,
                engineState: updater(instance.engineState),
            }
        }
    });

    // TODO: Emit event / trigger IPC to update the Rust/WASM DSP engine parameters
}

export function setChamberUILevel(id: string, level: 1 | 2 | 3 | 4 | 5): void {
    const state = chamberStore.value;
    if (!state || !state.instances[id]) return;
    
    const instance = state.instances[id]!;
    chamberStore.set({
        ...state,
        instances: {
            ...state.instances,
            [id]: {
                ...instance,
                uiLevel: level,
            }
        }
    });
}
