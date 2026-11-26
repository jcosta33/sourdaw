import { type OfflineRenderSessionSource } from './OfflineRenderSource';
import { readLiveOfflineRenderSessionModels } from './readLiveOfflineRenderSessionModels';

/**
 * The live session's adjustment-layer stack and modulator rack, detached from their stores, for a
 * render of the live project that must read nothing live once it yields (a freeze).
 */
export function captureOfflineRenderSessionSource(): OfflineRenderSessionSource {
    return structuredClone(readLiveOfflineRenderSessionModels());
}
