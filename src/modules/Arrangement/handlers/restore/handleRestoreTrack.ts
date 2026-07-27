import { restoreAutomationLanes, restoreTrackModulationReferences } from '#/modules/Automation/useCases';
import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { ensureBusStrip, restoreSidechainRoutes, setBusGain } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
import { publishTrackAdded } from '../../useCases/publishTrackAdded';
import { refreshToasterPadBindings } from '../../useCases/refreshToasterPadBindings';
import { setTrackState } from '../../useCases/setTrackState';

/**
 * Inverse-action handler for `removeTrack`. Replays snapshot data carried in the
 * action payload — does not compute state itself.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */
export const handleRestoreTrack = createHandler<'restoreTrack'>({
    execute: (alpha) => {
        const {
            trackSnapshot,
            trackName,
            trackKind,
            trackGain,
            trackParentId,
            trackIndex,
            wasSelected,
            routingPatches,
            automationLaneSnapshots,
            midiNotesByClipId,
            midiCcByClipId,
            midiPitchBendByClipId,
            takeLaneSnapshots,
            sidechainRouteSnapshots,
            ownedModulatorSnapshots,
            incomingModulationMappingSnapshots,
        } = alpha.payload;

        const state = getTrackStoreState();
        if (!state || state.tracks.some((track) => track.id === alpha.payload.trackId)) {
            return { status: 'conflict' };
        }
        for (const patch of routingPatches) {
            const current = state.tracks.find((track) => track.id === patch.trackId);
            if (!current || !hasExpectedRoutingState(current, patch.expected)) {
                return { status: 'conflict' };
            }
        }
        const routingPatchById = new Map(routingPatches.map((patch) => [patch.trackId, patch]));
        const tracks = state.tracks.map((track) => {
            const patch = routingPatchById.get(track.id);
            if (!patch) {
                return track;
            }
            return {
                ...track,
                outputId: patch.replacement.outputId,
                sends: patch.replacement.sends.map((send) => ({ ...send })),
            };
        });
        const insertionIndex = Math.min(Math.max(trackIndex, 0), tracks.length);
        tracks.splice(insertionIndex, 0, trackSnapshot as never);
        let selectedTrackId = state.selectedTrackId;
        if (wasSelected && selectedTrackId === null) {
            selectedTrackId = alpha.payload.trackId;
        }
        setTrackState({
            ...state,
            tracks,
            selectedTrackId,
        });

        if (automationLaneSnapshots.length > 0) {
            restoreAutomationLanes(automationLaneSnapshots);
        }

        const midiClipIds = new Set([
            ...Object.keys(midiNotesByClipId),
            ...Object.keys(midiCcByClipId),
            ...Object.keys(midiPitchBendByClipId),
        ]);
        for (const clipId of midiClipIds) {
            restoreMidiClipData({
                clipId,
                notesSnapshot: midiNotesByClipId[clipId] ?? null,
                controlChangeSnapshot: midiCcByClipId[clipId] ?? null,
                pitchBendSnapshot: midiPitchBendByClipId[clipId] ?? null,
            });
        }

        if (takeLaneSnapshots.length > 0) {
            const takes = takeLaneStore.value;
            if (takes) {
                takeLaneStore.set({ lanes: [...takes.lanes, ...(takeLaneSnapshots as never[])] });
            }
        }

        restoreTrackModulationReferences({
            ownedModulators: ownedModulatorSnapshots,
            incomingMappings: incomingModulationMappingSnapshots,
        });
        const finalizeSidechainRestore = restoreSidechainRoutes(sidechainRouteSnapshots, {
            deferRuntimeEffect: true,
        });
        return {
            status: 'written',
            afterCommit: () => {
                const effects: Array<() => void | Promise<void>> = [];
                if (trackKind === 'bus') {
                    effects.push(
                        () => ensureBusStrip(alpha.payload.trackId),
                        () => setBusGain(alpha.payload.trackId, trackGain)
                    );
                }
                effects.push(
                    () =>
                        projectTrackToLiveStrip({
                            trackId: alpha.payload.trackId,
                            deferSidechainWiring: true,
                            activateDormantExternalPlugins: true,
                        }),
                    ...routingPatches.map(
                        (patch) => () => projectTrackToLiveStrip({ trackId: patch.trackId, deferSidechainWiring: true })
                    ),
                    () => refreshToasterPadBindings(tracks, trackParentId),
                    finalizeSidechainRestore,
                    () =>
                        publishTrackAdded({
                            trackId: alpha.payload.trackId,
                            name: trackName,
                            kind: trackKind,
                        })
                );
                return runAllAsyncEffects(effects);
            },
        };
    },
    describe: () => ({ label: 'Restore track' }),
    undoable: false,
});

type RoutingState = {
    readonly outputId: string;
    readonly sends: readonly { readonly busId: string; readonly level: number; readonly preFader: boolean }[];
};

function hasExpectedRoutingState(current: RoutingState, expected: RoutingState): boolean {
    if (current.outputId !== expected.outputId || current.sends.length !== expected.sends.length) {
        return false;
    }
    return current.sends.every((send, index) => {
        const expectedSend = expected.sends[index];
        return (
            expectedSend !== undefined &&
            send.busId === expectedSend.busId &&
            send.level === expectedSend.level &&
            send.preFader === expectedSend.preFader
        );
    });
}
