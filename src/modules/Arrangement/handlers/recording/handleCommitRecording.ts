import { getMidiStoreState, restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { isRecordingPassId } from '#/utils/recordingPassId';
import { type AppAction } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Clip } from '../../stores/trackStore';
import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type CommitRecordingAction = Extract<AppAction, { type: 'commitRecording' }>;

function owningTrackExists(action: CommitRecordingAction): boolean {
    const { clip, midiRecording } = action.payload;
    if (getTrackStoreState()?.tracks.some((candidate) => candidate.id === clip.trackId) !== true) return false;
    if (midiRecording === undefined) return true;
    if (clip.type !== 'midi') return false;
    const takes = midiRecording.takeLanes.flatMap(({ lane }) => lane.takes.filter((take) => take.clipId === clip.id));
    const passIds = new Set<string>();
    for (const take of takes) {
        if (take.endBeat <= take.startBeat) return false;
        if (take.recordingPassId !== undefined) {
            if (!isRecordingPassId(take.recordingPassId) || passIds.has(take.recordingPassId)) return false;
            passIds.add(take.recordingPassId);
        }
    }
    return (
        midiRecording.takeLanes.every(({ lane }) => lane.trackId === clip.trackId) &&
        midiRecording.data.notes.value.every(
            (note) =>
                note.recordingPassId === undefined ||
                (isRecordingPassId(note.recordingPassId) && passIds.has(note.recordingPassId))
        )
    );
}

function writeMidiRecording(action: CommitRecordingAction): void {
    const { clip, midiRecording } = action.payload;
    if (midiRecording === undefined) return;
    const state = takeLaneStore.value;
    if (!state) throw new Error('Recording take-lane owner is unavailable');
    const lanes = state.lanes.map((lane) => ({
        ...lane,
        takes: lane.takes.filter((take) => take.clipId !== clip.id),
        activeCompRegions: lane.activeCompRegions.filter(
            (region) => !lane.takes.some((take) => take.clipId === clip.id && take.id === region.takeId)
        ),
    }));
    for (const snapshot of midiRecording.takeLanes) {
        const takes = snapshot.lane.takes.filter((take) => take.clipId === clip.id);
        const index = lanes.findIndex((lane) => lane.trackId === clip.trackId);
        if (index < 0)
            lanes.push({ ...structuredClone(snapshot.lane), takes: structuredClone(takes), activeCompRegions: [] });
        else lanes[index] = { ...lanes[index]!, takes: [...lanes[index]!.takes, ...structuredClone(takes)] };
    }
    takeLaneStore.set({ lanes });
    const { data } = midiRecording;
    restoreMidiClipData({
        clipId: clip.id,
        notesSnapshot: data.notes.present ? data.notes.value : null,
        controlChangeSnapshot: data.controlChanges.present ? data.controlChanges.value : null,
        pitchBendSnapshot: data.pitchBends.present ? data.pitchBends.value : null,
    });
}

/**
 * A recording clip honours the one-beat minimum its live finaliser applies:
 * `stopRecording` floors every recording clip's end to `startBeat + 1` and
 * gives its take-lane entry the same minimum, so the take never names timeline
 * the clip does not cover (#4994). The ordinary audio capture terminal commits
 * buffer-truth beats, which for a very short capture land inside that minimum
 * and would overwrite the floored live end here. Flooring the payload — on the
 * durable write and on the entry's redo clip alike — keeps the committed clip,
 * its restored copy, and its take in agreement. A payload that already honours
 * the minimum (a MIDI commit carries the floored end) is unchanged.
 */
function withMinimumRecordingLength<TClip extends { startBeat: number; endBeat: number }>(clip: TClip): TClip {
    return { ...clip, endBeat: Math.max(clip.startBeat + 1, clip.endBeat) };
}

/**
 * Materialize one completed recording gesture into its track, updating the
 * provisional clip the recorder opened under the same id.
 *
 * New MIDI captures carry a sealed gesture: the forward transaction writes its
 * notes and take identities together with the clip, and redo reads that frozen
 * payload. Audio and older callers retain the staged-state snapshot path.
 * Updating the provisional clip preserves fields omitted from the payload.
 */
export const handleCommitRecording = createHandler<'commitRecording'>({
    validate: owningTrackExists,
    execute: (action) => {
        const { clip } = action.payload;
        if (!owningTrackExists(action)) {
            return toHandlerExecutionResult(false);
        }
        const recorded = structuredClone(withMinimumRecordingLength(clip)) as Clip;
        updateTrack(clip.trackId, (time) => {
            if (!time.clips.some((existing) => existing.id === clip.id)) {
                return { ...time, clips: [...time.clips, recorded] };
            }
            return {
                ...time,
                clips: time.clips.map((existing) =>
                    existing.id === clip.id ? { ...existing, ...recorded } : existing
                ),
            };
        });
        writeMidiRecording(action);
        return toHandlerExecutionResult(true);
    },
    describe: (action) => {
        const { clip } = action.payload;
        // The inverse removes the clip through the ordinary removal path, which
        // deletes the clip's MIDI data. Carry it on the redo exactly as the
        // clip-restore route does, so undoing and redoing a recorded MIDI take
        // does not hand back an empty clip.
        const midiState = getMidiStoreState();
        const frozen = action.payload.midiRecording;
        const notes = frozen?.data.notes.value ?? midiState?.notesByClipId[clip.id];
        const cc = frozen?.data.controlChanges.value ?? midiState?.ccByClipId[clip.id];
        const pitchBend = frozen?.data.pitchBends.value ?? midiState?.pitchBendByClipId[clip.id];
        return {
            label: `Record clip "${clip.name}"`,
            inverseAction: { type: 'discardRecording', payload: { clipId: clip.id } },
            redoAction: {
                type: 'restoreRecording',
                payload: {
                    clip: withMinimumRecordingLength(clip),
                    retiredTakeLanes: frozen?.takeLanes ?? captureRetiredTakeLanes([clip.id]),
                    midiNotesSnapshot: notes ? structuredClone(notes) : null,
                    midiCcSnapshot: cc ? structuredClone(cc) : null,
                    midiPitchBendSnapshot: pitchBend ? structuredClone(pitchBend) : null,
                },
            },
        };
    },
    undoable: true,
});
