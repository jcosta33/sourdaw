import { createHandler } from '#/helpers/createHandler';
import { automationStore } from '#/modules/Automation';
import { midiStore } from '#/modules/MIDI/stores';
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
    execute: (a) => {
        const {
            trackSnapshot,
            automationLaneSnapshots,
            midiNotesByClipId,
            midiCcByClipId,
            midiPitchBendByClipId,
            takeLaneSnapshots,
        } = a.payload;

        const state = getTrackStoreState();
        if (state) {
            setTrackState({ ...state, tracks: [...state.tracks, trackSnapshot as never] });
        }

        if (automationLaneSnapshots.length > 0) {
            const auto = automationStore.value;
            if (auto) {
                automationStore.set({ lanes: [...auto.lanes, ...(automationLaneSnapshots as never[])] });
            }
        }

        const midi = midiStore.value;
        if (midi) {
            midiStore.set({
                notesByClipId: { ...midi.notesByClipId, ...(midiNotesByClipId as Record<string, never>) },
                ccByClipId: { ...midi.ccByClipId, ...(midiCcByClipId as Record<string, never>) },
                pitchBendByClipId: {
                    ...midi.pitchBendByClipId,
                    ...(midiPitchBendByClipId as Record<string, never>),
                },
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
