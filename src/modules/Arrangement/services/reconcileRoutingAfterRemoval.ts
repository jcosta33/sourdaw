import { logger } from '#/infra/logger/appLogger';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

import { type Track } from '../models/Track';

/** Endpoints that are not tracks and therefore always survive a removal. */
const TERMINAL_ENDPOINTS = new Set(['master', 'hw_out']);

/** The one destination that can never close a loop: it owns no outgoing edge. */
const HARDWARE_OUT = 'hw_out';
const MASTER = 'master';

/**
 * Picks a destination for `trackId` that does not close a routing cycle.
 *
 * Reconciliation writes a routing edge, so it is bound by the same invariant
 * the FX-2 mutation guards enforce on `setSend` / `setTrackOutput` — and unlike
 * those paths a bad write here is unprompted, so it must not be silent either.
 * Pre-existing cycles are the live case: nothing guarded these writes before,
 * and `hydrateArrangementTracks` / the DAWproject import still do not validate,
 * so a stored project can hand us `Kick → busA → Kick`. Inheriting verbatim
 * would write `Kick.outputId = Kick`, and a Web Audio cycle with no `DelayNode`
 * is muted outright — deleting a bus to *fix* a loop would yield silence.
 */
function resolveAcyclicDestination(
    trackId: string,
    candidate: string,
    tracks: readonly Track[],
    removedTrackId: string
): string {
    if (!wouldCreateRoutingCycle({ sourceId: trackId, targetId: candidate, tracks })) {
        return candidate;
    }

    logger.warn(
        `[reconcileRoutingAfterRemoval] Removing "${removedTrackId}" would have routed "${trackId}" to ` +
            `"${candidate}", closing a routing feedback loop that already existed in this project. ` +
            `Falling back to "${MASTER}".`
    );
    if (!wouldCreateRoutingCycle({ sourceId: trackId, targetId: MASTER, tracks })) {
        return MASTER;
    }

    // Only reachable when the project routes master itself back into this track.
    logger.warn(
        `[reconcileRoutingAfterRemoval] "${MASTER}" also routes back to "${trackId}"; falling back to ` +
            `"${HARDWARE_OUT}", which owns no outgoing edge.`
    );
    return HARDWARE_OUT;
}

type ReconcileRoutingAfterRemovalInput = {
    /** Id of the track/bus being deleted. */
    removedTrackId: string;
    /**
     * Where the removed track itself was routed, before deletion. Optional
     * because CRDT-ingested and partially-hydrated rows reach `normalizeTrack`'s
     * `outputId` default only later; absent simply means nothing to inherit.
     */
    removedOutputId: string | undefined;
    /** The remaining tracks, with the removed one already filtered out. */
    remainingTracks: Track[];
};

type ReconcileRoutingAfterRemovalOutput = {
    /** `remainingTracks` with every reference to the removed id resolved. */
    tracks: Track[];
    /** Tracks whose `outputId` changed, and the destination each moved to. */
    repointedOutputs: { trackId: string; outputId: string }[];
};

/**
 * Resolves every routing reference to a track that is being deleted (FX-6).
 *
 * Before this, deleting a bus left dependents' `outputId` and other tracks'
 * `sends[].busId` pointing at an id no track owned. Nothing errored: the engine
 * resolved the dead id through `getDefaultDestination`'s `?? masterGainNode`
 * fallback, so those tracks silently reappeared on master at full level, with
 * the deleted bus's trim and processing gone.
 *
 * The two references get deliberately different semantics:
 *
 * - **An output edge is repointed to the removed track's own destination.**
 *   If `Kick → BusA → BusB`, deleting BusA leaves `Kick → BusB` — exactly where
 *   the signal already flowed, so BusB's processing and level are preserved.
 *   A blanket fallback to master would instead bypass BusB entirely, which is
 *   the silent re-summing this finding is about. Master is used only when the
 *   inherited destination is itself gone, self-referential, or would close a
 *   routing cycle — see {@link resolveAcyclicDestination}. Reconciliation writes
 *   real routing edges, so it is bound by the same no-cycle invariant the FX-2
 *   guards enforce on `setSend` / `setTrackOutput`.
 * - **A send to the removed bus is dropped.** A send is an *additional*
 *   parallel path, not the signal's route to the speakers. Repointing it to the
 *   inherited destination would inject a second, unattenuated copy of the source
 *   into a bus the track usually already reaches — an audible level change the
 *   user never asked for. The effect path is gone because the effect bus is
 *   gone; dropping it is what preserves intent.
 */
export function reconcileRoutingAfterRemoval({
    removedTrackId,
    removedOutputId,
    remainingTracks,
}: ReconcileRoutingAfterRemovalInput): ReconcileRoutingAfterRemovalOutput {
    const survivingIds = new Set(remainingTracks.map((track) => track.id));

    let inheritedOutputId = MASTER;
    if (removedOutputId && removedOutputId !== removedTrackId) {
        if (TERMINAL_ENDPOINTS.has(removedOutputId) || survivingIds.has(removedOutputId)) {
            inheritedOutputId = removedOutputId;
        }
    }

    // Pass 1 — drop sends to the removed bus. Outputs that referenced it are
    // deliberately left pointing at the dead id for now: no track owns that id,
    // so it is a terminal with no successors and contributes no edge to the
    // cycle checks in pass 2. Repointing them first would instead have every
    // not-yet-validated dependent carrying a provisional edge.
    const tracks: Track[] = remainingTracks.map((track) => {
        if (!track.sends.some((send) => send.busId === removedTrackId)) {
            return track;
        }
        return { ...track, sends: track.sends.filter((send) => send.busId !== removedTrackId) };
    });

    // Pass 2 — repoint outputs one at a time, each validated against the graph
    // as it actually stands at that moment (including edges pass 2 has already
    // written), so no reconciled edge can close a loop.
    const repointedOutputs: { trackId: string; outputId: string }[] = [];
    for (const [index, track] of tracks.entries()) {
        if (track.outputId !== removedTrackId) {
            continue;
        }
        const outputId = resolveAcyclicDestination(track.id, inheritedOutputId, tracks, removedTrackId);
        tracks[index] = { ...track, outputId };
        repointedOutputs.push({ trackId: track.id, outputId });
    }

    return { tracks, repointedOutputs };
}
