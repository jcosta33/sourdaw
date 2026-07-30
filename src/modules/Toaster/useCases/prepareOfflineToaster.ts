import { toasterStore } from '../stores/toasterStore';

import { projectToasterKitToEngineMessages } from './projectToasterKitToEngineMessages';

export type PrepareOfflineToasterInput = {
    /** Id of the device being rendered; keys the kit this instance must play. */
    deviceId: string;
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
 * **A device with no store record posts nothing, deliberately.** The live
 * subscriber bails the same way (`if (!kit) return`), so both paths leave such an
 * instance on the engine's constructor kit and therefore agree. Substituting the
 * application default here instead would post the 808/909 set against live's
 * generic set and make an export differ from the session — turning a shared,
 * invisible default into a real divergence. Matching live is the requirement;
 * being independently "nicer" is not. In practice the record exists, because
 * `registerToasterDevice` creates it on device load.
 */
export function prepareOfflineToaster({ deviceId, port }: PrepareOfflineToasterInput): void {
    const kit = toasterStore.value?.[deviceId]?.kit;
    if (!kit) {
        return;
    }

    for (const message of projectToasterKitToEngineMessages({ kit })) {
        port.postMessage(message);
    }
}
