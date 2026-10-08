import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';

import { fromCrumbsDeviceState, type CrumbsDevicePlayback } from '../models/CrumbsDeviceState';
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
 * Read one device's playback state out of the current document, or `null` when
 * the tracks, the device or its chunk are gone or unreadable.
 *
 * The sweep opens with this, and the pair's release re-reads with it: the
 * document can move on while a paired decode is in flight, and the sweep-time
 * read is then stale — deciding the release from it would commit a pick the
 * document already withdrew.
 */
function readDocumentPlayback(deviceId: string): CrumbsDevicePlayback | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device) {
        return null;
    }

    return fromCrumbsDeviceState(device.deviceState);
}

/**
 * Restore the document's own reference into an undecided paired sample.
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
 * Converge a settled pair's sample to a document that moved on mid-window.
 *
 * The paired decode applies the sweep-time read, but the peer can withdraw
 * that pick while the decode is in flight — re-picking the sample the store
 * already holds, or undoing the whole commit. The re-sweep that read sees no
 * change (the store still holds the pre-pair leaf) and starts nothing, so
 * nothing supersedes the decode; committing the settled store at release would
 * then write the withdrawn pick over the peer's newer write, silently undoing
 * the revert on both machines. Re-reading the document here and restoring its
 * current reference makes the release commit the document's own truth, and
 * lands the mirror's baseline on the document's state.
 *
 * Converge only when the store still holds exactly the paired pick: a newer
 * local load that applied after it owns the store, and the replay must carry
 * that pick, not the document's older one.
 */
function restoreWithdrawnPairedSample(deviceId: string, pairedPick: SampleMeta | null): void {
    if (!pairedPick) {
        return;
    }
    const documentSample = readDocumentPlayback(deviceId)?.activeSample;
    if (!documentSample || documentSample.filePath === pairedPick.filePath) {
        return;
    }
    const state = crumbsStore.value?.[deviceId];
    if (state?.activeSample?.filePath !== pairedPick.filePath) {
        return;
    }
    setActiveSample(deviceId, documentSample);
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
    const playback = readDocumentPlayback(deviceId);
    if (!playback) {
        return;
    }

    const state = crumbsStore.value?.[deviceId];
    if (!state) {
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
    // undecided sample leaf, converges a pick the document withdrew mid-window
    // back to the document's current state, replays the persistence
    // comparison against the settled store, and commits (#4764).
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
                restoreWithdrawnPairedSample(deviceId, playback.activeSample);
                replayCrumbsDeviceStateCommit(deviceId);
            });
    }
}
