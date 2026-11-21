import { trackStore } from '#/modules/Arrangement/stores';
import { stepRecordStore } from '#/modules/MIDI/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { readClipPlayheadBeat } from './clipPlayheadBeat';

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
 * Refuses a piano-roll edit gesture when any of the clips it writes sits on a
 * frozen track: warns once and returns true so the caller drops the whole
 * gesture before it touches the MIDI store or pushes an undo entry. Pass the
 * clips the gesture writes, never the clips merely open beside them. Call it
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

type NoteRef = { id: string };

/** The notes the piano roll shows (primary clip and opened clips) and the clip new notes land in. */
export type NoteOwners = {
    clipId: string;
    targetClipId: string;
    notes: readonly NoteRef[];
    openedClipNotes: Record<string, readonly NoteRef[]> | undefined;
};

/** The clips that own at least one of the given note ids. */
export function ownerClipIds(noteIds: ReadonlySet<string>, { clipId, notes, openedClipNotes }: NoteOwners): string[] {
    const owners: string[] = [];
    if (notes.some((note) => noteIds.has(note.id))) {
        owners.push(clipId);
    }
    for (const [openedId, openedNotes] of Object.entries(openedClipNotes ?? {})) {
        if (openedId !== clipId && openedNotes.some((note) => noteIds.has(note.id))) {
            owners.push(openedId);
        }
    }
    return owners;
}

type KeyPress = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };

type NoteEditKeyContext = {
    selectedNoteIds: ReadonlySet<string>;
    stepInput: boolean;
    owners: NoteOwners;
    /** Whether a note id is a frozen-take view, which the single-clip transforms leave alone. */
    isTakeView: (noteId: string) => unknown;
};

const VELOCITY_PRESET_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7']);

/** Legato, join and split act on one clip's notes and do nothing across clips or on take views. */
function singleClipOwners(context: NoteEditKeyContext): string[] {
    const hasTakeView = [...context.selectedNoteIds].some((id) => context.isTakeView(id) !== undefined);
    const selectedOwners = ownerClipIds(context.selectedNoteIds, context.owners);
    return !hasTakeView && selectedOwners.length === 1 ? selectedOwners : [];
}

/** Split needs the playhead inside the clip to resolve its beat, in step input too. */
function splitKeyClips(context: NoteEditKeyContext): string[] {
    return singleClipOwners(context).filter((clipId) => readClipPlayheadBeat(clipId) !== undefined);
}

/** Legato (`l`) and join (`j`, which needs two notes outside step input) with no modifier. */
function clipsWrittenByLegatoOrJoin({ key, metaKey, ctrlKey, shiftKey }: KeyPress, context: NoteEditKeyContext) {
    if (metaKey || ctrlKey || shiftKey || context.stepInput) {
        return [];
    }
    if (key === 'l' || (key === 'j' && context.selectedNoteIds.size >= 2)) {
        return singleClipOwners(context);
    }
    return [];
}

function clipsWrittenBySelectionKey(event: KeyPress, context: NoteEditKeyContext): string[] {
    const selectedOwners = ownerClipIds(context.selectedNoteIds, context.owners);
    if (event.key === 'Delete' || event.key === 'Backspace') {
        return selectedOwners;
    }
    if (event.key === 'S' && event.shiftKey && !event.metaKey && !event.ctrlKey) {
        return splitKeyClips(context);
    }
    if (context.stepInput) {
        return VELOCITY_PRESET_KEYS.has(event.key) ? selectedOwners : [];
    }
    return event.key.startsWith('Arrow') ? selectedOwners : clipsWrittenByLegatoOrJoin(event, context);
}

/**
 * The clips a key press on the piano roll canvas writes: empty when the key
 * would change nothing given the selection, mode and clips involved, so a
 * no-op key never earns a frozen warning. Mirrors the key branches of the
 * canvas key handler.
 */
export function keyClips(event: KeyPress, context: NoteEditKeyContext): string[] {
    if (context.stepInput && event.key === ' ' && event.ctrlKey) {
        const step = stepRecordStore.value;
        return step?.active && step.clipId ? [step.clipId] : [];
    }
    if (event.key === 'd' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        return duplicateKeyClips(context);
    }
    return context.selectedNoteIds.size === 0 ? [] : clipsWrittenBySelectionKey(event, context);
}

/** Duplicate acts on the selection, or on the whole primary clip when nothing is selected. */
function duplicateKeyClips({ selectedNoteIds, owners }: NoteEditKeyContext): string[] {
    if (selectedNoteIds.size > 0) {
        return ownerClipIds(selectedNoteIds, owners);
    }
    return owners.notes.length > 0 ? [owners.clipId] : [];
}

type DragPreview = {
    noteIds: ReadonlySet<string>;
    beatDelta: number;
    pitchDelta: number;
    beatOverride?: ReadonlyMap<string, { beat: number; duration: number }>;
    durationOverride?: ReadonlyMap<string, number>;
};

type ReleaseDrag = {
    mode: string;
    noteId: string | null;
    origBeat: number;
    origDuration: number;
};

type ReleaseRefs = {
    dragPreviewRef: { current: DragPreview | null };
    pendingStampRef: { current: unknown };
    rubberBandRef: { current: { w: number; h: number } | null };
};

/** Whether the drag preview moves, resizes or duplicates a note away from where the press found it. */
function previewChangesNote(drag: ReleaseDrag, preview: DragPreview): boolean {
    if (drag.mode === 'move' || drag.mode === 'duplicate') {
        return preview.beatDelta !== 0 || preview.pitchDelta !== 0;
    }
    const noteId = drag.noteId ?? '';
    if (drag.mode === 'resize-left') {
        const override = preview.beatOverride?.get(noteId);
        return override !== undefined && (override.beat !== drag.origBeat || override.duration !== drag.origDuration);
    }
    if (drag.mode === 'resize-right') {
        const duration = preview.durationOverride?.get(noteId);
        return duration !== undefined && duration !== drag.origDuration;
    }
    return false;
}

/**
 * The clips releasing the pointer now would write: the owners of a moved,
 * resized or duplicated note whose preview really changes it (a zero-delta
 * drag is a selection click), or the target clip of a click-stamp / chord
 * stamp left pending by a press on empty grid that did not become a
 * rubber-band drag. Empty when the release writes nothing.
 */
export function releaseClips(drag: ReleaseDrag, refs: ReleaseRefs, owners: NoteOwners): string[] {
    if (drag.mode === 'rubber-band') {
        const rubberBand = refs.rubberBandRef.current;
        const draggedOut = rubberBand !== null && (rubberBand.w > 2 || rubberBand.h > 2);
        return refs.pendingStampRef.current !== null && !draggedOut ? [owners.targetClipId] : [];
    }
    const preview = refs.dragPreviewRef.current;
    return preview !== null && previewChangesNote(drag, preview) ? ownerClipIds(preview.noteIds, owners) : [];
}
