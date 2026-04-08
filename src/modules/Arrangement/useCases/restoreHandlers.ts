import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { setTrackState } from '#/modules/Arrangement/repositories/track/setTrackState';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { undoRippleDelete } from '#/modules/Workspace/useCases/rippleEditing';

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
export const executeRestoreTrack = inject({
    getTrackStoreState,
    setTrackState,
    automationStore,
    midiStore,
    takeLaneStore,
})(
    ({ getTrackStoreState, setTrackState, automationStore, midiStore, takeLaneStore }) =>
        function executeRestoreTrack(a: Extract<AppAction, 'restoreTrack'>): void {
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
        }
);

export const executeRestoreClip = inject({ updateTrack, undoRippleDelete, midiStore })(
    ({ updateTrack, undoRippleDelete, midiStore }) =>
        function executeRestoreClip(a: Extract<AppAction, 'restoreClip'>): void {
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
        }
);

export const restoreHandlers = {
    restoreTrack: {
        execute: executeRestoreTrack,
        describe: () => ({ label: 'Restore track' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'restoreTrack'>>,

    restoreClip: {
        execute: executeRestoreClip,
        describe: () => ({ label: 'Restore clip' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'restoreClip'>>,
};
