import { prepareOfflineLevain } from '#/modules/Levain/useCases';
import { prepareOfflineProof } from '#/modules/Proof/useCases';

export type PrepareOfflineDeviceSetupInput = {
    /** Id of the device being rendered; keys the project state that configures it. */
    deviceId: string;
    /** Device type, as the offline chain read it off the project. */
    deviceType: string;
    /** Worklet port of the offline instance the chain just built. */
    port: MessagePort;
    /** Aborts the setup on export cancellation or deadline. */
    signal?: AbortSignal;
};

/**
 * Give an offline device the state its live counterpart gets from somewhere
 * other than `Device.parameterValues`.
 *
 * The offline render builds its nodes through a different registry than live
 * playback (`nativeDspDeviceFactories` versus `wasmDeviceRegistry`), so none of
 * the per-device setup the live descriptors perform ever runs for an export.
 * Everything a device needs beyond a flat map of numbers therefore has to be
 * re-established here, once per device the chain builds.
 *
 * This lives in the composition root because the decision is cross-module:
 * `buildDeviceChain` may not import a device module's use cases (the engine
 * registry and the module's bridge would form a cycle), so it hands the device
 * type over through `audioDeviceRuntimeSink` and this function dispatches. A
 * type with nothing to prepare resolves immediately — the chain calls this for
 * every worklet-backed device it builds, not only the ones listed here.
 */
export async function prepareOfflineDeviceSetup({
    deviceId,
    deviceType,
    port,
    signal,
}: PrepareOfflineDeviceSetupInput): Promise<void> {
    if (deviceType === 'levain') {
        await prepareOfflineLevain({ deviceId, port, signal });
        return;
    }

    // Proof's module order is persisted as `chain_order_N` params the worklet
    // ignores; only a `reorder` message moves the chain, and nothing offline
    // sent one, so every export rendered the default order.
    if (deviceType === 'proof') {
        prepareOfflineProof({ deviceId, port });
    }
}
