import { inject } from '#/infra/di/inject';
import { removeBusStrip, removeTrackStrip } from '#/modules/AudioEngine/useCases';
import { removeAutomationLanesForTrack } from '#/modules/Automation/useCases';
import { removeMidiClipData } from '#/modules/MIDI/useCases';
import { getAllSidechainRoutes, removeSidechainRoute } from '#/modules/Routing/useCases';

import { getTrackById } from '../repositories/track/getTrackById';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { collectTrackClipIds } from '../services/collectTrackClipIds';
import { takeLaneStore } from '../stores/takeLaneStore';
import { shouldCreateLiveTrackStrip } from '../stores/trackEligibility';

import { ArrangementEventBus } from './arrangementEventBus';

export const removeTrack = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function removeTrack(trackId: string): void {
            const state = getTrackState();
            if (!state) {
                return;
            }

            const track = getTrackById(trackId);
            if (!track) {
                return;
            }

            const clipIds = collectTrackClipIds(track);

            setTrackState({
                ...state,
                tracks: state.tracks.filter((time) => time.id !== trackId),
                selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
            });

            // Clean up automation lanes for this track.
            removeAutomationLanesForTrack(trackId);

            // Clean up MIDI data for the active and inactive alternative clips.
            removeMidiClipData(clipIds);

            // Clean up take lanes for this track
            const takeLane = takeLaneStore.value;
            if (takeLane) {
                takeLaneStore.set({
                    lanes: takeLane.lanes.filter((length) => length.trackId !== trackId),
                });
            }

            // Clean up sidechain routes referencing this track
            const routes = getAllSidechainRoutes();
            for (const route of routes) {
                if (route.sourceTrackId === trackId || route.targetTrackId === trackId) {
                    removeSidechainRoute(route.id);
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
            if (shouldCreateLiveTrackStrip(track)) {
                removeTrackStrip(trackId);
            }
            if (track.kind === 'bus') {
                removeBusStrip(trackId);
            }
            void eventBus.emit('track.removed', { trackId });
        }
);
