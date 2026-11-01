import { from } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    findAutomergeStorageRawProjectionLosses,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';

import { isValidMidiNoteExpression } from '../../models/MidiNote';
import { defaultMidiStoreState, midiStore } from '../midiStore';

const NOTE_DURATION = 2;

type ExpressionFixture = Record<string, unknown>;

/** The same value as a live Automerge document object: it carries the symbol
 *  metadata (`_am_objectId`, `_am_meta`, ...) the raw project slot holds. */
function readFromAutomergeDocument(expression: ExpressionFixture): unknown {
    return from({ expression }).expression;
}

function validCurve(): Array<Record<string, unknown>> {
    return [{ offsetBeats: 0.5, value: 100 }];
}

describe('note expression read from the raw project document (#5972)', () => {
    let stopProjectionBridge: () => void;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('midi expression raw projection loss');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
    });

    afterEach(() => {
        stopProjectionBridge();
        setTrackStoreState(structuredClone(defaultTrackState));
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('reports no projection loss for a note carrying a pitch-bend curve', () => {
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track-1', name: 'MIDI', kind: 'midi' })],
            selectedTrackId: 'track-1',
        });
        addClip({ id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Clip', type: 'midi' });
        midiStore.set({
            ...defaultMidiStoreState,
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'note-1',
                        pitch: 60,
                        startBeat: 0,
                        duration: NOTE_DURATION,
                        velocity: 100,
                        expression: { pitchBend: [{ offsetBeats: 0.5, value: 100 }] },
                    },
                ],
            },
        });
        flushAutomergeStorageWrites();

        expect(findAutomergeStorageRawProjectionLosses({ docId: 'root', document: getCrdtDoc('root') })).toEqual([]);
    });

    describe.each([
        ['a plain object', (expression: ExpressionFixture): unknown => structuredClone(expression)],
        ['an Automerge document object', readFromAutomergeDocument],
    ] as const)('read from %s', (_label, read) => {
        it('accepts a curve in each dimension', () => {
            expect(
                isValidMidiNoteExpression(
                    read({
                        pitchBend: [
                            { offsetBeats: 0.5, value: -100 },
                            { offsetBeats: 1, value: 100 },
                        ],
                        pressure: [{ offsetBeats: 0.5, value: 90 }],
                        slide: validCurve(),
                    }),
                    NOTE_DURATION
                )
            ).toBe(true);
        });

        it.each<readonly [string, ExpressionFixture]>([
            ['an extra expression key', { pitchBend: validCurve(), vibrato: validCurve() }],
            ['an empty expression', {}],
            ['an extra point key', { pitchBend: [{ offsetBeats: 0.5, value: 100, label: 'x' }] }],
            ['a point missing its offset', { pitchBend: [{ value: 100 }] }],
            ['a point missing its value', { pitchBend: [{ offsetBeats: 0.5 }] }],
            ['a non-finite offset', { pitchBend: [{ offsetBeats: Number.NaN, value: 100 }] }],
            ['a non-finite value', { pitchBend: [{ offsetBeats: 0.5, value: Number.POSITIVE_INFINITY }] }],
            ['a string value', { pitchBend: [{ offsetBeats: 0.5, value: '100' }] }],
            ['a string offset', { pitchBend: [{ offsetBeats: '0.5', value: 100 }] }],
            ['an offset at the note end', { pitchBend: [{ offsetBeats: NOTE_DURATION, value: 100 }] }],
            ['a pressure value above 7 bits', { pressure: [{ offsetBeats: 0.5, value: 128 }] }],
            ['an empty curve', { pitchBend: [] }],
            ['a curve that is not an array', { pitchBend: { offsetBeats: 0.5, value: 100 } }],
        ])('rejects %s', (_name, expression) => {
            expect(isValidMidiNoteExpression(read(expression), NOTE_DURATION)).toBe(false);
        });
    });
});
