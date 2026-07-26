import { defaultLevainState, levainStore } from '../stores/levainStore';

import { loadLevainSamplesIntoPort } from './loadLevainSamplesIntoPort';

export type PrepareOfflineLevainInput = {
    /** Id of the device being rendered; keys the patch that selects the instrument. */
    deviceId: string;
    /** Worklet port of the offline Levain instance. */
    port: MessagePort;
    /** Aborts the sample fetch on export cancellation or deadline. */
    signal?: AbortSignal;
};

/**
 * Load the zones an offline Levain instance needs, resolving when it can play.
 *
 * The offline render constructs its own Levain node and never registers it, so
 * the instance has no zones and a fallback tone that was never armed — it renders
 * digital silence. The instrument choice still lives in the live patch, keyed by
 * the same device id the offline node carries, so the export renders the
 * instrument the project actually selected rather than a hardcoded default.
 *
 * Falls back to the default patch's instrument when no entry exists, which is the
 * same instrument live registration would seed for a device nobody has opened.
 */
export async function prepareOfflineLevain({ deviceId, port, signal }: PrepareOfflineLevainInput): Promise<void> {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? defaultLevainState;
    await loadLevainSamplesIntoPort({ port, instrumentId: state.patch.instrumentId, signal });
}
