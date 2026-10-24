import {
    commitRecordedControllers,
    discardRecordedControllers,
    getMidiStoreState,
    planRecordedControllers,
} from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type Clip } from '../../stores/trackStore';
import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type CommitRecordingAction = Extract<AppAction, { type: 'commitRecording' }>;

function owningTrackExists(action: CommitRecordingAction): boolean {
    return getTrackStoreState()?.tracks.some((candidate) => candidate.id === action.payload.clip.trackId) === true;
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
 * The clip's rows as the redo restores them: the rows the store holds now, then
 * the rows the commit is about to write after them, so the snapshot names what
 * the store will hold. `null` when the clip has no list at all.
 */
function snapshotRows<TRow>(stored: readonly TRow[] | undefined, planned: readonly TRow[]): TRow[] | null {
    if (stored === undefined && planned.length === 0) {
        return null;
    }
    const existing = stored ?? [];
    return structuredClone([...existing, ...planned]);
}

/**
 * Materialize one completed recording gesture into its track, updating the
 * provisional clip the recorder opened under the same id.
 *
 * The forward write is the clip alone: the take lane and the takes were staged
 * while capture ran, and `describe` — which runs before this write, against the
 * live staged state — captures them into the entry's explicit redo, together
 * with the clip's MIDI data, which the removal inverse deletes. That is what
 * makes one undo remove the recorded clip, its take-lane membership, and its
 * notes together, and one redo put the same clip id, placement, takes, and notes
 * back. The write updates the live clip rather than replacing it, so a field the
 * payload does not carry survives — the base finalizer's updater could not lose
 * one either.
 */
export const handleCommitRecording = createHandler<'commitRecording'>({
    validate: owningTrackExists,
    execute: (action) => {
        const { clip } = action.payload;
        if (!owningTrackExists(action)) {
            // The commit will never land, so nothing will claim the take's
            // buffered controllers; they are dropped, never written.
            discardRecordedControllers(clip.id);
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
        // The controllers a MIDI take recorded wait in memory until this write,
        // inside the commit's storage transaction, so a commit that does not
        // land leaves none of them in the store.
        if (clip.type === 'midi') {
            commitRecordedControllers({ clip: withMinimumRecordingLength(clip) });
        }
        return toHandlerExecutionResult(true);
    },
    describe: (action) => {
        const { clip } = action.payload;
        // The inverse removes the clip through the ordinary removal path, which
        // deletes the clip's MIDI data. Carry it on the redo exactly as the
        // clip-restore route does, so undoing and redoing a recorded MIDI take
        // does not hand back an empty clip. The take's buffered controllers
        // are not in the store yet; they are added from the buffer, which this
        // only reads, so the snapshot holds the rows `execute` then writes.
        const midiState = getMidiStoreState();
        const planned =
            clip.type === 'midi' ? planRecordedControllers({ clip: withMinimumRecordingLength(clip) }) : null;
        const notes = midiState?.notesByClipId[clip.id];
        const cc = snapshotRows(midiState?.ccByClipId[clip.id], planned?.cc ?? []);
        const pitchBend = snapshotRows(midiState?.pitchBendByClipId[clip.id], planned?.pitchBend ?? []);
        return {
            label: `Record clip "${clip.name}"`,
            inverseAction: { type: 'discardRecording', payload: { clipId: clip.id } },
            redoAction: {
                type: 'restoreRecording',
                payload: {
                    clip: withMinimumRecordingLength(clip),
                    retiredTakeLanes: captureRetiredTakeLanes([clip.id]),
                    midiNotesSnapshot: notes ? structuredClone(notes) : null,
                    midiCcSnapshot: cc,
                    midiPitchBendSnapshot: pitchBend,
                },
            },
        };
    },
    undoable: true,
});
