import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { createHandler } from '#/utils/createHandler';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeTrack } from '../../useCases/removeTrack';

// Local structural shapes (AGENTS.md model isolation). These match the minimum
// guarantees of MIDI's store entries — used purely to produce inverse-action snapshots.
type MidiNoteEntry = { readonly id: string };
type MidiCcEntry = { readonly id: string };
type MidiPitchBendEntry = { readonly id: string };

export const handleRemoveTrack = createHandler<'removeTrack'>({
    execute: (action) => {
        removeTrack(action.payload.trackId);
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
        const clipIds = track.clips.map((context) => context.id);
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
