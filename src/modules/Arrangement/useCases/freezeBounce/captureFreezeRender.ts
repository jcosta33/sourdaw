import { captureOfflineRenderProjectSource, captureOfflineRenderSessionSource } from '#/modules/AudioEngine/useCases';

import { digestFreezePrintInput } from './digestFreezePrintInput';
import { CHANGED_DURING_FREEZE } from './freezeChangedMessage';
import { type FreezePrintSelection, selectFreezePrintInput } from './selectFreezePrintInput';

/** Everything one freeze render reads, taken in one synchronous read, and its signature. */
export type FreezeRender = Pick<FreezePrintSelection, 'target' | 'subgraph'> & {
    source: {
        project: ReturnType<typeof captureOfflineRenderProjectSource>;
        session: ReturnType<typeof captureOfflineRenderSessionSource>;
    };
    /** The digest of what this input prints; stored as the take's source content hash. */
    signature: string;
};

/**
 * Captures the live document and session a freeze of one track renders, detached from the stores,
 * so the render reads the capture instead of the live stores once it yields, and an edit made and
 * undone while it runs cannot reach the take. The signature is taken over this very capture.
 */
export function captureFreezeRender(trackId: string): FreezeRender {
    const source = { project: captureOfflineRenderProjectSource(), session: captureOfflineRenderSessionSource() };
    const selection = selectFreezePrintInput(trackId, { ...source.project, ...source.session });
    if (!selection) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
    return {
        target: selection.target,
        subgraph: selection.subgraph,
        source,
        signature: digestFreezePrintInput(selection.input),
    };
}
