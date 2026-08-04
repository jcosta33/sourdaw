import { defaultLevainState, levainStore } from '../stores/levainStore';

import { autoLoadLevainSamples } from './autoLoadSamples';
import { hydrateLevainStateFromProject } from './hydrateLevainStateFromProject';
import { projectLevainPatchToEngineParameters } from './projectLevainPatchToEngineParameters';

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
 * **Where the patch comes from.** The live patch when the session holds one, then
 * project truth, then the module default. Instrument identity rides
 * `Device.deviceState`; numeric patch fields ride `Device.parameterValues`. The
 * middle branch therefore reconstructs the complete saved engine state after a
 * reload. The default branch stays reachable for a device nobody has configured
 * and matches the state seeded by live registration.
 */
export async function prepareOfflineLevain({ deviceId, port, signal }: PrepareOfflineLevainInput): Promise<void> {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? hydrateLevainStateFromProject(deviceId) ?? defaultLevainState;
    const { instrumentId } = state.patch;

    for (const parameter of projectLevainPatchToEngineParameters(state.patch)) {
        port.postMessage({ type: 'param', ...parameter });
    }
    await autoLoadLevainSamples(deviceId, port, instrumentId, signal);
}
