import { automationStore, modulationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';

import { collectTrackClipIds } from '../services/collectTrackClipIds';
import { reconcileRoutingAfterRemoval } from '../services/reconcileRoutingAfterRemoval';
import { readClipSatelliteEntry } from '../stores/clipSatelliteState';
import { takeLaneStore } from '../stores/takeLaneStore';

import { getTrackStoreState } from './getTrackStoreState';

// Local structural shapes (AGENTS.md model isolation). These match the minimum
// guarantees of MIDI's store entries — used purely to produce inverse-action snapshots.
type MidiNoteEntry = { readonly id: string };
type MidiCcEntry = { readonly id: string };
type MidiPitchBendEntry = { readonly id: string };

/**
 * Snapshot everything `removeTrack` deletes for one track, so the inverse action
 * (`restoreTrack`) can replay it. Must run pre-execute, before the track is removed.
 * Returns `null` when the track does not exist.
 */
export function captureTrackRemovalSnapshot(trackId: string): RestoreTrackPayloadSnapshot | null {
    const trackState = getTrackStoreState();
    const trackIndex = trackState?.tracks.findIndex((track) => track.id === trackId) ?? -1;
    const track = trackIndex >= 0 ? trackState?.tracks[trackIndex] : undefined;
    if (!track) {
        return null;
    }

    const trackSnapshot = structuredClone(track);
    const remainingTracks = trackState?.tracks.filter((candidate) => candidate.id !== trackId) ?? [];
    const reconciledTracks = reconcileRoutingAfterRemoval({
        removedTrackId: trackId,
        removedOutputId: track.outputId,
        remainingTracks,
    }).tracks;
    const reconciledById = new Map(reconciledTracks.map((candidate) => [candidate.id, candidate]));
    const routingPatches = structuredClone(
        remainingTracks
            .filter(
                (candidate) => candidate.outputId === trackId || candidate.sends.some((send) => send.busId === trackId)
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
    const autoLanes = autoState ? autoState.lanes.filter((lane) => lane.trackId === trackId) : [];
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

    // Gain envelopes and warp state hang off clip identity rather than the track, so
    // removal drops them silently unless they are carried here. Only clips that actually
    // hold satellite state are recorded.
    const clipSatellites = clipIds
        .map((clipId) => readClipSatelliteEntry(clipId))
        .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null);

    const takeLaneState = takeLaneStore.value;
    const takeLanes = takeLaneState ? takeLaneState.lanes.filter((lane) => lane.trackId === trackId) : [];
    const takeLaneSnapshots = structuredClone(takeLanes);
    const sidechainRouteSnapshots = structuredClone(
        getAllSidechainRoutes().filter((route) => route.sourceTrackId === trackId || route.targetTrackId === trackId)
    );
    const modulationState = modulationStore.value;
    const ownedModulatorSnapshots = structuredClone(
        modulationState?.modulators.filter((modulator) => modulator.trackId === trackId) ?? []
    );
    const incomingModulationMappingSnapshots = structuredClone(
        modulationState?.modulators
            .filter((modulator) => modulator.trackId !== trackId)
            .flatMap((modulator) =>
                modulator.mappings
                    .filter((mapping) => mapping.targetTrackId === trackId)
                    .map((mapping) => ({ modulatorId: modulator.id, mapping }))
            ) ?? []
    );

    return {
        trackId,
        trackSnapshot,
        trackName: track.name,
        trackKind: track.kind,
        trackGain: track.gain,
        trackParentId: track.parentId,
        trackIndex,
        wasSelected: trackState?.selectedTrackId === trackId,
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
    };
}
