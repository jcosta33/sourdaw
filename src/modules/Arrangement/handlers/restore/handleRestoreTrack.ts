import { rearmCommittedTrackInputMonitoring } from '#/modules/AudioEngine/useCases';
import { restoreAutomationLanes, restoreTrackModulationReferences } from '#/modules/Automation/useCases';
import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { ensureBusStrip, restoreSidechainRoutes, setBusGain, wireSidechainRoutes } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { type TakeLane } from '../../models/TakeLane';
import { writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import { decodeTrackSnapshot, type Track } from '../../stores/trackStore';
import { captureTrackRemovalRuntimeAuthority } from '../../useCases/captureTrackRemovalRuntimeAuthority';
import { insertTakeLane } from '../../useCases/comping/insertTakeLane';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
import { publishTrackAdded } from '../../useCases/publishTrackAdded';
import { refreshToasterPadBindings } from '../../useCases/refreshToasterPadBindings';
import { setTrackState } from '../../useCases/setTrackState';
import { projectTrackThroughPriorBatchActions } from '../projectTrackThroughPriorBatchActions';

/**
 * Inverse-action handler for `removeTrack`. Replays snapshot data carried in the
 * action payload — does not compute state itself.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */
export const handleRestoreTrack = createHandler<'restoreTrack'>({
    canReapplyAfterDivergence: () => true,
    validate: (action, context) => restoreStateMatches(action, context),
    execute: (alpha) => {
        const {
            trackName,
            trackKind,
            trackGain,
            trackParentId,
            trackIndex,
            batchRestoreTracks = [],
            wasSelected,
            routingPatches,
            automationLaneSnapshots,
            clipSatellites,
            midiNotesByClipId,
            midiCcByClipId,
            midiPitchBendByClipId,
            sidechainRouteSnapshots,
            ownedModulatorSnapshots,
            incomingModulationMappingSnapshots,
        } = alpha.payload;

        const state = getTrackStoreState();
        const restored = decodeRestoredRows(alpha.payload);
        if (!state || !restored || !restoreStateMatches(alpha)) {
            return { status: 'conflict' };
        }
        const batchRestoreTrackIds = new Set(batchRestoreTracks.map((track) => track.trackId));
        if (!liveRoutingMatches(state.tracks, routingPatches, batchRestoreTrackIds)) {
            return { status: 'conflict' };
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
        const runtimeAuthority = captureTrackRemovalRuntimeAuthority();
        tracks.splice(insertionIndex, 0, restored.track);
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

        for (const entry of clipSatellites) {
            writeClipSatelliteEntry(entry);
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

        if (restored.takeLanes.length > 0) {
            // Merge each captured lane through the shared insert instead of
            // appending: a projection may have given the track a lane while it
            // was absent, and a second lane for one track is dead state that
            // `getTakeLaneForTrack` and the comp resolver never read (#4527).
            for (const lane of restored.takeLanes) {
                insertTakeLane(lane, takeLaneStore.value?.lanes.length ?? 0);
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
                    () => {
                        projectTrackToLiveStrip({
                            trackId: alpha.payload.trackId,
                            deferSidechainWiring: true,
                            activateDormantExternalPlugins: true,
                        });
                    },
                    ...routingPatches.map((patch) => () => {
                        projectTrackToLiveStrip({ trackId: patch.trackId, deferSidechainWiring: true });
                    }),
                    () => rearmCommittedTrackInputMonitoring(alpha.payload.trackId),
                    () => refreshToasterPadBindings(tracks, trackParentId),
                    finalizeSidechainRestore,
                    () =>
                        publishTrackAdded({
                            trackId: alpha.payload.trackId,
                            name: trackName,
                            kind: trackKind,
                        })
                );
                return runAllAsyncEffects(effects.map(runtimeAuthority.guard));
            },
            afterAmbiguousCommit: async () => {
                if (!runtimeAuthority.isCurrent()) {
                    return;
                }
                const committedState = getTrackStoreState();
                const committedTrack = committedState?.tracks.find((track) => track.id === alpha.payload.trackId);
                if (!committedState || !committedTrack) {
                    runtimeAuthority.guard(() => wireSidechainRoutes())();
                    return;
                }
                const effects: Array<() => void | Promise<void>> = [];
                if (committedTrack.kind === 'bus') {
                    effects.push(
                        () => ensureBusStrip(committedTrack.id),
                        () => setBusGain(committedTrack.id, committedTrack.gain)
                    );
                }
                effects.push(() => {
                    projectTrackToLiveStrip({
                        trackId: committedTrack.id,
                        deferSidechainWiring: true,
                        activateDormantExternalPlugins: true,
                    });
                });
                for (const patch of routingPatches) {
                    if (committedState.tracks.some((track) => track.id === patch.trackId)) {
                        effects.push(() => {
                            projectTrackToLiveStrip({
                                trackId: patch.trackId,
                                deferSidechainWiring: true,
                            });
                        });
                    }
                }
                effects.push(
                    () => rearmCommittedTrackInputMonitoring(committedTrack.id),
                    () => refreshToasterPadBindings(committedState.tracks, committedTrack.parentId),
                    () => wireSidechainRoutes(),
                    () =>
                        publishTrackAdded({
                            trackId: committedTrack.id,
                            name: committedTrack.name,
                            kind: committedTrack.kind,
                        })
                );
                await runAllAsyncEffects(effects.map(runtimeAuthority.guard));
            },
        };
    },
    describe: () => ({ label: 'Restore track' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});

type RestoreTrackPayload = Extract<AppAction, { type: 'restoreTrack' }>['payload'];

/**
 * The payload's contract types name only identities; the capture writes whole
 * store rows. Decoding them through the stores' own row laws restores exactly
 * what the store held, and refuses a payload that is not a row of this track.
 */
function decodeRestoredRows(payload: RestoreTrackPayload): { track: Track; takeLanes: TakeLane[] } | null {
    const track = decodeTrackSnapshot(payload.trackSnapshot);
    const takeLanes = decodeExactTakeLaneSnapshots(payload.takeLaneSnapshots);
    if (
        track?.id !== payload.trackId ||
        !holdsOnlyOwnClips(track) ||
        !takeLanes ||
        takeLanes.some((lane) => lane.trackId !== payload.trackId)
    ) {
        return null;
    }
    return { track, takeLanes };
}

// Every clip a track holds, live or in a stored alternative copy, names that
// track: moves, paste and duplication rewrite `trackId`, and switching or
// deleting an alternative refuses a clip that names another track.
function holdsOnlyOwnClips(track: Track): boolean {
    return [track.clips, ...track.alternatives.map((alternative) => alternative.clips)].every((clips) =>
        clips.every((clip) => clip.trackId === track.id)
    );
}

type RoutingPatch = RestoreTrackPayload['routingPatches'][number];

function liveRoutingMatches(
    tracks: readonly Track[],
    routingPatches: readonly RoutingPatch[],
    batchRestoreTrackIds: ReadonlySet<string>
): boolean {
    return routingPatches.every((patch) => {
        if (batchRestoreTrackIds.has(patch.trackId)) {
            return true;
        }
        const current = tracks.find((track) => track.id === patch.trackId);
        return current !== undefined && hasExpectedRoutingState(current, patch.expected);
    });
}

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

/**
 * #3814 order sensitivity: a group's inverse batch replays newest-first, so a
 * `restoreTrack` whose `removeTrack` member committed LAST validates first,
 * against the live state that member's reconciliation produced — the plain
 * live read is then exact. A sibling CAN precede it when a later group member
 * edited a surviving track's routing (its own inverse — `setTrackOutput` is
 * self-inverse — runs before this restore): the preflight must read that
 * sibling's projected effect, or a group the sequential execution would
 * cleanly replay refuses here on every retry, wedging the group. Siblings
 * that do not touch the patched track project it unchanged.
 */
function projectedRoutingState(track: Track, context: HandlerValidationContext | undefined): RoutingState {
    if (!context) {
        return track;
    }
    return projectTrackThroughPriorBatchActions(track, context);
}

function restoreStateMatches(
    action: Extract<AppAction, { type: 'restoreTrack' }>,
    context?: HandlerValidationContext
): boolean {
    const state = getTrackStoreState();
    if (
        !state ||
        !decodeRestoredRows(action.payload) ||
        state.tracks.some((track) => track.id === action.payload.trackId)
    ) {
        return false;
    }
    const batchRestoreTrackIds = new Set(action.payload.batchRestoreTracks?.map((track) => track.trackId) ?? []);
    return action.payload.routingPatches.every((patch) => {
        if (batchRestoreTrackIds.has(patch.trackId)) {
            return true;
        }
        const current = state.tracks.find((track) => track.id === patch.trackId);
        if (current === undefined) {
            return false;
        }
        return hasExpectedRoutingState(projectedRoutingState(current, context), patch.expected);
    });
}
