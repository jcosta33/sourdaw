import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeTrack } from '../../useCases/removeTrack';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { automationStore } from '#/modules/Automation';
import { createHandler } from '#/helpers/createHandler';
import { midiStore } from '#/modules/MIDI/stores';

export const handleRemoveTrack = createHandler<'removeTrack'>({
    execute: (action) => {
        removeTrack(action.payload.trackId);
    },
    describe: (a) => {
        // Snapshot everything that removeTrack will delete, so the inverse
        // action (`restoreTrack`) can replay it. Runs pre-execute.
        const track = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
        if (!track) {
            return { label: 'Remove track' };
        }

        const trackSnapshot = structuredClone(track);

        const autoState = automationStore.value;
        const autoLanes = autoState ? autoState.lanes.filter((l) => l.trackId === a.payload.trackId) : [];
        const automationLaneSnapshots = structuredClone(autoLanes);

        const midiState = midiStore.value;
        const clipIds = track.clips.map((c) => c.id);
        const midiNotesByClipId: Record<string, unknown> = {};
        const midiCcByClipId: Record<string, unknown> = {};
        const midiPitchBendByClipId: Record<string, unknown> = {};
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
        const takeLanes = takeLaneState ? takeLaneState.lanes.filter((l) => l.trackId === a.payload.trackId) : [];
        const takeLaneSnapshots = structuredClone(takeLanes);

        return {
            label: 'Remove track',
            inverseAction: {
                type: 'restoreTrack',
                payload: {
                    trackId: a.payload.trackId,
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
