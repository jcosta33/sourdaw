import { defaultLevainState, levainStore } from '../stores/levainStore';

import { autoLoadLevainSamples } from './autoLoadSamples';

export type PrepareOfflineLevainInput = {
    /** Id of the device being rendered; keys the patch that selects the instrument. */
    deviceId: string;
    /** Worklet port of the offline Levain instance. */
    port: MessagePort;
    /** Aborts the sample fetch on export cancellation or deadline. */
    signal?: AbortSignal;
};

/**
 * Give an offline Levain instance the same committed sample bank as live
 * registration and resolve only once the load messages have been posted.
 *
 * The offline render constructs its own Levain node and never registers it, so
 * neither half happened and every exported Levain track was wrong twice over.
 *
 * **Identity.** The loader includes the instrument identity in `beginSampleBank`.
 * Rust stages it with the PCM and zone map and applies it only when that bank
 * commits, so a failed replacement cannot recolour the still-sounding bank.
 *
 * **Zones.** Reuses the live loader rather than keeping a second copy of it. It
 * resolves only once `buildZoneMap` has been posted, which is what an offline
 * render needs: `OfflineAudioContext` renders faster than real time, so a load
 * that is merely started never lands. Its progress and error writes land on the
 * panel keyed by the same device id, which is wanted here — a manifest that fails
 * during an export is a failure the user should see rather than one buried in a
 * log line.
 *
 * The instrument comes from the live patch when there is one. Note that
 * `instrumentId` is not persisted — `Device.parameterValues` holds numbers only —
 * so a project reopened from disk takes the `defaultLevainState` branch, the same
 * instrument live registration seeds for a device nobody has opened.
 */
export async function prepareOfflineLevain({ deviceId, port, signal }: PrepareOfflineLevainInput): Promise<void> {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? defaultLevainState;
    const { instrumentId } = state.patch;

    await autoLoadLevainSamples(deviceId, port, instrumentId, signal);
}
