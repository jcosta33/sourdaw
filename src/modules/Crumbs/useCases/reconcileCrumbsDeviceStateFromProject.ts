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
 * Converge the released pair's sample leaf with one store write.
 *
 * At release the window can have left the store three ways: the decode applied
 * the paired pick, it failed or was superseded before applying (the store
 * still holds the pre-pair leaf), or a newer local load won outright. The
 * document can also have moved on mid-window — the peer re-picking the sample
 * the store already holds, or undoing the whole commit — and the re-sweep that
 * read sees no change and starts nothing, so nothing supersedes the decode.
 *
 * The target leaf is decided once, then written once:
 *
 * - The document's current reference whenever it disagrees with the paired
 *   pick and the pair still owns the store. Committing the pair's pick would
 *   write a withdrawn pick over the peer's newer write, silently undoing the
 *   revert on both machines — and splitting the restore into "undecided leaf
 *   first, withdrawal second" would commit that withdrawn pick as its own
 *   transaction a peer can observe with nothing left to supersede it.
 * - The paired pick into an undecided store when the pair still stands. A
 *   failed decode leaves the store holding the very leaf the mode apply found
 *   beside it — the stale local sample the hold exists to keep out of the
 *   document — so the release restores the peer's reference instead (#4764).
 * - Nothing otherwise: an applied pair the document still agrees with needs no
 *   restore, and a newer local pick owns the store.
 *
 * Ownership is the store's own answer at release: identity against the
 * pre-pair leaf, or the paired pick's file path. A newer load that won the
 * window replaces the leaf object and knob writes never touch it, so anything
 * else holding the leaf means a load displaced the pair and the replay must
 * carry that pick.
 */
function convergeReleasedPairedSample(
    deviceId: string,
    prePairSample: SampleMeta | null,
    pairedPick: SampleMeta | null
): void {
    if (!pairedPick) {
        return;
    }
    const state = crumbsStore.value?.[deviceId];
    if (!state) {
        return;
    }
    const storeHoldsPrePairLeaf = state.activeSample === prePairSample;
    const storeHoldsPairedPick = state.activeSample?.filePath === pairedPick.filePath;
    if (!storeHoldsPrePairLeaf && !storeHoldsPairedPick) {
        return;
    }

    const documentSample = readDocumentPlayback(deviceId)?.activeSample;
    if (documentSample && documentSample.filePath !== pairedPick.filePath) {
        setActiveSample(deviceId, documentSample);
        return;
    }

    if (storeHoldsPrePairLeaf) {
        setActiveSample(deviceId, pairedPick);
    }
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
    // release below converges: it decides the settled sample leaf once — the
    // document's current reference when it withdrew the pick mid-window,
    // otherwise the pair's pick into an undecided store — commits it with a
    // single store write, replays the persistence comparison against the
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
                convergeReleasedPairedSample(deviceId, prePairSample, playback.activeSample);
                replayCrumbsDeviceStateCommit(deviceId);
            });
    }
}
