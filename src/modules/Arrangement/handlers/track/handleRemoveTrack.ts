import { automationStore, modulationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { getAllSidechainRoutes, wireSidechainRoutes } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { reconcileRoutingAfterRemoval } from '../../services/reconcileRoutingAfterRemoval';
import { readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
import { publishTrackRemoved } from '../../useCases/publishTrackRemoved';
import { removeTrack } from '../../useCases/removeTrack';
import { removeTrackModulationReferences } from '../../useCases/removeTrackModulationReferences';

// Local structural shapes (AGENTS.md model isolation). These match the minimum
// guarantees of MIDI's store entries — used purely to produce inverse-action snapshots.
type MidiNoteEntry = { readonly id: string };
type MidiCcEntry = { readonly id: string };
type MidiPitchBendEntry = { readonly id: string };
type RemoveTrackAction = Extract<AppAction, { type: 'removeTrack' }>;

function currentStateMatches(action: RemoveTrackAction): boolean {
    const currentTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
    const hasStateGuard =
        action.payload.expectedKind !== undefined ||
        action.payload.expectedMuted !== undefined ||
        action.payload.expectedClipIds !== undefined ||
        action.payload.expectedAlternativeClipIds !== undefined ||
        action.payload.expectedVcaGroupId !== undefined ||
        action.payload.expectedVcaMembershipGroupIds !== undefined;
    if (!currentTrack) {
        return !hasStateGuard;
    }
    if (action.payload.expectedKind !== undefined && currentTrack.kind !== action.payload.expectedKind) {
        return false;
    }
    if (action.payload.expectedMuted !== undefined && currentTrack.muted !== action.payload.expectedMuted) {
        return false;
    }
    if (action.payload.expectedClipIds !== undefined) {
        const currentClipIds = currentTrack.clips.map((clip) => clip.id);
        if (
            currentClipIds.length !== action.payload.expectedClipIds.length ||
            currentClipIds.some((clipId, index) => clipId !== action.payload.expectedClipIds?.[index])
        ) {
            return false;
        }
    }
    if (action.payload.expectedAlternativeClipIds !== undefined) {
        const currentAlternativeClipIds = currentTrack.alternatives.flatMap((alternative) =>
            alternative.clips.map((clip) => clip.id)
        );
        if (
            currentAlternativeClipIds.length !== action.payload.expectedAlternativeClipIds.length ||
            currentAlternativeClipIds.some(
                (clipId, index) => clipId !== action.payload.expectedAlternativeClipIds?.[index]
            )
        ) {
            return false;
        }
    }
    if (
        action.payload.expectedVcaGroupId !== undefined &&
        (currentTrack.vcaGroupId ?? null) !== action.payload.expectedVcaGroupId
    ) {
        return false;
    }
    if (action.payload.expectedVcaMembershipGroupIds !== undefined) {
        const currentVcaMembershipGroupIds = getVcaGroupsState()
            .filter((group) => group.trackIds.includes(action.payload.trackId))
            .map((group) => group.id)
            .sort();
        const expectedVcaMembershipGroupIds = [...action.payload.expectedVcaMembershipGroupIds].sort();
        if (
            currentVcaMembershipGroupIds.length !== expectedVcaMembershipGroupIds.length ||
            currentVcaMembershipGroupIds.some((groupId, index) => groupId !== expectedVcaMembershipGroupIds[index])
        ) {
            return false;
        }
    }
    return true;
}

export const handleRemoveTrack = createHandler<'removeTrack'>({
    validate: (action) => currentStateMatches(action),
    execute: (action) => {
        if (!currentStateMatches(action)) {
            return { status: 'conflict' };
        }
        const result = removeTrack(action.payload.trackId, {
            deferRuntimeEffects: true,
            suppressRemovedEvent: true,
        });
        if (!result.removed) {
            return { status: 'no-write' };
        }
        const finalizeModulationRemoval = removeTrackModulationReferences({
            trackId: action.payload.trackId,
            deferRuntimeEffects: true,
        });
        return {
            status: 'written',
            afterCommit: () =>
                runAllAsyncEffects([
                    result.finalizeRuntimeRemoval,
                    finalizeModulationRemoval.afterCommit,
                    () => publishTrackRemoved({ trackId: action.payload.trackId }),
                ]),
            afterAmbiguousCommit: async () => {
                const committedTrack = getTrackStoreState()?.tracks.find(
                    (candidate) => candidate.id === action.payload.trackId
                );
                const effects: Array<() => void | Promise<void>> = [
                    finalizeModulationRemoval.afterAmbiguousCommit,
                    () => wireSidechainRoutes(),
                ];
                if (committedTrack) {
                    effects.unshift(() => {
                        projectTrackToLiveStrip({
                            trackId: committedTrack.id,
                            activateDormantExternalPlugins: true,
                        });
                    });
                } else {
                    effects.unshift(result.finalizeRuntimeRemoval, () =>
                        publishTrackRemoved({ trackId: action.payload.trackId })
                    );
                }
                try {
                    await runAllAsyncEffects(effects);
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    throw new Error(`Track runtime reconciliation failed; manual repair required: ${reason}`, {
                        cause: error,
                    });
                }
            },
        };
    },
    describe: (alpha) => {
        // Snapshot everything that removeTrack will delete, so the inverse
        // action (`restoreTrack`) can replay it. Runs pre-execute.
        const trackState = getTrackStoreState();
        const trackIndex = trackState?.tracks.findIndex((track) => track.id === alpha.payload.trackId) ?? -1;
        const track = trackIndex >= 0 ? trackState?.tracks[trackIndex] : undefined;
        if (!track) {
            return { label: 'Remove track' };
        }

        const trackSnapshot = structuredClone(track);
        const remainingTracks = trackState?.tracks.filter((candidate) => candidate.id !== alpha.payload.trackId) ?? [];
        const reconciledTracks = reconcileRoutingAfterRemoval({
            removedTrackId: alpha.payload.trackId,
            removedOutputId: track.outputId,
            remainingTracks,
        }).tracks;
        const reconciledById = new Map(reconciledTracks.map((candidate) => [candidate.id, candidate]));
        const routingPatches = structuredClone(
            remainingTracks
                .filter(
                    (candidate) =>
                        candidate.outputId === alpha.payload.trackId ||
                        candidate.sends.some((send) => send.busId === alpha.payload.trackId)
                )
                .map((candidate) => {
                    const reconciled = reconciledById.get(candidate.id);
                    if (!reconciled) {
                        throw new Error(`Missing reconciled routing state for track: ${candidate.id}`);
                    }
                    return {
                        trackId: candidate.id,
                        expected: { outputId: reconciled.outputId, sends: reconciled.sends },
                        replacement: { outputId: candidate.outputId, sends: candidate.sends },
                    };
                })
        );

        const autoState = automationStore.value;
        const autoLanes = autoState ? autoState.lanes.filter((length) => length.trackId === alpha.payload.trackId) : [];
        const automationLaneSnapshots = structuredClone(autoLanes);

        const midiState = midiStore.value;
        const clipIds = collectTrackClipIds(track);
        const midiNotesByClipId: Record<string, readonly MidiNoteEntry[]> = {};
        const midiCcByClipId: Record<string, readonly MidiCcEntry[]> = {};
        const midiPitchBendByClipId: Record<string, readonly MidiPitchBendEntry[]> = {};
        if (midiState) {
            for (const cid of clipIds) {
                if (midiState.notesByClipId[cid]) {
                    midiNotesByClipId[cid] = structuredClone(midiState.notesByClipId[cid]);
                }
                if (midiState.ccByClipId[cid]) {
                    midiCcByClipId[cid] = structuredClone(midiState.ccByClipId[cid]);
                }
                if (midiState.pitchBendByClipId[cid]) {
                    midiPitchBendByClipId[cid] = structuredClone(midiState.pitchBendByClipId[cid]);
                }
            }
        }

        const clipSatellites = clipIds
            .map((clipId) => readClipSatelliteEntry(clipId))
            .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null);

        const takeLaneState = takeLaneStore.value;
        const takeLanes = takeLaneState
            ? takeLaneState.lanes.filter((length) => length.trackId === alpha.payload.trackId)
            : [];
        const takeLaneSnapshots = structuredClone(takeLanes);
        const sidechainRouteSnapshots = structuredClone(
            getAllSidechainRoutes().filter(
                (route) =>
                    route.sourceTrackId === alpha.payload.trackId || route.targetTrackId === alpha.payload.trackId
            )
        );
        const modulationState = modulationStore.value;
        const ownedModulatorSnapshots = structuredClone(
            modulationState?.modulators.filter((modulator) => modulator.trackId === alpha.payload.trackId) ?? []
        );
        const incomingModulationMappingSnapshots = structuredClone(
            modulationState?.modulators
                .filter((modulator) => modulator.trackId !== alpha.payload.trackId)
                .flatMap((modulator) =>
                    modulator.mappings
                        .filter((mapping) => mapping.targetTrackId === alpha.payload.trackId)
                        .map((mapping) => ({ modulatorId: modulator.id, mapping }))
                ) ?? []
        );

        return {
            label: `Remove track "${track.name}"`,
            inverseAction: {
                type: 'restoreTrack',
                payload: {
                    trackId: alpha.payload.trackId,
                    trackSnapshot,
                    trackName: track.name,
                    trackKind: track.kind,
                    trackGain: track.gain,
                    trackParentId: track.parentId,
                    trackIndex,
                    wasSelected: trackState?.selectedTrackId === alpha.payload.trackId,
                    routingPatches,
                    automationLaneSnapshots,
                    clipSatellites,
                    midiNotesByClipId,
                    midiCcByClipId,
                    midiPitchBendByClipId,
                    takeLaneSnapshots,
                    sidechainRouteSnapshots,
                    ownedModulatorSnapshots,
                    incomingModulationMappingSnapshots,
                },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
