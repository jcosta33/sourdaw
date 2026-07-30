import { defaultToasterState, toasterStore } from '../stores/toasterStore';

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
 * A Toaster's audible identity is not in `device.parameterValues` — that holds
 * only the four automatable kit-level numbers. Engine type, tuning, decay, tone,
 * drive, filtering and sends are pushed to the engine after construction, and the
 * offline render constructs its own node through a different registry, so none of
 * it ever arrived. An export rendered `ToasterEngine::new`'s built-in kit: the
 * right notes on the wrong drums, which is why a bounce came back sounding like a
 * different track rather than like a broken one.
 *
 * Unlike Levain's offline setup this needs no `AbortSignal`: there is no fetch and
 * no await here, only a bounded run of `postMessage` calls over sixteen pads. It
 * cannot stall the export deadline it would be cancelled against.
 *
 * The fallback to `defaultToasterState` is not cosmetic. The application's default
 * kit is the 808/909 circuit-faithful set, while the engine's constructor default
 * is the generic voice set — a different-sounding kit. Sending nothing for a
 * device with no store record would render the generic set, so the fallback is
 * strictly closer to what the user hears than silence on the wire.
 *
 * **This closes the offline seam, and today the fallback is the branch that runs.**
 * `toasterStore` currently has no creation path: every writer in
 * `stores/toasterStore.ts` returns early for a `deviceId` it does not already hold,
 * and nothing ever adds the first record, so the store stays `{}` for the whole
 * session. Until a record is created when a Toaster device loads, an export gets
 * the application default kit rather than the pads the user actually edited — an
 * audible improvement over the engine default, but not yet parity with the
 * session. That creation path is a separate defect with its own blast radius (it
 * re-enables every no-op store writer: panel edits, the step grid, preset loads,
 * pattern export), which is why it is not folded in here.
 */
export function prepareOfflineToaster({ deviceId, port }: PrepareOfflineToasterInput): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId] ?? defaultToasterState;

    for (const message of projectToasterKitToEngineMessages({ kit: state.kit })) {
        port.postMessage(message);
    }
}
