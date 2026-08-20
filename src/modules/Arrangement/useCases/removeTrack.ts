import { inject } from '#/infra/di/inject';
import { removeBusStrip, removeTrackStrip, setTrackOutput } from '#/modules/AudioEngine/useCases';
import { removeAutomationLanesForTrack } from '#/modules/Automation/useCases';
import { removeMidiClipData } from '#/modules/MIDI/useCases';
import { getAllSidechainRoutes, removeSidechainRoute } from '#/modules/Routing/useCases';
import { runAllEffects } from '#/utils/runEffects';

import { getTrackById } from '../repositories/track/getTrackById';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { collectTrackClipIds } from '../services/collectTrackClipIds';
import { reconcileRoutingAfterRemoval } from '../services/reconcileRoutingAfterRemoval';
import { takeLaneStore } from '../stores/takeLaneStore';
import { shouldCreateLiveTrackStrip } from '../stores/trackEligibility';

import { ArrangementEventBus } from './arrangementEventBus';
import { removeClipSatelliteData } from './clip/removeClipSatelliteData';
import { refreshToasterPadBindings } from './refreshToasterPadBindings';

type RemoveTrackOptions = {
    deferRuntimeEffects?: boolean;
    suppressRemovedEvent?: boolean;
};

type RemoveTrackResult =
    | { removed: false }
    | {
          removed: true;
          finalizeRuntimeRemoval: () => void;
      };

export const removeTrack = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function removeTrack(trackId: string, options: RemoveTrackOptions = {}): RemoveTrackResult {
            const state = getTrackState();
            if (!state) {
                return { removed: false };
            }

            const track = getTrackById(trackId);
            if (!track) {
                return { removed: false };
            }
            const removedTrack = track;

            const clipIds = collectTrackClipIds(track);

            // FX-6: dropping the row is not enough. Any surviving track that
            // routed its output here, or held a send to it, would keep a
            // reference no track answers to — and the engine resolves a dead id
            // by silently falling back to master. Resolve both in the same store
            // write so project truth is never observable in the dangling state.
            const survivors = state.tracks.filter((time) => time.id !== trackId);
            const { tracks, repointedOutputs } = reconcileRoutingAfterRemoval({
                removedTrackId: trackId,
                removedOutputId: track.outputId,
                remainingTracks: survivors,
            });
            setTrackState({
                ...state,
                tracks,
                selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
            });

            // Clean up automation lanes for this track.
            removeAutomationLanesForTrack(trackId);

            // Clean up MIDI data for the active and inactive alternative clips.
            removeMidiClipData(clipIds);

            // Clean up gain envelopes and warp states carried by this track's
            // clips — orphaned satellites survive under the retired clip id
            // and re-attach to whatever clip reuses it (ledger #2108).
            removeClipSatelliteData(clipIds);

            // Clean up take lanes for this track
            const takeLane = takeLaneStore.value;
            if (takeLane) {
                takeLaneStore.set({
                    lanes: takeLane.lanes.filter((length) => length.trackId !== trackId),
                });
            }

            // Clean up sidechain routes referencing this track
            const routes = getAllSidechainRoutes();
            const deferredSidechainRuntimeEffects: Array<() => void> = [];
            for (const route of routes) {
                if (route.sourceTrackId === trackId || route.targetTrackId === trackId) {
                    let deferredRuntimeEffect: (() => void) | null;
                    if (options.deferRuntimeEffects) {
                        deferredRuntimeEffect = removeSidechainRoute(route.id, { deferRuntimeEffect: true });
                    } else {
                        deferredRuntimeEffect = removeSidechainRoute(route.id);
                    }
                    if (deferredRuntimeEffect) {
                        deferredSidechainRuntimeEffects.push(deferredRuntimeEffect);
                    }
                }
            }

            // Tear down the engine strips for this track. Without this the
            // BusNode/TrackNode survives in the live graph, still summing and
            // processing (a leaked node). Audio, MIDI, master, bus, and a folder
            // hosting Toaster own a TrackNode; a bus owns a BusNode on top. Tear
            // the TrackNode down first — it sweeps
            // routing keyed on this id as the source — then dispose the BusNode,
            // which sweeps sends targeting the bus. Both engine methods no-op
            // when the node is absent.
            let runtimeRemovalFinalized = false;
            function finalizeRuntimeRemoval(): void {
                if (runtimeRemovalFinalized) {
                    return;
                }
                const effects: Array<() => void> = [...deferredSidechainRuntimeEffects];
                if (shouldCreateLiveTrackStrip(removedTrack)) {
                    effects.push(() => removeTrackStrip(trackId));
                }
                if (removedTrack.kind === 'bus') {
                    effects.push(() => removeBusStrip(trackId));
                }
                // FX-6: `removeTrackStrip` re-seats the engine's dependents on
                // `hw_out`, which bypasses master entirely and disagrees with the
                // destination project truth just inherited. Replay the reconciled
                // outputs so the live graph matches the store. This runs after the
                // teardown for the same reason the Toaster refresh below does — the
                // strip sweep would otherwise overwrite it.
                for (const repointed of repointedOutputs) {
                    effects.push(() => setTrackOutput(repointed.trackId, repointed.outputId));
                }
                effects.push(() => refreshToasterPadBindings(tracks, removedTrack.parentId));
                runAllEffects(effects);
                runtimeRemovalFinalized = true;
            }
            if (!options.deferRuntimeEffects) {
                finalizeRuntimeRemoval();
            }
            if (!options.suppressRemovedEvent) {
                void eventBus.emit('track.removed', { trackId });
            }
            return { removed: true, finalizeRuntimeRemoval };
        }
);
