import { createStore } from '#/infra/store/createStore';
import {
    type ProofChamberPluginState,
} from '../models/ProofChamberState';

export type ChamberStoreState = {
    activeInstanceId: string | null;
    instances: Record<string, ProofChamberPluginState>;
};

/**
 * State container for all ProofChamber device instances.
 */
export const chamberStore = createStore<ChamberStoreState>({
    initialData: {
        activeInstanceId: null,
        instances: {},
    },
});
