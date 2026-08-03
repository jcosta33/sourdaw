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
 * Give an offline Levain instance the two things live registration gives it —
 * its instrument identity and its zones — and resolve only once it can play.
 *
 * The offline render constructs its own Levain node and never registers it, so
 * neither half happened and every exported Levain track was wrong twice over.
 *
 * **Identity.** The `setInstrument` message is the only thing that reaches
 * `RealismEngine::configure_for`. An instance that never receives it stays at the
 * constructor default `Instrument::Other`, whose branch zeroes body resonance,
 * sympathetic strings, bow noise, breath and damping — against 0.65 / 0.5 / 0.5 /
 * 0.4 for a bowed string — and never fires the bow-scrape and bow-lift transients,
 * which are gated on `is_bowed_string()`. `realism.tick` runs per sample, so an
 * export came out audibly flatter than the session even once the samples landed.
 *
 * **Order.** Identity is posted before the load, matching the live bridge's
 * `loadSamplesForInstrument`, which calls `setInstrument` and only then starts the
 * load. Safe because the `clearZones` the loader posts first calls
 * `realism.reset()`, and every `reset()` under `levain/realism/` clears filter
 * state only — never the instrument, its presets, or its mix amounts.
 *
 * **Zones.** Reuses the live loader rather than keeping a second copy of it. It
 * resolves only once `buildZoneMap` has been posted, which is what an offline
 * render needs: `OfflineAudioContext` renders faster than real time, so a load
 * that is merely started never lands. Its progress and error writes land on the
 * panel keyed by the same device id, which is wanted here — a manifest that fails
 * during an export is a failure the user should see rather than one buried in a
 * log line.
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

    port.postMessage({ type: 'setInstrument', instrumentId });
    port.postMessage({ type: 'param', name: 'current_articulation', value: getArticulationId(currentArticulation) });
    await autoLoadLevainSamples(deviceId, port, instrumentId, signal);
}
