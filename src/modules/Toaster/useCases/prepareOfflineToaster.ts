import { createDefaultKit, type ToasterKit } from '../models/ToasterKit';
import { fromToasterKitState } from '../models/ToasterKitState';
import { toasterStore } from '../stores/toasterStore';

import { projectToasterKitToEngineMessages } from './projectToasterKitToEngineMessages';

export type PrepareOfflineToasterInput = {
    /** Id of the device being rendered; keys the kit this instance must play. */
    deviceId: string;
    /** Project snapshot state; authoritative when present. */
    deviceState?: unknown;
    /** Worklet port of the offline Toaster instance. */
    port: MessagePort;
};

/**
 * Give an offline Toaster instance the kit the session plays.
 *
 * The offline render constructs its own node through a different registry and
 * never emits `audioDevice.loaded`, so the subscriber that pushes the kit live
 * never runs for it. An export therefore rendered `ToasterEngine::new`'s built-in
 * kit: the right notes on the wrong drums, which is why a bounce came back
 * sounding like a different track rather than like a broken one.
 *
 * Unlike Levain's offline setup this needs no `AbortSignal`: there is no fetch and
 * no await, only a bounded run of `postMessage` calls over sixteen pads. It cannot
 * stall the export deadline it would be cancelled against.
 *
 * Project state wins over the transient session store. That makes export consume
 * the same immutable render snapshot as the rest of the chain, including headless
 * renders and live-device load failures where no store record was ever registered.
 * The store remains a compatibility fallback for callers without persisted state;
 * if neither source exists, project the same application default kit that live
 * device registration creates instead of leaving the Rust constructor kit active.
 */
export function prepareOfflineToaster({ deviceId, deviceState, port }: PrepareOfflineToasterInput): void {
    let kit: ToasterKit;
    if (deviceState === undefined) {
        kit = toasterStore.value?.[deviceId]?.kit ?? createDefaultKit();
    } else {
        kit = fromToasterKitState(deviceState);
    }

    for (const message of projectToasterKitToEngineMessages({ kit })) {
        port.postMessage(message);
    }
}
