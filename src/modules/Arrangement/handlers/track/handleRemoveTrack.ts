import { automationStore, modulationStore } from '#/modules/Automation/stores';
import { removeMapping, removeModulator } from '#/modules/Automation/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { createHandler } from '#/utils/createHandler';

import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeTrack } from '../../useCases/removeTrack';

// Local structural shapes (AGENTS.md model isolation). These match the minimum
// guarantees of MIDI's store entries — used purely to produce inverse-action snapshots.
type MidiNoteEntry = { readonly id: string };
type MidiCcEntry = { readonly id: string };
type MidiPitchBendEntry = { readonly id: string };

/**
 * Drop every modulation reference to a removed track: modulators it owns become
 * dangling (their bindings can never resolve once the track is gone), and any
 * modulator on another track that maps INTO the removed track holds a mapping
 * that can never resolve. Removing both keeps the modulation store consistent
 * with `trackStore`. Reverting the engine param is a no-op here (the device is
 * already gone), but `removeModulator`/`removeMapping` still clean the store and
 * runtime values. Runs after `removeTrack` so the snapshot captured in
 * `describe` (pre-execute) is unaffected.
 *
 * Note: `restoreTrack` does not yet restore deleted modulators — the inverse
 * action snapshot covers automation/MIDI/take lanes but not modulation.
 */
function reconcileModulatorsForRemovedTrack(trackId: string): void {
    const modState = modulationStore.value;
    if (!modState) {
        return;
    }
    // Snapshot ids/targets first; both helpers mutate the store as they go.
    const ownedIds = modState.modulators.filter((m) => m.trackId === trackId).map((m) => m.id);
    const crossTrackMappings = modState.modulators
        .filter((m) => m.trackId !== trackId)
        .flatMap((m) =>
            m.mappings
                .filter((mapping) => mapping.targetTrackId === trackId)
                .map((mapping) => ({
                    modulatorId: m.id,
                    targetTrackId: mapping.targetTrackId,
                    targetDeviceId: mapping.targetDeviceId,
                    targetParamId: mapping.targetParamId,
                }))
        );

    for (const id of ownedIds) {
        removeModulator(id);
    }
    for (const { modulatorId, ...target } of crossTrackMappings) {
        removeMapping(modulatorId, target);
    }
}

export const handleRemoveTrack = createHandler<'removeTrack'>({
    execute: (action) => {
        removeTrack(action.payload.trackId);
        reconcileModulatorsForRemovedTrack(action.payload.trackId);
    },
    describe: (alpha) => {
        // Snapshot everything that removeTrack will delete, so the inverse
        // action (`restoreTrack`) can replay it. Runs pre-execute.
        const track = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        if (!track) {
            return { label: 'Remove track' };
        }

        const trackSnapshot = structuredClone(track);

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

        return {
            label: 'Remove track',
            inverseAction: {
                type: 'restoreTrack',
                payload: {
                    trackId: alpha.payload.trackId,
                    trackSnapshot,
                    automationLaneSnapshots,
                    midiNotesByClipId,
                    midiCcByClipId,
                    midiPitchBendByClipId,
                    takeLaneSnapshots,
                },
            },
        };
    },
    undoable: true,
});
