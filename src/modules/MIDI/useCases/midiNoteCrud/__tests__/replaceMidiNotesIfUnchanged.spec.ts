import { clone, merge } from '@automerge/automerge';
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
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore, type MidiNote, type MidiStoreState } from '#/modules/MIDI/stores';

import { appendRecordedMidiNote } from '../../appendRecordedMidiNote';
import { getMidiClipNotesSnapshot } from '../../midiNoteTransforms/getMidiClipNotesSnapshot';
import { legatoNotes } from '../../midiNoteTransforms/legatoNotes';
import { appendMidiNotes } from '../appendMidiNotes';
import { batchAddMidiNotes } from '../batchAddMidiNotes';
import { replaceMidiNotesIfUnchanged } from '../replaceMidiNotesIfUnchanged';
import { resizeMidiNote } from '../resizeMidiNote';
import { restoreMidiNoteMembershipIfUnchanged } from '../restoreMidiNoteMembershipIfUnchanged';
import { setNotesForClip } from '../setNotesForClip';
import { splitMidiNotesAtBeat } from '../splitMidiNotesAtBeat';

const clipId = 'clip-1';

function note(id: string, startBeat: number, duration: number, velocity = 100): MidiNote {
    return { id, pitch: 60, startBeat, duration, velocity };
}

function projectedNotes(): MidiNote[] {
    return midiStore.value?.notesByClipId[clipId] ?? [];
}

