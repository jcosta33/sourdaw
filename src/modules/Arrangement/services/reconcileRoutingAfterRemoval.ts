import { type Track } from '../models/Track';

/** Endpoints that are not tracks and therefore always survive a removal. */
const TERMINAL_ENDPOINTS = new Set(['master', 'hw_out']);

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
 *   inherited destination is itself gone (or self-referential, which stored
 *   projects can carry since nothing guarded these writes before).
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

    let inheritedOutputId = 'master';
    if (removedOutputId && removedOutputId !== removedTrackId) {
        if (TERMINAL_ENDPOINTS.has(removedOutputId) || survivingIds.has(removedOutputId)) {
            inheritedOutputId = removedOutputId;
        }
    }

    const repointedOutputs: { trackId: string; outputId: string }[] = [];
    const tracks = remainingTracks.map((track) => {
        const referencesOutput = track.outputId === removedTrackId;
        const staleSends = track.sends.some((send) => send.busId === removedTrackId);
        if (!referencesOutput && !staleSends) {
            return track;
        }

        const next = { ...track };
        if (referencesOutput) {
            next.outputId = inheritedOutputId;
            repointedOutputs.push({ trackId: track.id, outputId: inheritedOutputId });
        }
        if (staleSends) {
            next.sends = track.sends.filter((send) => send.busId !== removedTrackId);
        }
        return next;
    });

    return { tracks, repointedOutputs };
}
