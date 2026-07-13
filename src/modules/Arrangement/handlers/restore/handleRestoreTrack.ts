import { restoreAutomationLanes } from '#/modules/Automation/useCases';
import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
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
            automationLaneSnapshots,
            midiNotesByClipId,
            midiCcByClipId,
            midiPitchBendByClipId,
            takeLaneSnapshots,
        } = alpha.payload;

        const state = getTrackStoreState();
        if (state) {
            setTrackState({ ...state, tracks: [...state.tracks, trackSnapshot as never] });
        }

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
    },
    describe: () => ({ label: 'Restore track' }),
    undoable: false,
});
