import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, pushUndoEntry, redo, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore, type MidiNote, type MidiStoreState } from '#/modules/MIDI/stores';

import { legatoNotes } from '../../midiNoteTransforms/legatoNotes';
import { replaceMidiNotesIfUnchanged } from '../replaceMidiNotesIfUnchanged';
import { resizeMidiNote } from '../resizeMidiNote';

const clipId = 'clip-1';

function note(id: string, startBeat: number, duration: number, velocity = 100): MidiNote {
    return { id, pitch: 60, startBeat, duration, velocity };
}

function projectedNotes(): MidiNote[] {
    return midiStore.value?.notesByClipId[clipId] ?? [];
}

function documentNotes(): MidiNote[] {
    return getCrdtDoc('root')?.midi?.notesByClipId[clipId] ?? [];
}

function publishPeerEdit(id: string, velocity: number): void {
    flushAutomergeStorageWrites();
    mutateCrdtDoc<{ midi?: MidiStoreState }>({
        id: 'root',
        changeFn: (draft) => {
            const target = draft.midi?.notesByClipId[clipId]?.find((candidate) => candidate.id === id);
            if (!target) {
                throw new Error('Peer fixture note is missing');
            }
            target.velocity = velocity;
        },
    });
    projectCrdtToStores({ resetProjections: true });
}

function publishPeerMembershipChange(): void {
    flushAutomergeStorageWrites();
    mutateCrdtDoc<{ midi?: MidiStoreState }>({
        id: 'root',
        changeFn: (draft) => {
            const notes = draft.midi?.notesByClipId[clipId];
            if (!notes) {
                throw new Error('Peer fixture clip is missing');
            }
            notes.splice(
                notes.findIndex((candidate) => candidate.id === 'boundary'),
                1
            );
            notes.push(note('added', 8, 1, 64));
        },
    });
    projectCrdtToStores({ resetProjections: true });
}

function findNote(id: string): MidiNote {
    const found = projectedNotes().find((candidate) => candidate.id === id);
    if (!found) {
        throw new Error('Expected fixture note');
    }
    return structuredClone(found);
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('targeted MIDI note undo');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearUndoHistory();
    midiStore.set({
        notesByClipId: {
            [clipId]: [
                { ...note('edited', 1, 3), pressure: 20, expression: { pressure: [{ offsetBeats: 2.5, value: 90 }] } },
                note('boundary', 2, 0.5),
                note('peer', 6, 1, 50),
            ],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
    flushAutomergeStorageWrites();
});

afterEach(() => {
    clearUndoHistory();
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('targeted MIDI note history through Command and Automerge', () => {
    it.each([
        ['left resize', () => resizeMidiNote(clipId, 'edited', 2, 2)],
        ['right resize', () => resizeMidiNote(clipId, 'edited', undefined, 1)],
        ['legato', () => legatoNotes(clipId, ['edited'])],
    ])('%s preserves later peer edits across undo and redo', async (_label, edit) => {
        const before = findNote('edited');
        edit();
        const after = findNote('edited');
        expect(after).not.toEqual(before);
        pushUndoEntry(
            'Edit MIDI note',
            () => replaceMidiNotesIfUnchanged(clipId, [{ expected: after, replacement: before }]),
            () => replaceMidiNotesIfUnchanged(clipId, [{ expected: before, replacement: after }])
        );

        publishPeerEdit('peer', 77);
        publishPeerMembershipChange();
        expect(await undo()).toEqual({ headConsumed: true });
        flushAutomergeStorageWrites();
        expect(findNote('edited')).toEqual(before);
        expect(projectedNotes().find((candidate) => candidate.id === 'peer')?.velocity).toBe(77);
        expect(projectedNotes().map((candidate) => candidate.id)).toEqual(['edited', 'peer', 'added']);
        expect(documentNotes()).toEqual(projectedNotes());

        publishPeerEdit('peer', 88);
        await redo();
        flushAutomergeStorageWrites();
        expect(findNote('edited')).toEqual(after);
        expect(projectedNotes().find((candidate) => candidate.id === 'peer')?.velocity).toBe(88);
        expect(projectedNotes().map((candidate) => candidate.id)).toEqual(['edited', 'peer', 'added']);
        expect(documentNotes()).toEqual(projectedNotes());
    });

    it('refuses a changed target atomically without moving the history cursor', async () => {
        const before = findNote('edited');
        const otherBefore = findNote('boundary');
        legatoNotes(clipId, ['edited', 'boundary']);
        const after = findNote('edited');
        const otherAfter = findNote('boundary');
        pushUndoEntry(
            'Edit two notes',
            () =>
                replaceMidiNotesIfUnchanged(clipId, [
                    { expected: after, replacement: before },
                    { expected: otherAfter, replacement: otherBefore },
                ]),
            () =>
                replaceMidiNotesIfUnchanged(clipId, [
                    { expected: before, replacement: after },
                    { expected: otherBefore, replacement: otherAfter },
                ])
        );
        const pastCount = undoStore.value?.past.length;
        publishPeerEdit('boundary', 77);
        const beforeRefusal = structuredClone(projectedNotes());

        await expect(undo()).rejects.toThrow('an edited note changed');
        flushAutomergeStorageWrites();
        expect(projectedNotes()).toEqual(beforeRefusal);
        expect(documentNotes()).toEqual(beforeRefusal);
        expect(undoStore.value?.past.length).toBe(pastCount);
        expect(undoStore.value?.future).toHaveLength(0);

        publishPeerEdit('boundary', otherAfter.velocity);
        expect(await undo()).toEqual({ headConsumed: true });
        publishPeerEdit('edited', 77);
        const beforeRedoRefusal = structuredClone(projectedNotes());
        const futureCount = undoStore.value?.future.length;
        const pastAfterUndo = undoStore.value?.past.length;
        await expect(redo()).rejects.toThrow('an edited note changed');
        flushAutomergeStorageWrites();
        expect(projectedNotes()).toEqual(beforeRedoRefusal);
        expect(documentNotes()).toEqual(beforeRedoRefusal);
        expect(undoStore.value?.future.length).toBe(futureCount);
        expect(undoStore.value?.past.length).toBe(pastAfterUndo);
    });
});
