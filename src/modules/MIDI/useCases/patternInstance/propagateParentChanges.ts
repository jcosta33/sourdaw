import { trackStore } from '#/modules/Arrangement/stores';

import { type Clip } from '../../models/TrackViewTypes';
import { getNotesForClip } from '../midiNoteCrud/getNotesForClip';
import { setNotesForClip } from '../midiNoteCrud/setNotesForClip';

/**
 * Propagate parent MIDI notes to all linked instances.
 * Called after editing notes on a parent clip.
 * Instances that override 'notes' are skipped.
 */
export function propagateParentChanges(parentClipId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    let parentClip: Clip | undefined;
    for (const track of state.tracks) {
        parentClip = track.clips.find((context) => context.id === parentClipId);
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

            const clonedNotes = parentNotes.map((node) => ({
                ...node,
                // Derive a stable child id from the (child clip, parent note) pair so
                // re-propagation after a parent edit preserves note identity instead of
                // minting a fresh id on every pass. Notes are clip-relative, so the
                // parent's beats carry over verbatim (M-142).
                id: `note-inst-${clip.id}-${node.id}`,
            }));
            setNotesForClip(clip.id, clonedNotes);
        }
    }
}
