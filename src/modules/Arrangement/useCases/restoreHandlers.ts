import { type ActionHandler, type AppAction } from '#/modules/Command';
import { setTrackState } from '#/modules/Arrangement/repositories/track/setTrackState';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { automationStore } from '#/modules/Automation';
import { midiStore } from '#/modules/MIDI';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { undoRippleDelete } from '#/modules/Workspace';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

/**
 * Inverse-action handlers for the removeTrack / removeClip destructive commands.
 * Each handler replays snapshot data carried in the action payload — it does not
 * compute state itself. These handlers are emitted by `removeTrack` / `removeClip`
 * handlers' `describe()` as `inverseAction`, giving destructive operations a typed,
 * command-pattern undo path (replacing the previous `pushUndoEntry`-in-handler
 * escape hatch; see audit-006).
 *
 * `undoable: false` — these actions are only invoked by the undo machinery itself
 * and must not create their own undo entries.
 */
export const restoreHandlers = {
    restoreTrack: {
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
    } satisfies ActionHandler<Extract<AppAction, 'restoreTrack'>>,

    restoreClip: {
        execute: (a) => {
            const {
                clipId,
                trackId,
                clipSnapshot,
                ripplePlan,
                midiNotesSnapshot,
                midiCcSnapshot,
                midiPitchBendSnapshot,
            } = a.payload;

            if (ripplePlan) {
                undoRippleDelete(trackId, ripplePlan.removedClips as never, ripplePlan.shiftedClips as never);
            } else {
                updateTrack(trackId, (t) => ({ ...t, clips: [...t.clips, clipSnapshot as never] }));
            }

            const midi = midiStore.value;
            if (midi && (midiNotesSnapshot || midiCcSnapshot || midiPitchBendSnapshot)) {
                midiStore.set({
                    notesByClipId: midiNotesSnapshot
                        ? { ...midi.notesByClipId, [clipId]: midiNotesSnapshot as never }
                        : midi.notesByClipId,
                    ccByClipId: midiCcSnapshot
                        ? { ...midi.ccByClipId, [clipId]: midiCcSnapshot as never }
                        : midi.ccByClipId,
                    pitchBendByClipId: midiPitchBendSnapshot
                        ? { ...midi.pitchBendByClipId, [clipId]: midiPitchBendSnapshot as never }
                        : midi.pitchBendByClipId,
                });
            }
        },
        describe: () => ({ label: 'Restore clip' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'restoreClip'>>,
};
