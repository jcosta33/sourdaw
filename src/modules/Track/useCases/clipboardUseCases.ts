import { getTrackState } from '../repositories/trackRepository';
import { getWorkspaceStoreValue as getWorkspaceState } from '#/modules/Workspace/useCases/workspaceQueries';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { addClip, removeClip } from '#/modules/Track/useCases/clipUseCases';
import { type Clip } from '#/modules/Track/models/Track';
import { type MidiNote, createMidiNote } from '#/modules/Track/models/MidiNote';

type ClipboardEntry = {
    clip: Clip;
    midiNotes?: MidiNote[];
    sourceTrackId: string;
};

type NoteClipboardEntry = {
    notes: MidiNote[];
};

let clipClipboard: ClipboardEntry[] = [];
let noteClipboard: NoteClipboardEntry | null = null;

function findClipById(clipId: string): { clip: Clip; trackId: string } | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            return { clip, trackId: track.id };
        }
    }
    return null;
}

function copyClipIds(ids: string[]): void {
    const midiState = midiStore.value;
    clipClipboard = [];
    for (const id of ids) {
        const found = findClipById(id);
        if (!found) {
            continue;
        }
        const midiNotes = found.clip.type === 'midi' ? midiState?.notesByClipId[found.clip.id] : undefined;
        clipClipboard.push({
            clip: { ...found.clip },
            midiNotes: midiNotes ? midiNotes.map((n) => ({ ...n })) : undefined,
            sourceTrackId: found.trackId,
        });
    }
}

export function copySelectedClip(): void {
    const workspace = getWorkspaceState();
    if (!workspace) {
        return;
    }
    const ids =
        workspace.selectedClipIds.length > 0
            ? workspace.selectedClipIds
            : workspace.selectedClipId
              ? [workspace.selectedClipId]
              : [];
    if (ids.length === 0) {
        return;
    }
    copyClipIds(ids);
}

export function cutSelectedClip(): void {
    const workspace = getWorkspaceState();
    if (!workspace) {
        return;
    }
    const ids =
        workspace.selectedClipIds.length > 0
            ? workspace.selectedClipIds
            : workspace.selectedClipId
              ? [workspace.selectedClipId]
              : [];
    if (ids.length === 0) {
        return;
    }
    copyClipIds(ids);
    for (const id of ids) {
        removeClip(id);
    }
}

export function pasteClip(): void {
    if (clipClipboard.length === 0) {
        return;
    }

    const transport = getTransportState();
    const trackState = getTrackState();
    if (!transport || !trackState) {
        return;
    }

    const playheadBeat = transport.playheadPosition;
    const minStartBeat = Math.min(...clipClipboard.map((e) => e.clip.startBeat));
    const offset = playheadBeat - minStartBeat;

    for (const entry of clipClipboard) {
        const targetTrackId = trackState.selectedTrackId ?? entry.sourceTrackId;
        const targetTrack = trackState.tracks.find((t) => t.id === targetTrackId);
        if (!targetTrack) {
            continue;
        }

        const newClip = addClip({
            trackId: targetTrackId,
            startBeat: entry.clip.startBeat + offset,
            endBeat: entry.clip.endBeat + offset,
            name: `${entry.clip.name} (paste)`,
            type: entry.clip.type,
            audioBufferId: entry.clip.audioBufferId,
        });

        if (!newClip) {
            continue;
        }

        if (entry.midiNotes && entry.midiNotes.length > 0) {
            const copiedNotes: MidiNote[] = entry.midiNotes.map((n) =>
                createMidiNote(n.pitch, n.startBeat, n.duration, n.velocity)
            );

            const midiState = midiStore.value;
            if (midiState) {
                midiStore.set({
                    ...midiState,
                    notesByClipId: {
                        ...midiState.notesByClipId,
                        [newClip.id]: copiedNotes,
                    },
                });
            }
        }
    }
}

export function copySelectedNotes(clipId: string, noteIds: string[]): void {
    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const notes = midiState.notesByClipId[clipId];
    if (!notes) {
        return;
    }

    const selected = notes.filter((n) => noteIds.includes(n.id));
    if (selected.length === 0) {
        return;
    }

    noteClipboard = {
        notes: selected.map((n) => ({ ...n })),
    };
}

export function pasteNotes(clipId: string, beatOffset: number): void {
    if (!noteClipboard || noteClipboard.notes.length === 0) {
        return;
    }

    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const existing = midiState.notesByClipId[clipId] ?? [];

    const minStart = Math.min(...noteClipboard.notes.map((n) => n.startBeat));

    const pastedNotes: MidiNote[] = noteClipboard.notes.map((n) =>
        createMidiNote(n.pitch, n.startBeat - minStart + beatOffset, n.duration, n.velocity)
    );

    midiStore.set({
        ...midiState,
        notesByClipId: {
            ...midiState.notesByClipId,
            [clipId]: [...existing, ...pastedNotes],
        },
    });
}
