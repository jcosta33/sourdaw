import { restoreAutomationLanes, restoreTrackModulationReferences } from '#/modules/Automation/useCases';
import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { ensureBusStrip, restoreSidechainRoutes, setBusGain, wireSidechainRoutes } from '#/modules/Routing/useCases';
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
    validate: (action) => restoreStateMatches(action),
    execute: (alpha) => {
        const {
            trackSnapshot,
            trackName,
            trackKind,
            trackGain,
            trackParentId,
            trackIndex,
            batchRestoreTracks = [],
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
        if (!state || !restoreStateMatches(alpha)) {
            return { status: 'conflict' };
        }
        const batchRestoreTrackIds = new Set(batchRestoreTracks.map((track) => track.trackId));
        for (const patch of routingPatches) {
            if (batchRestoreTrackIds.has(patch.trackId)) {
                continue;
            }
            const current = state.tracks.find((track) => track.id === patch.trackId);
            if (!current || !hasExpectedRoutingState(current, patch.expected)) {
                return { status: 'conflict' };
            }
        }
        const routingPatchById = new Map(routingPatches.map((patch) => [patch.trackId, patch]));
        const tracks = state.tracks.map((track) => {
            const patch = routingPatchById.get(track.id);
            if (!patch || batchRestoreTrackIds.has(track.id)) {
                return track;
            }
            return {
                ...track,
                outputId: patch.replacement.outputId,
                sends: patch.replacement.sends.map((send) => ({ ...send })),
            };
        });
        const missingEarlierSiblingCount = batchRestoreTracks.filter(
            (candidate) =>
                candidate.trackId !== alpha.payload.trackId &&
                candidate.trackIndex < trackIndex &&
                !state.tracks.some((track) => track.id === candidate.trackId)
        ).length;
        const insertionIndex = Math.min(Math.max(trackIndex - missingEarlierSiblingCount, 0), tracks.length);
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
            afterAmbiguousCommit: async () => {
                const committedState = getTrackStoreState();
                const committedTrack = committedState?.tracks.find((track) => track.id === alpha.payload.trackId);
                if (!committedState || !committedTrack) {
                    wireSidechainRoutes();
                    return;
                }
                const effects: Array<() => void | Promise<void>> = [];
                if (committedTrack.kind === 'bus') {
                    effects.push(
                        () => ensureBusStrip(committedTrack.id),
                        () => setBusGain(committedTrack.id, committedTrack.gain)
                    );
                }
                effects.push(() =>
                    projectTrackToLiveStrip({
                        trackId: committedTrack.id,
                        deferSidechainWiring: true,
                        activateDormantExternalPlugins: true,
                    })
                );
                for (const patch of routingPatches) {
                    if (committedState.tracks.some((track) => track.id === patch.trackId)) {
                        effects.push(() =>
                            projectTrackToLiveStrip({
                                trackId: patch.trackId,
                                deferSidechainWiring: true,
                            })
                        );
                    }
                }
                effects.push(
                    () => refreshToasterPadBindings(committedState.tracks, committedTrack.parentId),
                    () => wireSidechainRoutes(),
                    () =>
                        publishTrackAdded({
                            trackId: committedTrack.id,
                            name: committedTrack.name,
                            kind: committedTrack.kind,
                        })
                );
                await runAllAsyncEffects(effects);
            },
        };
    },
    describe: () => ({ label: 'Restore track' }),
    requiresAbortCompensation: false,
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

function restoreStateMatches(
    action: Extract<import('#/utils/handlerContract').AppAction, { type: 'restoreTrack' }>
): boolean {
    const state = getTrackStoreState();
    if (!state || state.tracks.some((track) => track.id === action.payload.trackId)) {
        return false;
    }
    const batchRestoreTrackIds = new Set(action.payload.batchRestoreTracks?.map((track) => track.trackId) ?? []);
    return action.payload.routingPatches.every((patch) => {
        if (batchRestoreTrackIds.has(patch.trackId)) {
            return true;
        }
        const current = state.tracks.find((track) => track.id === patch.trackId);
        return current !== undefined && hasExpectedRoutingState(current, patch.expected);
    });
}