function documentNotes(): MidiNote[] {
    return getCrdtDoc<{ midi?: MidiStoreState }>('root')?.midi?.notesByClipId[clipId] ?? [];
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
    it('refuses undo when a peer moved the deleted note into an unplanned clip', async () => {
        const baseline = clone(getCrdtDoc<{ midi?: MidiStoreState }>('root')!);
        splitMidiNotesAtBeat({ sourceClipId: clipId, newClipId: 'split-right', splitBeat: 4 });
        flushAutomergeStorageWrites();
        const peerSplit = clone(getCrdtDoc<{ midi?: MidiStoreState }>('root')!);
        expect(
            peerSplit.midi?.notesByClipId['split-right']?.find((candidate) => candidate.id === 'peer')
        ).toMatchObject({ startBeat: 2, duration: 1 });
        replaceCrdtDocInLineage({ id: 'root', doc: baseline });
        projectCrdtToStores({ resetProjections: true });

        const before = structuredClone(projectedNotes());
        const deleted = before.find((candidate) => candidate.id === 'peer')!;
        setNotesForClip(
            clipId,
            before.filter((candidate) => candidate.id !== deleted.id)
        );
        const after = structuredClone(projectedNotes());
        pushUndoEntry(
            'Delete MIDI note',
            () => restoreMidiNoteMembershipIfUnchanged([{ clipId, expected: after, replacement: before }]),
            () => restoreMidiNoteMembershipIfUnchanged([{ clipId, expected: before, replacement: after }])
        );
        flushAutomergeStorageWrites();
        const local = clone(getCrdtDoc<{ midi?: MidiStoreState }>('root')!);
        replaceCrdtDocInLineage({ id: 'root', doc: merge(local, peerSplit) });
        projectCrdtToStores({ resetProjections: true });
        const documentBefore = structuredClone(getCrdtDoc<{ midi?: MidiStoreState }>('root')?.midi);
        const projectionBefore = structuredClone(midiStore.value);
        const historyBefore = structuredClone(undoStore.value);

        await expect(undo()).rejects.toThrow('note ownership');
        flushAutomergeStorageWrites();
        expect(getCrdtDoc<{ midi?: MidiStoreState }>('root')?.midi).toEqual(documentBefore);
        expect(midiStore.value).toEqual(projectionBefore);
        expect(undoStore.value).toEqual(historyBefore);
    });
    it('refuses redo when a peer split places the owned note in an unplanned clip', async () => {
        const baseline = clone(getCrdtDoc<{ midi?: MidiStoreState }>('root')!);
        splitMidiNotesAtBeat({ sourceClipId: clipId, newClipId: 'split-right', splitBeat: 4 });
        flushAutomergeStorageWrites();
        const peerSplit = clone(getCrdtDoc<{ midi?: MidiStoreState }>('root')!);
        replaceCrdtDocInLineage({ id: 'root', doc: baseline });
        projectCrdtToStores({ resetProjections: true });

        const before = structuredClone(projectedNotes());
        setNotesForClip(
            clipId,
            before.filter((candidate) => candidate.id !== 'peer')
        );
        const after = structuredClone(projectedNotes());
        pushUndoEntry(
            'Delete MIDI note',
            () => restoreMidiNoteMembershipIfUnchanged([{ clipId, expected: after, replacement: before }]),
            () => restoreMidiNoteMembershipIfUnchanged([{ clipId, expected: before, replacement: after }])
        );
        expect(await undo()).toEqual({ headConsumed: true });
        flushAutomergeStorageWrites();
        const local = clone(getCrdtDoc<{ midi?: MidiStoreState }>('root')!);
        replaceCrdtDocInLineage({ id: 'root', doc: merge(local, peerSplit) });
        projectCrdtToStores({ resetProjections: true });
        const documentBefore = structuredClone(getCrdtDoc<{ midi?: MidiStoreState }>('root')?.midi);
        const projectionBefore = structuredClone(midiStore.value);
        const historyBefore = structuredClone(undoStore.value);

        await expect(redo()).rejects.toThrow('note ownership');
        flushAutomergeStorageWrites();
        expect(getCrdtDoc<{ midi?: MidiStoreState }>('root')?.midi).toEqual(documentBefore);
        expect(midiStore.value).toEqual(projectionBefore);
        expect(undoStore.value).toEqual(historyBefore);
    });
    it('retains membership history when an owned note’s peer expression changes', async () => {
        const before = structuredClone(projectedNotes());
        const edited = before.find((candidate) => candidate.id === 'edited')!;
        setNotesForClip(
            clipId,
            before.map((candidate) => (candidate.id === 'edited' ? { ...candidate, duration: 4 } : candidate))
        );
        const after = structuredClone(projectedNotes());
        pushUndoEntry(
            'Join MIDI notes',
            () => restoreMidiNoteMembershipIfUnchanged([{ clipId, expected: after, replacement: before }]),
            () => restoreMidiNoteMembershipIfUnchanged([{ clipId, expected: before, replacement: after }])
        );
        flushAutomergeStorageWrites();
        mutateCrdtDoc<{ midi?: MidiStoreState }>({
            id: 'root',
            changeFn: (draft) => {
                draft.midi!.notesByClipId[clipId]!.find(
                    (candidate) => candidate.id === edited.id
                )!.expression!.pressure![0]!.value = 91;
            },
        });
        projectCrdtToStores({ resetProjections: true });
        const beforeRefusal = structuredClone(projectedNotes());
        const pastCount = undoStore.value?.past.length;
        await expect(undo()).rejects.toThrow('an edited note changed');
        flushAutomergeStorageWrites();
        expect(projectedNotes()).toEqual(beforeRefusal);
        expect(documentNotes()).toEqual(beforeRefusal);
        expect(undoStore.value?.past.length).toBe(pastCount);
    });
    it('undoes owned membership across clips while retaining a peer curve, and refuses a later clip conflict atomically', async () => {
        const otherClipId = 'clip-2';
        const second = { ...note('second', 3, 2), expression: { slide: [{ offsetBeats: 0.5, value: 20 }] } };
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { ...midiStore.value!.notesByClipId, [otherClipId]: [second] },
        });
        flushAutomergeStorageWrites();
        const beforeFirst = structuredClone(projectedNotes());
        const beforeSecond = structuredClone(midiStore.value!.notesByClipId[otherClipId]!);
        setNotesForClip(
            clipId,
            beforeFirst.filter((candidate) => candidate.id !== 'edited')
        );
        setNotesForClip(otherClipId, []);
        const afterFirst = structuredClone(projectedNotes());
        const afterSecond = structuredClone(midiStore.value!.notesByClipId[otherClipId]!);
        const forward = [
            { clipId, expected: beforeFirst, replacement: afterFirst },
            { clipId: otherClipId, expected: beforeSecond, replacement: afterSecond },
        ];
        const backward = forward.map(({ clipId: id, expected, replacement }) => ({
            clipId: id,
            expected: replacement,
            replacement: expected,
        }));
        pushUndoEntry(
            'Delete two notes',
            () => restoreMidiNoteMembershipIfUnchanged(backward),
            () => restoreMidiNoteMembershipIfUnchanged(forward)
        );
        flushAutomergeStorageWrites();
        mutateCrdtDoc<{ midi?: MidiStoreState }>({
            id: 'root',
            changeFn: (draft) => {
                draft.midi!.notesByClipId[clipId]!.find((candidate) => candidate.id === 'peer')!.velocity = 91;
                draft.midi!.notesByClipId[otherClipId]!.push({
                    ...second,
                    expression: { slide: [{ offsetBeats: 0.5, value: 91 }] },
                });
            },
        });
        projectCrdtToStores({ resetProjections: true });
        const beforeRefusal = structuredClone(midiStore.value!.notesByClipId);
        const pastCount = undoStore.value?.past.length;
        await expect(undo()).rejects.toThrow('an edited note changed');
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId).toEqual(beforeRefusal);
        expect(getCrdtDoc<{ midi?: MidiStoreState }>('root')?.midi?.notesByClipId).toEqual(beforeRefusal);
        expect(undoStore.value?.past.length).toBe(pastCount);

        mutateCrdtDoc<{ midi?: MidiStoreState }>({
            id: 'root',
            changeFn: (draft) => {
                const notes = draft.midi!.notesByClipId[otherClipId]!;
                notes.splice(0, notes.length);
            },
        });
        projectCrdtToStores({ resetProjections: true });
        expect(await undo()).toEqual({ headConsumed: true });
        flushAutomergeStorageWrites();
        expect(projectedNotes().find((candidate) => candidate.id === 'peer')?.velocity).toBe(91);
        expect(midiStore.value?.notesByClipId[otherClipId]).toEqual([second]);
        expect(getCrdtDoc<{ midi?: MidiStoreState }>('root')?.midi?.notesByClipId[otherClipId]).toEqual([second]);
    });
    it('does not expose the pending document curve through a returned transform snapshot', () => {
        setNotesForClip(clipId, [
            ...projectedNotes(),
            { ...note('new', 0, 2), expression: { pressure: [{ offsetBeats: 0.5, value: 90 }] } },
        ]);
        const snapshot = getMidiClipNotesSnapshot(clipId);
        const captured = snapshot?.find((candidate) => candidate.id === 'new');
        if (!captured?.expression?.pressure) {
            throw new Error('Expected captured pressure curve');
        }
        captured.expression.pressure[0]!.value = 12;
        captured.expression.pressure.push({ offsetBeats: 1, value: 30 });
        flushAutomergeStorageWrites();
        expect(documentNotes().find((candidate) => candidate.id === 'new')?.expression?.pressure).toEqual([
            { offsetBeats: 0.5, value: 90 },
        ]);
    });
    it('keeps admitted expression independent of batch input and returned notes through the document flush', () => {
        const source = {
            pitch: 60,
            startBeat: 0,
            duration: 2,
            velocity: 100,
            expression: { pressure: [{ offsetBeats: 0.5, value: 90 }] },
        };
        const [created] = batchAddMidiNotes(clipId, [source]);
        if (!created?.expression?.pressure) {
            throw new Error('Expected admitted pressure curve');
        }
        const createdPressurePoint = created.expression.pressure[0];
        if (!createdPressurePoint) {
            throw new Error('Expected admitted pressure point');
        }
        source.expression.pressure[0]!.value = 12;
        source.expression.pressure.push({ offsetBeats: 1, value: 20 });
        createdPressurePoint.value = 13;
        created.expression.pressure.push({ offsetBeats: 1.5, value: 30 });
        created.expression.pressure = [{ offsetBeats: 0.25, value: 40 }];
        flushAutomergeStorageWrites();

        const stored = documentNotes().find((candidate) => candidate.id === created.id);
        expect(stored?.expression).toEqual({ pressure: [{ offsetBeats: 0.5, value: 90 }] });
        expect(projectedNotes().find((candidate) => candidate.id === created.id)?.expression).toEqual(
            stored?.expression
        );
    });

    it('keeps appended and restored expression independent of caller mutation through the document flush', () => {
        const pasted = {
            pitch: 61,
            startBeat: 0,
            duration: 2,
            velocity: 100,
            expression: { slide: [{ offsetBeats: 0.5, value: 90 }] },
        };
        appendMidiNotes({ clipId, notes: [pasted] });
        const appendedId = projectedNotes().at(-1)?.id;
        pasted.expression.slide[0]!.value = 12;

        const current = findNote('edited');
        const replacement = structuredClone(current);
        replacement.expression!.pressure![0]!.value = 80;
        replaceMidiNotesIfUnchanged(clipId, [{ expected: current, replacement }]);
        replacement.expression!.pressure![0]!.value = 12;
        flushAutomergeStorageWrites();

        expect(documentNotes().find((candidate) => candidate.id === appendedId)?.expression).toEqual({
            slide: [{ offsetBeats: 0.5, value: 90 }],
        });
        expect(documentNotes().find((candidate) => candidate.id === 'edited')?.expression).toEqual({
            pressure: [{ offsetBeats: 2.5, value: 80 }],
        });
    });

    it('keeps recorded and supplied clip notes independent of their callers through the document flush', () => {
        const recorded = {
            ...note('recorded', 0, 2),
            expression: { pressure: [{ offsetBeats: 0.5, value: 90 }] },
        };
        appendRecordedMidiNote({ clipId, note: recorded });
        recorded.expression.pressure[0]!.value = 12;
        flushAutomergeStorageWrites();
        expect(documentNotes().find((candidate) => candidate.id === 'recorded')?.expression).toEqual({
            pressure: [{ offsetBeats: 0.5, value: 90 }],
        });

        const supplied = {
            ...note('supplied', 0, 2),
            expression: { slide: [{ offsetBeats: 0.5, value: 80 }] },
        };
        setNotesForClip(clipId, [...projectedNotes(), supplied]);
        supplied.expression.slide.push({ offsetBeats: 1, value: 20 });
        supplied.expression.slide = [{ offsetBeats: 0.25, value: 40 }];
        flushAutomergeStorageWrites();

        expect(documentNotes().find((candidate) => candidate.id === 'supplied')?.expression).toEqual({
            slide: [{ offsetBeats: 0.5, value: 80 }],
        });
    });
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
