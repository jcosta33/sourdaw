import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { type Clip } from '../../models/TrackViewTypes';
import { getNotesForClip } from '../midiNoteCrud/getNotesForClip';
import { setNotesForClip } from '../midiNoteCrud/setNotesForClip';

/**
 * Propagate parent MIDI notes to all linked instances.
 * Called after editing notes on a parent clip.
 * Instances that override 'notes' are skipped.
 */
export function propagateParentChanges(parentClipId: string): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    let parentClip: Clip | undefined;
    for (const track of state.tracks) {
        parentClip = track.clips.find((c) => c.id === parentClipId);
        if (parentClip) {
            break;
        }
    }
    if (!parentClip) {
        return;
    }

    const parentNotes = getNotesForClip(parentClipId);

    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.parentClipId !== parentClipId) {
                continue;
            }
            if (clip.overrides?.notes) {
                continue;
            }

            const offset = clip.startBeat - parentClip.startBeat;
            const clonedNotes = parentNotes.map((n) => ({
                ...n,
                id: `note-inst-${crypto.randomUUID().slice(0, 8)}`,
                startBeat: n.startBeat + offset,
            }));
            setNotesForClip(clip.id, clonedNotes);
        }
    }
}