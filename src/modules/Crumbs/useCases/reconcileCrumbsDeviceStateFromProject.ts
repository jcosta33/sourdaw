import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';

import { fromCrumbsDeviceState } from '../models/CrumbsDeviceState';
import { crumbsStore } from '../stores/crumbsStore';

import { loadSampleFromPath } from './loadSample';
import { switchCrumbsMode } from './setCrumbsMode';

/**
 * Apply authoritative project playback state to a loaded Crumbs session
 * (#4764).
 *
 * The inbound half of `initCrumbsDeviceStatePersistence`: the peer's commit
 * landed in the document without any local trigger firing, so this re-applies
 * the mode and the sample through the same live routes a panel gesture uses —
 * `switchCrumbsMode` for the mode (store, worklet node via the
 * `crumbs.modeChanged` signal, native instance) and `loadSampleFromPath` for
 * the sample (native decode, store meta, waveform). A failed decode is logged,
 * not thrown: a peer referencing a file this machine cannot read is the same
 * silence the restore path already tolerates.
 *
 * A device with no session record is skipped: nothing live holds a stale
 * sample, and `ensureCrumbsInstanceFromProject` seeds the record from the
 * document at instance open.
 *
 * The comparison is the GB hydrate's diff gate with one deliberate omission:
 * it compares the mode and the sample's **file path**, never `sampleId`. An
 * instance assigns ids from its own counter, so two peers legitimately hold
 * different ids for the same file; comparing them would make every
 * reconciliation read "changed", commit the local counter back, and set the
 * peers chasing each other forever. The path is the identity the chunk
 * actually carries.
 */
export function reconcileCrumbsDeviceStateFromProject(deviceId: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device) {
        return;
    }

    const state = crumbsStore.value?.[deviceId];
    if (!state) {
        return;
    }

    const playback = fromCrumbsDeviceState(device.deviceState);
    if (!playback) {
        return;
    }

    const filePath = playback.activeSample?.filePath ?? null;
    const modeChanged = state.mode !== playback.mode;
    const sampleChanged = filePath !== null && filePath !== (state.activeSample?.filePath ?? null);
    if (!modeChanged && !sampleChanged) {
        return;
    }

    if (modeChanged) {
        void switchCrumbsMode(deviceId, playback.mode);
    }
    if (filePath !== null && sampleChanged) {
        loadSampleFromPath(deviceId, filePath).catch((error: unknown) => {
            logger.warn(`[Crumbs] could not reconcile sample "${filePath}" for ${deviceId}: ${String(error)}`);
        });
    }
}
