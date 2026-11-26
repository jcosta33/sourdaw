import { readLiveOfflineRenderProjectModels, readLiveOfflineRenderSessionModels } from '#/modules/AudioEngine/useCases';

import { type FreezePrintInput, selectFreezePrintInput } from './selectFreezePrintInput';

/** The input a freeze of one track prints, selected from the live stores in place: cheap enough for every write. */
export function readLiveFreezePrintInput(trackId: string): FreezePrintInput | null {
    const selection = selectFreezePrintInput(trackId, {
        ...readLiveOfflineRenderProjectModels(),
        ...readLiveOfflineRenderSessionModels(),
    });
    return selection?.input ?? null;
}
