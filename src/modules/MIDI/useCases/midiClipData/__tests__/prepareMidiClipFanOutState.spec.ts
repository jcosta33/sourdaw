import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { valuesEqual } from '#/utils/structuralEquality';

import { midiStore } from '../../../stores/midiStore';
import { prepareMidiClipFanOutState } from '../prepareMidiClipFanOutState';
import { restoreMidiClipGlueState } from '../restoreMidiClipGlueState';

const EMPTY_STATE = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };

function note(id: string, startBeat: number, pitch: number, probability?: number) {
    const row = { id, pitch, startBeat, duration: 1, velocity: 100 };
    if (probability === undefined) {
        return row;
    }
    return { ...row, probability };
}

describe('prepareMidiClipFanOutState', () => {
    beforeEach(() => {
        midiStore.set(EMPTY_STATE);
    });

    afterEach(() => {
        midiStore.set(EMPTY_STATE);
    });

    it('copies one source onto two targets with fresh row ids and the source’s own presence', () => {
        midiStore.set({
            notesByClipId: { 'source-a': [note('note-1', 1, 60), note('note-2', 2, 64)] },
            ccByClipId: { 'source-a': [{ id: 'cc-1', controller: 1, value: 0.25, beat: 1, channel: 0 }] },
            // No pitch-bend slot at all: a target must come back absent rather
            // than holding an empty array, or the store shape drifts.
            pitchBendByClipId: {},
        });

        const plan = prepareMidiClipFanOutState({
            sourceClipIds: ['source-a'],
            copies: [
                { sourceClipId: 'source-a', targetClipId: 'fragment-1' },
                { sourceClipId: 'source-a', targetClipId: 'fragment-2' },
            ],
        });

        expect(plan).not.toBeNull();
        // Both snapshots name the same ids in the same order — the precondition
        // `midiClipGlueStateMatches` enforces on the transition it guards.
        expect(plan!.previous.clips.map((clip) => clip.clipId)).toEqual(['source-a', 'fragment-1', 'fragment-2']);
        expect(plan!.next.clips.map((clip) => clip.clipId)).toEqual(['source-a', 'fragment-1', 'fragment-2']);

        expect(plan!.next.clips[0]!.data).toEqual({
            notes: { present: false, value: [] },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        });
        for (const fragment of plan!.next.clips.slice(1)) {
            expect(fragment.data.notes.present).toBe(true);
            expect(fragment.data.notes.value).toMatchObject([
                { pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
                { pitch: 64, startBeat: 2, duration: 1, velocity: 100 },
            ]);
            expect(fragment.data.controlChanges.value).toMatchObject([{ controller: 1, beat: 1 }]);
            expect(fragment.data.pitchBends.present).toBe(false);
        }

        const copiedIds = plan!.next.clips
            .slice(1)
            .flatMap((fragment) => [
                ...fragment.data.notes.value.map((row) => row.id),
                ...fragment.data.controlChanges.value.map((row) => row.id),
            ]);
        // Every copied row is a new identity: two fragments carrying the same
        // note id would make one row's edits reach both.
        expect(new Set(copiedIds).size).toBe(copiedIds.length);
        expect(copiedIds.every((id) => id.startsWith('note-dup-') || id.startsWith('cc-dup-'))).toBe(true);
    });

    it('retires a source no fragment copies from', () => {
        // A clip the comp fully covers produces no fragment, and the clip
        // itself stops existing — so its rows must go with it.
        midiStore.set({
            notesByClipId: { covered: [note('note-1', 1, 60)], kept: [note('note-2', 1, 62)] },
            ccByClipId: {},
            pitchBendByClipId: {},
            migratedAbsoluteNoteClipIds: ['covered', 'kept'],
        });

        const plan = prepareMidiClipFanOutState({
            sourceClipIds: ['covered', 'kept'],
            copies: [{ sourceClipId: 'kept', targetClipId: 'fragment-1' }],
        });

        expect(plan!.next.clips.map((clip) => [clip.clipId, clip.data.notes.present])).toEqual([
            ['covered', false],
            ['kept', false],
            ['fragment-1', true],
        ]);
        expect(plan!.next.migratedAbsoluteNoteClipIds.value).toEqual(['fragment-1']);
    });

    it('moves each migration marker onto the fragments cut from that source', () => {
        midiStore.set({
            notesByClipId: { 'source-a': [note('note-1', 1, 60)], 'source-b': [note('note-2', 1, 62)] },
            ccByClipId: {},
            pitchBendByClipId: {},
            // 'untouched' belongs to another track's clip and must stay put.
            migratedAbsoluteNoteClipIds: ['untouched', 'source-a'],
        });

        const plan = prepareMidiClipFanOutState({
            sourceClipIds: ['source-a', 'source-b'],
            copies: [
                { sourceClipId: 'source-a', targetClipId: 'fragment-1' },
                { sourceClipId: 'source-a', targetClipId: 'fragment-2' },
                { sourceClipId: 'source-b', targetClipId: 'fragment-3' },
            ],
        });

        // A marker means "this data is already converted", and each fragment
        // carries that same converted data; 'source-b' was never converted, so
        // the fragment cut from it stays unmarked.
        expect(plan!.next.migratedAbsoluteNoteClipIds.value).toEqual(['untouched', 'fragment-1', 'fragment-2']);
        expect(plan!.previous.migratedAbsoluteNoteClipIds).toEqual({
            present: true,
            value: ['untouched', 'source-a'],
        });
    });

    it('refuses a target that already holds MIDI data', () => {
        midiStore.set({
            notesByClipId: { 'source-a': [note('note-1', 1, 60)], occupied: [note('note-2', 1, 62)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        expect(
            prepareMidiClipFanOutState({
                sourceClipIds: ['source-a'],
                copies: [{ sourceClipId: 'source-a', targetClipId: 'occupied' }],
            })
        ).toBeNull();
    });

    it('refuses a source note whose probability roll depends on its clip id', () => {
        // The roll is seeded by clip id, so a copy under a new id keeps or
        // drops different notes than the original — the copy would not sound
        // like what it replaces.
        midiStore.set({
            notesByClipId: { 'source-a': [note('note-1', 1, 60, 50)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        expect(
            prepareMidiClipFanOutState({
                sourceClipIds: ['source-a'],
                copies: [{ sourceClipId: 'source-a', targetClipId: 'fragment-1' }],
            })
        ).toBeNull();
    });

    it.each([0, 100])('allows probability %i, which every clip id rolls the same way', (probability) => {
        midiStore.set({
            notesByClipId: { 'source-a': [note('note-1', 1, 60, probability)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        const plan = prepareMidiClipFanOutState({
            sourceClipIds: ['source-a'],
            copies: [{ sourceClipId: 'source-a', targetClipId: 'fragment-1' }],
        });

        expect(plan!.next.clips[1]!.data.notes.value).toMatchObject([{ probability }]);
    });

    it('refuses a copy whose source is not one of the retired clips', () => {
        midiStore.set({
            notesByClipId: { 'source-a': [note('note-1', 1, 60)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        expect(
            prepareMidiClipFanOutState({
                sourceClipIds: ['source-a'],
                copies: [{ sourceClipId: 'stranger', targetClipId: 'fragment-1' }],
            })
        ).toBeNull();
    });

    it('round-trips the whole store through the transition and back', () => {
        midiStore.set({
            notesByClipId: { 'source-a': [note('note-1', 1, 60)], 'source-b': [] },
            ccByClipId: { 'source-a': [{ id: 'cc-1', controller: 7, value: 0.5, beat: 0, channel: 0 }] },
            pitchBendByClipId: { 'source-b': [{ id: 'pb-1', value: 0.25, beat: 2, channel: 0 }] },
            migratedAbsoluteNoteClipIds: ['source-a'],
        });
        const start = structuredClone(midiStore.value!);

        const plan = prepareMidiClipFanOutState({
            sourceClipIds: ['source-a', 'source-b'],
            copies: [
                { sourceClipId: 'source-a', targetClipId: 'fragment-1' },
                { sourceClipId: 'source-a', targetClipId: 'fragment-2' },
                { sourceClipId: 'source-b', targetClipId: 'fragment-3' },
            ],
        })!;

        expect(restoreMidiClipGlueState({ expected: plan.previous, replacement: plan.next })).toBe(true);
        expect(Object.hasOwn(midiStore.value!.notesByClipId, 'source-a')).toBe(false);
        expect(midiStore.value!.notesByClipId['fragment-1']).toMatchObject([{ pitch: 60, startBeat: 1 }]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual(['fragment-1', 'fragment-2']);

        expect(restoreMidiClipGlueState({ expected: plan.next, replacement: plan.previous })).toBe(true);
        // Undo must land on the exact starting shape, including the empty
        // array that 'source-b' held and the absent slots it did not.
        expect(valuesEqual(midiStore.value!, start)).toBe(true);
    });
});
