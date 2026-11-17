import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { type EditMidiNotesPayload } from '#/modules/MIDI/events';
import { midiStore, type MidiNote } from '#/modules/MIDI/stores';
import { readPianoRollSelection } from '#/modules/MIDI/useCases';
import { MIDI_NOTE_EDIT_MAX_OPERATIONS } from '#/utils/midiNoteBatchLimits';

import { type checkMidiNoteEditAuthority } from '../checkMidiNoteEditAuthority';

type Authority = NonNullable<ReturnType<typeof checkMidiNoteEditAuthority>>;

function findEditableBaseMidiClip({ clipId, trackId }: Authority) {
    const tracks = trackStore.value?.tracks ?? [];
    const clips = tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })));
    const matches = clips.filter(({ clip }) => clip.id === clipId);
    const target = matches[0];
    if (
        matches.length !== 1 ||
        !target ||
        target.track.id !== trackId ||
        target.track.kind !== 'midi' ||
        target.track.frozen ||
        target.clip.type !== 'midi' ||
        target.clip.locked ||
        target.clip.loopEnabled ||
        target.clip.isLinkedInstance ||
        target.clip.parentClipId !== undefined ||
        clips.some(({ clip }) => clip.parentClipId === clipId) ||
        takeLaneStore.value?.lanes.some(
            (lane) =>
                lane.trackId === trackId &&
                lane.takes.some(
                    (take) =>
                        take.clipId === clipId ||
                        (take.midiSource !== undefined &&
                            take.startBeat < target.clip.endBeat &&
                            take.endBeat > target.clip.startBeat)
                )
        )
    ) {
        return null;
    }
    return target.clip;
}

function readSelectedBaseMidiNotes({ clipId, proof }: Authority) {
    const selection = readPianoRollSelection();
    const midi = midiStore.value;
    const notes = midi?.notesByClipId[clipId];
    if (
        !notes ||
        !Object.hasOwn(midi.notesByClipId, clipId) ||
        selection.token !== proof.binding.selectionToken ||
        selection.status !== 'resolved' ||
        selection.clipId !== clipId ||
        selection.owners.length === 0 ||
        selection.owners.length !== selection.viewIds.length ||
        selection.owners.length > MIDI_NOTE_EDIT_MAX_OPERATIONS
    ) {
        return null;
    }
    const notesById = new Map(notes.map((note) => [note.id, note]));
    const coveredViews = new Set(proof.windows.flatMap((window) => window.owners.map((owner) => owner.viewId)));
    const selected = selection.owners.flatMap((owner) => {
        const note = notesById.get(owner.storedNoteId);
        if (
            owner.clipId !== clipId ||
            owner.ownerClipId !== clipId ||
            owner.takeId !== undefined ||
            owner.occurrenceIndex !== undefined ||
            !coveredViews.has(owner.viewId) ||
            !note ||
            note.recordingPassIndex !== undefined
        ) {
            return [];
        }
        return [note];
    });
    const allowedNoteIds = new Set(selected.map(({ id }) => id));
    if (notesById.size !== notes.length || allowedNoteIds.size !== selection.owners.length) {
        return null;
    }
    return { selectionToken: selection.token, notes, selected, allowedNoteIds };
}

function getStoredEditWindow(
    clip: { startBeat: number; endBeat: number; midiOffsetBeats?: number },
    selected: readonly MidiNote[]
) {
    const clipOffset = clip.midiOffsetBeats ?? 0;
    const clipStart = Math.max(0, clipOffset);
    const clipEnd = clipOffset + (clip.endBeat - clip.startBeat);
    const startBeat = Math.min(...selected.map((note) => note.startBeat));
    const endBeat = Math.max(...selected.map((note) => note.startBeat + note.duration));
    if (
        !Number.isFinite(clipEnd) ||
        !Number.isFinite(startBeat) ||
        !Number.isFinite(endBeat) ||
        startBeat < clipStart ||
        endBeat > clipEnd ||
        endBeat <= startBeat
    ) {
        return null;
    }
    return {
        editWindow: { startBeat, endBeat },
        protectedWindows: [
            { startBeat: clipStart, endBeat: startBeat },
            { startBeat: endBeat, endBeat: clipEnd },
        ].filter((window) => window.endBeat > window.startBeat),
    };
}

function readCoversEditWindow(windows: Authority['proof']['windows'], startBeat: number, endBeat: number): boolean {
    let coveredEnd = startBeat;
    for (const window of windows.toSorted((left, right) => left.startBeat - right.startBeat)) {
        if (window.startBeat > coveredEnd) {
            break;
        }
        coveredEnd = Math.max(coveredEnd, window.endBeat);
    }
    return coveredEnd >= endBeat;
}

/** The query establishes read coverage. Live project owners establish the write scope. */
export function captureMidiNoteEditGuard(input: Authority): EditMidiNotesPayload['guard'] | null {
    const clip = findEditableBaseMidiClip(input);
    const selection = readSelectedBaseMidiNotes(input);
    if (!clip || !selection) {
        return null;
    }
    const bounds = getStoredEditWindow(clip, selection.selected);
    const timelineOffset = clip.startBeat - (clip.midiOffsetBeats ?? 0);
    if (
        !bounds ||
        !readCoversEditWindow(
            input.proof.windows,
            timelineOffset + bounds.editWindow.startBeat,
            timelineOffset + bounds.editWindow.endBeat
        )
    ) {
        return null;
    }
    const { clipId, trackId, authority } = input;
    const { editWindow, protectedWindows } = bounds;
    const { allowedNoteIds, notes, selectionToken } = selection;
    const protectedByRequest = new Set(
        authority.prohibitions.flatMap((restriction) =>
            restriction.kind === 'protect-object' ? [restriction.objectId] : []
        )
    );
    const protectedNoteIds = notes
        .filter(({ id }) => !allowedNoteIds.has(id) || protectedByRequest.has(id))
        .map(({ id }) => id);
    const budget =
        authority.creationSlots.find((slot) => slot.objectType === 'notes' && slot.parentObjectId === clipId)?.budget ??
        0;
    return {
        trackId,
        expectedNotes: structuredClone(notes),
        expectedNotesBucketPresent: true,
        selectionToken,
        editWindow,
        scope: {
            allowedNoteIds: [...allowedNoteIds],
            protectedNoteIds,
            protectedWindows,
            insertionWindows: budget > 0 ? [editWindow] : [],
            insertionBudget: Math.min(budget, MIDI_NOTE_EDIT_MAX_OPERATIONS),
        },
    };
}
