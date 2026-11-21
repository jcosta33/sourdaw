import { getActiveModelId } from '../../repositories/webLlm/getActiveModelId';
import { isWebLlmLoaded } from '../../repositories/webLlm/isWebLlmLoaded';
import { machineMemoryStore } from '../../stores/machineMemoryStore';

import { chooseLocalModel } from './chooseLocalModel';
import { listOfferedLocalModels } from './listOfferedLocalModels';

/**
 * The local model a route that loads one on demand may use, by the picker's own rule: the loaded model
 * when one is loaded, else the offered model the picker would show selected. Null when this machine is
 * offered none, so a route never loads a model the picker hides. A missing reading is an unread one.
 */
export function resolveLocalModelToAutoLoad(): string | null {
    if (isWebLlmLoaded()) {
        return getActiveModelId();
    }
    const offered = listOfferedLocalModels(machineMemoryStore.value ?? { state: 'unread' });
    return chooseLocalModel(offered, getActiveModelId())?.id ?? null;
}
