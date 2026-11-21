import { trackStore } from '#/modules/Arrangement/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const FROZEN_TRACK_NOTE_EDIT_MESSAGE = 'This track is frozen. Unfreeze it to edit its notes.';

/**
 * A frozen track plays its rendered buffer and freeze staleness leaves note
 * content out, so a note edit there would change nothing audible and never
 * mark the track stale. Content stays locked until unfreeze (the writable
 * MIDI clip guard that action-routed edits pass refuses the same tracks).
 */
function isClipOnFrozenTrack(clipId: string): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    return tracks.some((track) => track.frozen === true && track.clips.some((clip) => clip.id === clipId));
}

/**
 * Refuses a piano-roll edit gesture when any of the clips it may write sits on
 * a frozen track: warns once and returns true so the caller drops the whole
 * gesture before it touches the MIDI store or pushes an undo entry. Call it
 * once per gesture, at the point the gesture would first write.
 */
export function refuseNoteEditOnFrozenTrack(clipIds: readonly (string | null)[]): boolean {
    const frozen = clipIds.some((clipId) => clipId !== null && isClipOnFrozenTrack(clipId));
    if (!frozen) {
        return false;
    }
    notifyUser(FROZEN_TRACK_NOTE_EDIT_MESSAGE, 'warning');
    return true;
}

type NoteEditKeyContext = { selectedCount: number; stepInput: boolean };

const VELOCITY_PRESET_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7']);

type KeyPress = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };

/** Keys that rewrite the selected notes outside step input. */
function isSelectionTransformKey({ key, metaKey, ctrlKey, shiftKey }: KeyPress): boolean {
    const hasModifier = metaKey || ctrlKey;
    if (key.startsWith('Arrow')) {
        return true;
    }
    if (key === 'S') {
        return shiftKey && !hasModifier;
    }
    return (key === 'l' || key === 'j') && !hasModifier && !shiftKey;
}

/** Whether a key press, on the piano roll canvas, writes notes given the current selection and mode. */
export function isNoteEditKey(event: KeyPress, { selectedCount, stepInput }: NoteEditKeyContext): boolean {
    if (event.key === 'd' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        return true;
    }
    if (selectedCount === 0) {
        return false;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
        return true;
    }
    return stepInput ? VELOCITY_PRESET_KEYS.has(event.key) : isSelectionTransformKey(event);
}

/**
 * Whether releasing the pointer now would commit a note write: a move, resize
 * or duplicate that produced a preview, or a click-stamp / chord stamp left
 * pending by a press on empty grid that did not become a rubber-band drag.
 */
export function willWriteNotes(
    mode: string,
    refs: {
        dragPreviewRef: { current: unknown };
        pendingStampRef: { current: unknown };
        rubberBandRef: { current: { w: number; h: number } | null };
    }
): boolean {
    if (mode === 'rubber-band') {
        const rubberBand = refs.rubberBandRef.current;
        const draggedOut = rubberBand !== null && (rubberBand.w > 2 || rubberBand.h > 2);
        return refs.pendingStampRef.current !== null && !draggedOut;
    }
    const movesNotes = mode === 'move' || mode === 'duplicate' || mode === 'resize-left' || mode === 'resize-right';
    return movesNotes && refs.dragPreviewRef.current !== null;
}
