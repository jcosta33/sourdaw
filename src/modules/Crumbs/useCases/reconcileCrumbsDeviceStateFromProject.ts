import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';

import { fromCrumbsDeviceState } from '../models/CrumbsDeviceState';
import { crumbsStore, setActiveSample } from '../stores/crumbsStore';
import {
    beginCrumbsPairedReconcile,
    endCrumbsPairedReconcile,
    hasUnsettledCrumbsPairedReconcile,
} from '../stores/sampleLoadGate';

import { replayCrumbsDeviceStateCommit } from './crumbsDeviceStateMirror';
import { loadSampleFromPath } from './loadSample';
import { switchCrumbsMode } from './setCrumbsMode';

import type { SampleMeta } from '../models/CrumbsTypes';

/**
 * Converge a settled pair's sample half before the release replay reads it.
 *
 * A successful paired load lands the peer's meta, but a failed one leaves the
 * store holding the very leaf the mode apply found beside it — the stale local
 * sample the hold exists to keep out of the document. Restore the document's
 * own reference so the release commits the peer's state, not the stale sample
 * (#4764).
 *
 * Restore only when the store still holds that pre-pair leaf: a newer load
 * that won the window (the user dropping a file mid-pair) replaces the leaf
 * object, and knob writes never touch it, so identity against the pre-pair
 * leaf is the record of whether any load actually displaced it — the store's
 * own answer, at release, to the last-won question the load epoch answers for
 * in-flight decodes.
 */
function restoreUndecidedPairedSample(
    deviceId: string,
    prePairSample: SampleMeta | null,
    peerSample: SampleMeta | null
): void {
    if (!peerSample) {
        return;
    }
    const state = crumbsStore.value?.[deviceId];
    if (!state || state.activeSample !== prePairSample) {
        return;
    }
    setActiveSample(deviceId, peerSample);
}

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

    // A reconcile carrying both a mode and a sample change applies them as one
    // pair, so the mirror must not run mid-pair: the mode lands synchronously
    // beside the store's still-stale activeSample, and a persistence commit of
    // that state would write {mode, staleSample} over the peer's document
    // reference — a failed or slow decode then erases the reference
    // cross-session. Hold the mirror until the paired load settles; the
    // release below converges: it restores the document's reference into an
    // undecided sample leaf, replays the persistence comparison against the
    // settled store, and commits (#4764).
    const paired = modeChanged && filePath !== null && sampleChanged;
    const prePairSample = state.activeSample;
    if (paired) {
        beginCrumbsPairedReconcile(deviceId);
    }
    if (modeChanged) {
        void switchCrumbsMode(deviceId, playback.mode);
    }
    if (filePath !== null && sampleChanged) {
        loadSampleFromPath(deviceId, filePath)
            .catch((error: unknown) => {
                logger.warn(`[Crumbs] could not reconcile sample "${filePath}" for ${deviceId}: ${String(error)}`);
            })
            .finally(() => {
                if (!paired) {
                    return;
                }
                endCrumbsPairedReconcile(deviceId);
                if (hasUnsettledCrumbsPairedReconcile(deviceId)) {
                    // A younger paired reconcile still holds the mirror; its
                    // own release replays for the device.
                    return;
                }
                restoreUndecidedPairedSample(deviceId, prePairSample, playback.activeSample);
                replayCrumbsDeviceStateCommit(deviceId);
            });
    }
}
