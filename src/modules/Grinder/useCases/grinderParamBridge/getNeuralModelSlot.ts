import { GRINDER_NEURAL_LIBRARY } from '../../models/GrinderPatch';

export function getNeuralModelSlot(neural_model_id: string): number | null {
    const slot = GRINDER_NEURAL_LIBRARY.findIndex((model) => model.id === neural_model_id);
    return slot >= 0 ? slot : null;
}
