import { automationStore, modulationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { reconcileRoutingAfterRemoval } from '../../services/reconcileRoutingAfterRemoval';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { publishTrackRemoved } from '../../useCases/publishTrackRemoved';
import { removeTrack } from '../../useCases/removeTrack';
import { removeTrackModulationReferences } from '../../useCases/removeTrackModulationReferences';

// Local structural shapes (AGENTS.md model isolation). These match the minimum
// guarantees of MIDI's store entries — used purely to produce inverse-action snapshots.
type MidiNoteEntry = { readonly id: string };
type MidiCcEntry = { readonly id: string };
type MidiPitchBendEntry = { readonly id: string };

export const handleRemoveTrack = createHandler<'removeTrack'>({
    execute: (action) => {
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
                    finalizeModulationRemoval,
                    () => publishTrackRemoved({ trackId: action.payload.trackId }),
                ]),
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
            label: 'Remove track',
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
    undoable: true,
});
