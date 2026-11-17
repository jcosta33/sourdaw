import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    projectRevisionMatchesLiveIgnoringSaveWrites,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    locatePianoRollSelectionWindows,
    projectPianoRollTakeNotes,
    readPianoRollSelection,
} from '#/modules/MIDI/useCases';

import { type captureMusicalContentBinding } from './captureMusicalContentBinding';

type SelectionOwner = ReturnType<typeof readPianoRollSelection>['owners'][number];
type Clip = NonNullable<typeof trackStore.value>['tracks'][number]['clips'][number];
type SourceRows = NonNullable<typeof midiStore.value>['notesByClipId'][string];

function findSelectedWindow(
    clip: Clip,
    trackId: string,
    sourceRows: SourceRows,
    owner: SelectionOwner,
    budget: { scans: number }
) {
    const source = sourceRows.find((row) => row.id === owner.storedNoteId);
    const candidates = locatePianoRollSelectionWindows(clip, owner, source);
    for (const candidate of candidates) {
        if (++budget.scans > 32) {
            throw new Error('Selected musical source unavailable in bounded windows');
        }
        const projection = projectPianoRollTakeNotes(clip, trackId, takeLaneStore.value, sourceRows, {
            fromBeat: candidate.startBeat,
            toBeat: candidate.endBeat,
            maxWork: 16_384,
            maxOutput: 512,
        });
        const found =
            projection.baseOccurrences.some(
                (entry) =>
                    entry.viewId === owner.viewId &&
                    entry.row.id === owner.storedNoteId &&
                    owner.ownerClipId === clip.id
            ) ||
            projection.notes.some((note) => {
                const projectedOwner = projection.ownersByViewId.get(note.id);
                return (
                    note.id === owner.viewId &&
                    projectedOwner?.row.id === owner.storedNoteId &&
                    projectedOwner.sourceClipId === owner.ownerClipId &&
                    projectedOwner.takeId === owner.takeId &&
                    projectedOwner.occurrenceIndex === owner.occurrenceIndex
                );
            });
        if (found) {
            return candidate;
        }
    }
    throw new Error('Selected musical source unavailable in bounded windows');
}

function resolveClipSource(
    clipId: string,
    tracks: NonNullable<typeof trackStore.value>['tracks'],
    selection: ReturnType<typeof readPianoRollSelection>,
    midi: NonNullable<typeof midiStore.value>
) {
    const track = tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    if (
        !track ||
        !clip ||
        clip.type !== 'midi' ||
        !Number.isFinite(clip.startBeat) ||
        !Number.isFinite(clip.endBeat) ||
        clip.endBeat <= clip.startBeat
    ) {
        throw new Error('Musical read scope unavailable');
    }
    if (selection.clipIds.includes(clipId) && selection.viewIds.length > 0 && selection.status !== 'resolved') {
        throw new Error('Musical selection ownership unavailable');
    }
    const owners = selection.owners.filter((owner) => owner.clipId === clipId);
    if (owners.length === 0) {
        return { clip, track, owners, sourceRows: [] };
    }
    const sourceRows = midi.notesByClipId[clipId] ?? [];
    if (sourceRows.length > 16_384 || owners.length > 32) {
        throw new Error('Musical read scope unavailable');
    }
    return { clip, track, owners, sourceRows };
}

/** Read coverage only: this does not authorize edits or establish protected time windows. */
export function resolveMusicalContentReadScope(
    binding: ReturnType<typeof captureMusicalContentBinding>,
    clipIds: readonly string[]
) {
    settlePendingProjectWritesAndCaptureRevision();
    if (!projectRevisionMatchesLiveIgnoringSaveWrites(binding.expectedRevision)) {
        throw new Error('Stale musical content revision');
    }
    const selection = readPianoRollSelection();
    if (selection.token !== binding.selectionToken) {
        throw new Error('Stale musical selection');
    }
    if (clipIds.length === 0 || clipIds.length > 32 || new Set(clipIds).size !== clipIds.length) {
        throw new Error('Musical read scope unavailable');
    }
    const tracks = trackStore.value?.tracks ?? [];
    if (tracks.length > 16_384 || tracks.reduce((count, track) => count + track.clips.length, 0) > 16_384) {
        throw new Error('Musical read scope unavailable');
    }
    const scanBudget = { scans: 0 };
    const midi = midiStore.value;
    if (!midi) {
        throw new Error('Musical read scope unavailable');
    }
    const windows: Array<{ clipId: string; startBeat: number; endBeat: number; owners: typeof selection.owners }> = [];
    for (const clipId of clipIds) {
        const { clip, track, owners, sourceRows } = resolveClipSource(clipId, tracks, selection, midi);
        if (owners.length === 0) {
            windows.push({ clipId, startBeat: clip.startBeat, endBeat: clip.endBeat, owners: [] });
            continue;
        }
        for (const owner of owners) {
            const candidate = findSelectedWindow(clip, track.id, sourceRows, owner, scanBudget);
            const existing = windows.find(
                (window) =>
                    window.clipId === clipId &&
                    window.startBeat === candidate.startBeat &&
                    window.endBeat === candidate.endBeat
            );
            if (existing) {
                existing.owners.push(owner);
            } else {
                windows.push({ clipId, ...candidate, owners: [owner] });
            }
        }
    }
    return windows;
}
