import { getArticulationId } from '../models/LevainPatch';
import { defaultLevainState, levainStore } from '../stores/levainStore';

import { autoLoadLevainSamples } from './autoLoadSamples';
import { hydrateLevainStateFromProject } from './hydrateLevainStateFromProject';

export type PrepareOfflineLevainInput = {
    /** Id of the device being rendered; keys the patch that selects the instrument. */
    deviceId: string;
    /** Worklet port of the offline Levain instance. */
    port: MessagePort;
    /** Aborts the sample fetch on export cancellation or deadline. */
    signal?: AbortSignal;
};

/**
 * Give an offline Levain instance its context-local copy of the decoded bank
 * used by live registration, and resolve only after the worklet commits it.
 *
 * The offline render constructs its own Levain node and never registers it, so
 * neither half happened and every exported Levain track was wrong twice over.
 *
 * **Identity.** The loader includes the instrument identity in `beginSampleBank`.
 * Rust stages it with the PCM and zone map and applies it only when that bank
 * commits, so a failed replacement cannot recolour the still-sounding bank.
 *
 * **Zones.** Reuses the live loader rather than keeping a second implementation.
 * The main-thread decoded SAB cache avoids another fetch/decode pass, while the
 * fresh `OfflineAudioContext` uploads one separate Rust/WASM bank into its own
 * worklet scope. The loader waits for `sampleBankLoaded`; merely posting
 * `buildZoneMap` is insufficient because offline rendering outruns asynchronous
 * setup. Progress and errors remain keyed to the same device id so export
 * failures reach the user instead of disappearing into a log line.
 *
 * **Where the instrument comes from.** The live patch when the session holds one,
 * then project truth, then the module default. `Device.parameterValues` holds
 * numbers only, so the id rides `Device.deviceState` instead; the middle branch is
 * what makes a bounce from a freshly reopened project render the instrument that
 * was saved rather than violin-1. The default branch stays reachable for a device
 * nobody has ever pointed at an instrument, and is the same one live registration
 * seeds.
 */
export async function prepareOfflineLevain({ deviceId, port, signal }: PrepareOfflineLevainInput): Promise<void> {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? hydrateLevainStateFromProject(deviceId) ?? defaultLevainState;
    const { currentArticulation, instrumentId } = state.patch;

    port.postMessage({ type: 'param', name: 'current_articulation', value: getArticulationId(currentArticulation) });
    await autoLoadLevainSamples(deviceId, port, instrumentId, signal);
}
