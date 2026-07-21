import { describe, expect, it, vi } from 'vitest';

import { validateControllerMappingSchema } from '../validateControllerMappingSchema';

import type { ControllerMappingSchemaV1 } from '../../models/ControllerMappingSchema';

type ActionResolver = Parameters<typeof validateControllerMappingSchema>[0]['resolveActionTemplate'];

const effectSpies = {
    dispatch: vi.fn(),
    storeWrite: vi.fn(),
};

function makeRange(min = 0, max = 127): Readonly<Record<string, unknown>> {
    return { min, max };
}

function makeNoteInput(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        kind: 'note',
        channel: 1,
        note: 60,
        value: makeRange(),
        ...overrides,
    };
}

function makeCcInput(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        kind: 'cc',
        channel: 1,
        controller: 21,
        value: makeRange(),
        ...overrides,
    };
}

function makePitchBendInput(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        kind: 'pitch-bend',
        channel: 1,
        value: makeRange(0, 16_383),
        ...overrides,
    };
}

function makeChannelPressureInput(
    overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
    return {
        kind: 'channel-pressure',
        channel: 1,
        value: makeRange(),
        ...overrides,
    };
}

function makeRelativeInput(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        kind: 'relative-encoder',
        channel: 1,
        controller: 21,
        encoding: 'binary-offset',
        value: makeRange(),
        ...overrides,
    };
}

function makeButtonInput(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        kind: 'button-edge',
        source: 'note',
        channel: 1,
        number: 85,
        value: 127,
        edge: 'press',
        ...overrides,
    };
}

function makeInputValueAction(): Readonly<Record<string, unknown>> {
    return {
        type: 'setTempo',
        payload: {
            bpm: { source: 'input-value' },
        },
    };
}

function makeButtonStateAction(): Readonly<Record<string, unknown>> {
    return {
        type: 'muteTrack',
        payload: {
            trackId: { source: 'constant', value: 'track-1' },
            muted: { source: 'button-state' },
        },
    };
}

function makeMapping(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        id: 'mapping-1',
        input: makeNoteInput(),
        action: makeInputValueAction(),
        behavior: { kind: 'jump' },
        curve: { kind: 'linear' },
        ...overrides,
    };
}

function makeMappingForInput(
    input: Readonly<Record<string, unknown>>,
    overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
    if (input.kind === 'relative-encoder') {
        return makeMapping({
            input,
            behavior: {
                kind: 'relative',
                sensitivity: 1,
                acceleration: { kind: 'none' },
            },
            ...overrides,
        });
    }

    if (input.kind === 'button-edge') {
        return makeMapping({ input, action: makeButtonStateAction(), ...overrides });
    }

    return makeMapping({ input, ...overrides });
}

function makeDocument(mappings: readonly unknown[] = [makeMapping()]): Readonly<Record<string, unknown>> {
    return {
        schemaVersion: 1,
        mappings,
    };
}

const fixtureActionResolver: ActionResolver = ({ action, input }) => {
    const payload = action.payload;

    if (action.type === 'togglePlayback') {
        if (payload === null) {
            return { status: 'resolved', actionType: 'togglePlayback' };
        }

        return { status: 'unresolved', reason: 'payload-must-be-null' };
    }

    if (action.type === 'setTempo') {
        if (payload === null || Object.keys(payload).length !== 1) {
            return { status: 'unresolved', reason: 'tempo-payload-shape' };
        }

        const bpm = payload.bpm;
        if (bpm?.source === 'input-value') {
            return { status: 'resolved', actionType: 'setTempo' };
        }

        if (bpm?.source === 'constant' && typeof bpm.value === 'number') {
            return { status: 'resolved', actionType: 'setTempo' };
        }

        return { status: 'unresolved', reason: 'tempo-source' };
    }

    if (action.type === 'muteTrack') {
        if (payload === null || Object.keys(payload).length !== 2) {
            return { status: 'unresolved', reason: 'mute-payload-shape' };
        }

        const trackId = payload.trackId;
        const muted = payload.muted;
        const hasTrackId = trackId?.source === 'constant' && typeof trackId.value === 'string';
        const hasButtonState = muted?.source === 'button-state' && input.kind === 'button-edge';
        if (hasTrackId && hasButtonState) {
            return { status: 'resolved', actionType: 'muteTrack' };
        }

        return { status: 'unresolved', reason: 'mute-source' };
    }

    if (action.type === 'selectTrack') {
        if (payload === null || Object.keys(payload).length !== 1) {
            return { status: 'unresolved', reason: 'target-payload-shape' };
        }

        if (payload.trackId?.source === 'current-target') {
            return { status: 'resolved', actionType: 'selectTrack' };
        }

        return { status: 'unresolved', reason: 'target-source' };
    }

    return { status: 'unresolved', reason: 'unknown-action' };
};

function validate(value: unknown, resolver: ActionResolver = fixtureActionResolver) {
    return validateControllerMappingSchema({ value, resolveActionTemplate: resolver });
}

function expectInvalidCode(value: unknown, code: string, resolver: ActionResolver = fixtureActionResolver): void {
    const result = validate(value, resolver);

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
        expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    }
}

function expectValid(value: unknown, resolver: ActionResolver = fixtureActionResolver): void {
    expect(validate(value, resolver).status).toBe('valid');
}

function expectResolverFailureIsAtomic(resolver: ActionResolver): void {
    effectSpies.dispatch.mockClear();
    effectSpies.storeWrite.mockClear();

    const result = validate(
        makeDocument([
            makeMapping({ id: 'first', input: makeNoteInput({ note: 1 }) }),
            makeMapping({ id: 'second', input: makeNoteInput({ note: 2 }) }),
        ]),
        resolver
    );

    expect(result).toEqual({
        status: 'invalid',
        diagnostics: [{ code: 'UNRESOLVED_ACTION', path: '$.mappings[0].action' }],
    });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(effectSpies.dispatch).not.toHaveBeenCalled();
    expect(effectSpies.storeWrite).not.toHaveBeenCalled();
}

describe('validateControllerMappingSchema', () => {
    describe('exact root shape', () => {
        it('accepts only schema version 1 with an exact mappings array', () => {
            expectValid(makeDocument([]));
            expectInvalidCode({ mappings: [] }, 'INVALID_SCHEMA_VERSION');
            expectInvalidCode({ schemaVersion: 2, mappings: [] }, 'INVALID_SCHEMA_VERSION');
            expectInvalidCode({ schemaVersion: '1', mappings: [] }, 'INVALID_SCHEMA_VERSION');
            expectInvalidCode({ schemaVersion: 1, mappings: {} }, 'INVALID_SHAPE');
            expectInvalidCode({ schemaVersion: 1, mappings: [], extra: true }, 'UNKNOWN_KEY');
        });

        it('rejects symbols, accessors, inherited data, class instances, and decorated arrays', () => {
            const symbolRoot = { schemaVersion: 1, mappings: [] };
            Object.defineProperty(symbolRoot, Symbol('hidden'), { value: true, enumerable: true });

            const accessorRoot = { mappings: [] };
            Object.defineProperty(accessorRoot, 'schemaVersion', {
                get: () => 1,
                enumerable: true,
            });

            const inheritedRoot = Object.create({ schemaVersion: 1 });
            Object.defineProperty(inheritedRoot, 'mappings', { value: [], enumerable: true });

            class SchemaRecord {
                readonly schemaVersion = 1;
                readonly mappings: readonly unknown[] = [];
            }

            const decoratedMappings: unknown[] = [];
            Object.defineProperty(decoratedMappings, 'extra', { value: true, enumerable: true });

            for (const invalid of [
                symbolRoot,
                accessorRoot,
                inheritedRoot,
                new SchemaRecord(),
                { schemaVersion: 1, mappings: decoratedMappings },
            ]) {
                expect(validate(invalid).status).toBe('invalid');
            }
        });
    });

    describe('stable identifiers and scopes', () => {
        it('accepts exact default, layer, and mode scopes', () => {
            expectValid(makeDocument([makeMapping()]));
            expectValid(makeDocument([makeMapping({ layer: 'mix-layer' })]));
            expectValid(makeDocument([makeMapping({ mode: 'device-mode' })]));
        });

        it.each([
            ['blank mapping id', makeMapping({ id: '' }), 'INVALID_ID'],
            ['padded mapping id', makeMapping({ id: ' mapping-1' }), 'INVALID_ID'],
            ['blank layer id', makeMapping({ layer: '' }), 'INVALID_ID'],
            ['padded mode id', makeMapping({ mode: 'mode ' }), 'INVALID_ID'],
            [
                'mutually exclusive layer and mode',
                makeMapping({ layer: 'mix-layer', mode: 'device-mode' }),
                'MUTUALLY_EXCLUSIVE_SCOPE',
            ],
        ])('rejects %s', (_label, mapping, code) => {
            expectInvalidCode(makeDocument([mapping]), code);
        });

        it.each([
            ['present undefined layer', makeMapping({ layer: undefined }), 'INVALID_ID'],
            ['present undefined mode', makeMapping({ mode: undefined }), 'INVALID_ID'],
            ['present undefined feedback', makeMapping({ feedback: undefined }), 'INVALID_FEEDBACK'],
            [
                'present undefined layer and mode',
                makeMapping({ layer: undefined, mode: undefined }),
                'MUTUALLY_EXCLUSIVE_SCOPE',
            ],
        ])('rejects %s instead of treating the key as absent', (_label, mapping, code) => {
            expectInvalidCode(makeDocument([mapping]), code);
        });

        it('rejects duplicate mapping IDs exactly and case-sensitively across scopes', () => {
            expectInvalidCode(
                makeDocument([
                    makeMapping({ id: 'duplicate', layer: 'one' }),
                    makeMapping({ id: 'duplicate', layer: 'two', input: makeCcInput() }),
                ]),
                'DUPLICATE_MAPPING_ID'
            );

            expectValid(
                makeDocument([
                    makeMapping({ id: 'Mapping', layer: 'one' }),
                    makeMapping({ id: 'mapping', layer: 'two', input: makeCcInput() }),
                ])
            );
        });
    });

    describe('exact input variants and numeric boundaries', () => {
        const validInputs: readonly [string, Readonly<Record<string, unknown>>][] = [
            ['note lower', makeNoteInput({ channel: 1, note: 0, value: makeRange(0, 0) })],
            ['note upper', makeNoteInput({ channel: 16, note: 127, value: makeRange(127, 127) })],
            ['cc lower', makeCcInput({ channel: 1, controller: 0, value: makeRange(0, 0) })],
            ['cc upper', makeCcInput({ channel: 16, controller: 127, value: makeRange(127, 127) })],
            ['pitch lower', makePitchBendInput({ channel: 1, value: makeRange(0, 0) })],
            ['pitch upper', makePitchBendInput({ channel: 16, value: makeRange(16_383, 16_383) })],
            ['pressure lower', makeChannelPressureInput({ channel: 1, value: makeRange(0, 0) })],
            ['pressure upper', makeChannelPressureInput({ channel: 16, value: makeRange(127, 127) })],
            [
                'relative lower',
                makeRelativeInput({
                    channel: 1,
                    controller: 0,
                    encoding: 'binary-offset',
                    value: makeRange(0, 0),
                }),
            ],
            [
                'relative upper',
                makeRelativeInput({
                    channel: 16,
                    controller: 127,
                    encoding: 'signed-bit',
                    value: makeRange(127, 127),
                }),
            ],
            ['relative alternate encoding', makeRelativeInput({ encoding: "two's-complement" })],
            ['button lower', makeButtonInput({ source: 'note', channel: 1, number: 0, value: 0, edge: 'press' })],
            ['button upper', makeButtonInput({ source: 'cc', channel: 16, number: 127, value: 127, edge: 'release' })],
        ];

        it.each(validInputs)('accepts %s boundaries', (_label, input) => {
            expectValid(makeDocument([makeMappingForInput(input)]));
        });

        const invalidInputs: readonly [string, Readonly<Record<string, unknown>>][] = [
            ['note channel below', makeNoteInput({ channel: 0 })],
            ['note channel above', makeNoteInput({ channel: 17 })],
            ['note number below', makeNoteInput({ note: -1 })],
            ['note number above', makeNoteInput({ note: 128 })],
            ['note fractional', makeNoteInput({ note: 1.5 })],
            ['note non-finite', makeNoteInput({ note: Number.NaN })],
            ['note reversed range', makeNoteInput({ value: makeRange(100, 10) })],
            ['note range below', makeNoteInput({ value: makeRange(-1, 10) })],
            ['note range above', makeNoteInput({ value: makeRange(10, 128) })],
            ['note missing', { kind: 'note', channel: 1, note: 60 }],
            ['note wrong discriminant', makeNoteInput({ kind: 'notes' })],
            ['note additional field', makeNoteInput({ threshold: 1 })],
            ['cc channel below', makeCcInput({ channel: 0 })],
            ['cc channel above', makeCcInput({ channel: 17 })],
            ['cc controller below', makeCcInput({ controller: -1 })],
            ['cc controller above', makeCcInput({ controller: 128 })],
            ['cc fractional', makeCcInput({ controller: 1.5 })],
            ['cc non-finite', makeCcInput({ controller: Number.POSITIVE_INFINITY })],
            ['cc reversed range', makeCcInput({ value: makeRange(100, 10) })],
            ['cc range below', makeCcInput({ value: makeRange(-1, 10) })],
            ['cc range above', makeCcInput({ value: makeRange(10, 128) })],
            ['cc missing', { kind: 'cc', channel: 1, controller: 21 }],
            ['cc wrong discriminant', makeCcInput({ kind: 'control-change' })],
            ['cc additional field', makeCcInput({ threshold: 1 })],
            ['pitch channel below', makePitchBendInput({ channel: 0 })],
            ['pitch channel above', makePitchBendInput({ channel: 17 })],
            ['pitch fractional', makePitchBendInput({ channel: 1.5 })],
            ['pitch non-finite', makePitchBendInput({ channel: Number.NaN })],
            ['pitch reversed range', makePitchBendInput({ value: makeRange(12_000, 100) })],
            ['pitch range below', makePitchBendInput({ value: makeRange(-1, 100) })],
            ['pitch range above', makePitchBendInput({ value: makeRange(100, 16_384) })],
            ['pitch missing', { kind: 'pitch-bend', channel: 1 }],
            ['pitch wrong discriminant', makePitchBendInput({ kind: 'pitch' })],
            ['pitch additional field', makePitchBendInput({ signed: true })],
            ['pressure channel below', makeChannelPressureInput({ channel: 0 })],
            ['pressure channel above', makeChannelPressureInput({ channel: 17 })],
            ['pressure fractional', makeChannelPressureInput({ channel: 1.5 })],
            ['pressure non-finite', makeChannelPressureInput({ channel: Number.NEGATIVE_INFINITY })],
            ['pressure reversed range', makeChannelPressureInput({ value: makeRange(100, 10) })],
            ['pressure range below', makeChannelPressureInput({ value: makeRange(-1, 10) })],
            ['pressure range above', makeChannelPressureInput({ value: makeRange(10, 128) })],
            ['pressure missing', { kind: 'channel-pressure', channel: 1 }],
            ['pressure wrong discriminant', makeChannelPressureInput({ kind: 'pressure' })],
            ['pressure additional field', makeChannelPressureInput({ note: 60 })],
            ['relative channel below', makeRelativeInput({ channel: 0 })],
            ['relative channel above', makeRelativeInput({ channel: 17 })],
            ['relative controller below', makeRelativeInput({ controller: -1 })],
            ['relative controller above', makeRelativeInput({ controller: 128 })],
            ['relative fractional', makeRelativeInput({ controller: 1.5 })],
            ['relative non-finite', makeRelativeInput({ controller: Number.NaN })],
            ['relative reversed range', makeRelativeInput({ value: makeRange(100, 10) })],
            ['relative range below', makeRelativeInput({ value: makeRange(-1, 10) })],
            ['relative range above', makeRelativeInput({ value: makeRange(10, 128) })],
            ['relative missing', { kind: 'relative-encoder', channel: 1, controller: 21, value: makeRange() }],
            ['relative wrong discriminant', makeRelativeInput({ kind: 'relative' })],
            ['relative wrong encoding', makeRelativeInput({ encoding: 'offset-binary' })],
            ['relative additional field', makeRelativeInput({ delta: 1 })],
            ['button channel below', makeButtonInput({ channel: 0 })],
            ['button channel above', makeButtonInput({ channel: 17 })],
            ['button number below', makeButtonInput({ number: -1 })],
            ['button number above', makeButtonInput({ number: 128 })],
            ['button value below', makeButtonInput({ value: -1 })],
            ['button value above', makeButtonInput({ value: 128 })],
            ['button fractional', makeButtonInput({ value: 1.5 })],
            ['button non-finite', makeButtonInput({ value: Number.NaN })],
            ['button reversed-range object', makeButtonInput({ value: makeRange(100, 10) })],
            ['button missing', { kind: 'button-edge', source: 'note', channel: 1, number: 85, value: 127 }],
            ['button wrong discriminant', makeButtonInput({ kind: 'button' })],
            ['button wrong source', makeButtonInput({ source: 'pitch-bend' })],
            ['button wrong edge', makeButtonInput({ edge: 'held' })],
            ['button additional field', makeButtonInput({ threshold: 1 })],
        ];

        it.each(invalidInputs)('rejects %s', (_label, input) => {
            expect(validate(makeDocument([makeMappingForInput(input)])).status).toBe('invalid');
        });
    });

    describe('physical overlap', () => {
        function overlapDocument(
            firstInput: Readonly<Record<string, unknown>>,
            secondInput: Readonly<Record<string, unknown>>,
            firstScope: Readonly<Record<string, unknown>> = {},
            secondScope: Readonly<Record<string, unknown>> = {}
        ): Readonly<Record<string, unknown>> {
            return makeDocument([
                makeMappingForInput(firstInput, { id: 'first', ...firstScope }),
                makeMappingForInput(secondInput, { id: 'second', ...secondScope }),
            ]);
        }

        it.each([
            [
                'equal note ranges',
                overlapDocument(
                    makeNoteInput({ value: makeRange(0, 64) }),
                    makeNoteInput({ value: makeRange(64, 127) })
                ),
            ],
            [
                'note and button raw event',
                overlapDocument(
                    makeNoteInput({ note: 85, value: makeRange(1, 127) }),
                    makeButtonInput({ source: 'note', number: 85, value: 127 })
                ),
            ],
            [
                'CC and relative encoder raw event',
                overlapDocument(
                    makeCcInput({ value: makeRange(0, 64) }),
                    makeRelativeInput({ value: makeRange(64, 127) })
                ),
            ],
            [
                'CC and button raw event',
                overlapDocument(
                    makeCcInput({ controller: 85, value: makeRange(1, 127) }),
                    makeButtonInput({ source: 'cc', number: 85, value: 127 })
                ),
            ],
            [
                'relative encoder and button raw event',
                overlapDocument(
                    makeRelativeInput({ controller: 85, value: makeRange(1, 127) }),
                    makeButtonInput({ source: 'cc', number: 85, value: 127 })
                ),
            ],
            ['same button edge', overlapDocument(makeButtonInput(), makeButtonInput())],
            [
                'same pitch-bend range',
                overlapDocument(
                    makePitchBendInput({ value: makeRange(0, 8_192) }),
                    makePitchBendInput({ value: makeRange(8_192, 16_383) })
                ),
            ],
            [
                'same channel-pressure range',
                overlapDocument(
                    makeChannelPressureInput({ value: makeRange(0, 64) }),
                    makeChannelPressureInput({ value: makeRange(64, 127) })
                ),
            ],
            ['same layer', overlapDocument(makeNoteInput(), makeNoteInput(), { layer: 'mix' }, { layer: 'mix' })],
            ['same mode', overlapDocument(makeNoteInput(), makeNoteInput(), { mode: 'device' }, { mode: 'device' })],
        ])('rejects %s', (_label, document) => {
            expectInvalidCode(document, 'OVERLAPPING_INPUT');
        });

        it.each([
            [
                'disjoint note ranges',
                overlapDocument(
                    makeNoteInput({ value: makeRange(0, 63) }),
                    makeNoteInput({ value: makeRange(64, 127) })
                ),
            ],
            ['different note number', overlapDocument(makeNoteInput({ note: 60 }), makeNoteInput({ note: 61 }))],
            [
                'opposite button edge',
                overlapDocument(makeButtonInput({ edge: 'press' }), makeButtonInput({ edge: 'release' })),
            ],
            [
                'button value outside note range',
                overlapDocument(
                    makeNoteInput({ note: 85, value: makeRange(1, 126) }),
                    makeButtonInput({ source: 'note', number: 85, value: 127 })
                ),
            ],
            [
                'different layers',
                overlapDocument(makeNoteInput(), makeNoteInput(), { layer: 'mix-a' }, { layer: 'mix-b' }),
            ],
            [
                'different modes',
                overlapDocument(makeNoteInput(), makeNoteInput(), { mode: 'device-a' }, { mode: 'device-b' }),
            ],
            ['layer versus mode', overlapDocument(makeNoteInput(), makeNoteInput(), { layer: 'mix' }, { mode: 'mix' })],
        ])('accepts %s as independent', (_label, document) => {
            expectValid(document);
        });
    });

    describe('behavior and curve contracts', () => {
        it.each([
            ['jump', makeMapping({ behavior: { kind: 'jump' } })],
            ['pickup', makeMapping({ behavior: { kind: 'pickup' } })],
            ['scaled pickup', makeMapping({ behavior: { kind: 'scaled-pickup' } })],
            [
                'relative with no acceleration',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: { kind: 'relative', sensitivity: Number.MIN_VALUE, acceleration: { kind: 'none' } },
                }),
            ],
            [
                'relative with linear acceleration boundary',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: { kind: 'relative', sensitivity: 1, acceleration: { kind: 'linear', factor: 1 } },
                }),
            ],
            ['linear curve', makeMapping({ curve: { kind: 'linear' } })],
            ['log curve', makeMapping({ curve: { kind: 'log', base: 1.000_001 } })],
            ['exponential curve', makeMapping({ curve: { kind: 'exp', exponent: Number.MIN_VALUE } })],
        ])('accepts %s', (_label, mapping) => {
            expectValid(makeDocument([mapping]));
        });

        it.each([
            [
                'relative behavior on note',
                makeMapping({ behavior: { kind: 'relative', sensitivity: 1, acceleration: { kind: 'none' } } }),
            ],
            [
                'non-relative behavior on encoder',
                makeMappingForInput(makeRelativeInput(), { behavior: { kind: 'jump' } }),
            ],
            ['pickup on button', makeMappingForInput(makeButtonInput(), { behavior: { kind: 'pickup' } })],
            [
                'missing relative sensitivity',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: { kind: 'relative', acceleration: { kind: 'none' } },
                }),
            ],
            [
                'zero sensitivity',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: { kind: 'relative', sensitivity: 0, acceleration: { kind: 'none' } },
                }),
            ],
            [
                'negative sensitivity',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: { kind: 'relative', sensitivity: -1, acceleration: { kind: 'none' } },
                }),
            ],
            [
                'NaN sensitivity',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: { kind: 'relative', sensitivity: Number.NaN, acceleration: { kind: 'none' } },
                }),
            ],
            [
                'infinite sensitivity',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: {
                        kind: 'relative',
                        sensitivity: Number.POSITIVE_INFINITY,
                        acceleration: { kind: 'none' },
                    },
                }),
            ],
            [
                'linear factor below boundary',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: { kind: 'relative', sensitivity: 1, acceleration: { kind: 'linear', factor: 0.999 } },
                }),
            ],
            [
                'non-finite linear factor',
                makeMappingForInput(makeRelativeInput(), {
                    behavior: {
                        kind: 'relative',
                        sensitivity: 1,
                        acceleration: { kind: 'linear', factor: Number.POSITIVE_INFINITY },
                    },
                }),
            ],
            ['extra behavior key', makeMapping({ behavior: { kind: 'jump', tolerance: 1 } })],
        ])('rejects invalid behavior: %s', (_label, mapping) => {
            expect(validate(makeDocument([mapping])).status).toBe('invalid');
        });

        it.each([
            ['log boundary', makeMapping({ curve: { kind: 'log', base: 1 } })],
            ['log negative', makeMapping({ curve: { kind: 'log', base: -2 } })],
            ['log NaN', makeMapping({ curve: { kind: 'log', base: Number.NaN } })],
            ['log infinite', makeMapping({ curve: { kind: 'log', base: Number.POSITIVE_INFINITY } })],
            ['exp zero', makeMapping({ curve: { kind: 'exp', exponent: 0 } })],
            ['exp negative', makeMapping({ curve: { kind: 'exp', exponent: -1 } })],
            ['exp NaN', makeMapping({ curve: { kind: 'exp', exponent: Number.NaN } })],
            ['exp infinite', makeMapping({ curve: { kind: 'exp', exponent: Number.POSITIVE_INFINITY } })],
            ['missing log base', makeMapping({ curve: { kind: 'log' } })],
            ['extra curve key', makeMapping({ curve: { kind: 'linear', exponent: 2 } })],
            [
                'non-linear relative curve',
                makeMappingForInput(makeRelativeInput(), { curve: { kind: 'log', base: 2 } }),
            ],
            [
                'non-linear button curve',
                makeMappingForInput(makeButtonInput(), { curve: { kind: 'exp', exponent: 2 } }),
            ],
        ])('rejects invalid curve: %s', (_label, mapping) => {
            expect(validate(makeDocument([mapping])).status).toBe('invalid');
        });
    });

    describe('feedback metadata', () => {
        it.each([
            ['note lower', { kind: 'note', channel: 1, note: 0, offValue: 0, onValue: 0 }],
            ['note upper', { kind: 'note', channel: 16, note: 127, offValue: 127, onValue: 127 }],
            ['CC boundaries', { kind: 'cc', channel: 16, controller: 127, value: makeRange(0, 127) }],
            ['pitch-bend boundaries', { kind: 'pitch-bend', channel: 16, value: makeRange(0, 16_383) }],
        ])('accepts %s without output effects', (_label, feedback) => {
            effectSpies.dispatch.mockClear();
            effectSpies.storeWrite.mockClear();

            expectValid(makeDocument([makeMapping({ feedback })]));
            expect(effectSpies.dispatch).not.toHaveBeenCalled();
            expect(effectSpies.storeWrite).not.toHaveBeenCalled();
        });

        it.each([
            ['note channel below', { kind: 'note', channel: 0, note: 0, offValue: 0, onValue: 127 }],
            ['note data above', { kind: 'note', channel: 1, note: 128, offValue: 0, onValue: 127 }],
            ['note fractional', { kind: 'note', channel: 1, note: 1.5, offValue: 0, onValue: 127 }],
            ['CC reversed range', { kind: 'cc', channel: 1, controller: 1, value: makeRange(100, 10) }],
            ['CC range above', { kind: 'cc', channel: 1, controller: 1, value: makeRange(0, 128) }],
            ['pitch range above', { kind: 'pitch-bend', channel: 1, value: makeRange(0, 16_384) }],
            ['unknown kind', { kind: 'poly-pressure', channel: 1, value: makeRange() }],
            ['additional key', { kind: 'pitch-bend', channel: 1, value: makeRange(0, 16_383), portId: 'out' }],
        ])('rejects %s', (_label, feedback) => {
            expect(validate(makeDocument([makeMapping({ feedback })])).status).toBe('invalid');
        });
    });

    describe('action-template resolution', () => {
        it('accepts payloadless, constant, input-value, and button-state templates', () => {
            const mappings = [
                makeMapping({
                    id: 'payloadless',
                    input: makeNoteInput({ note: 1 }),
                    action: { type: 'togglePlayback', payload: null },
                }),
                makeMapping({
                    id: 'constant',
                    input: makeNoteInput({ note: 2 }),
                    action: { type: 'setTempo', payload: { bpm: { source: 'constant', value: 120 } } },
                }),
                makeMapping({ id: 'input', input: makeCcInput({ controller: 3 }), action: makeInputValueAction() }),
                makeMappingForInput(makeButtonInput({ number: 4 }), { id: 'button', action: makeButtonStateAction() }),
            ];

            expectValid(makeDocument(mappings));
        });

        it.each([
            ['selected-track-id', { kind: 'selected-track-id' }],
            ['track-bank-slot-id lower', { kind: 'track-bank-slot-id', slot: 0 }],
            ['track-bank-slot-id upper', { kind: 'track-bank-slot-id', slot: 7 }],
            ['focused-clip-id', { kind: 'focused-clip-id' }],
            ['selected-device-id', { kind: 'selected-device-id' }],
            ['selected-device-parameter-id lower', { kind: 'selected-device-parameter-id', slot: 0 }],
            ['selected-device-parameter-id upper', { kind: 'selected-device-parameter-id', slot: 7 }],
            ['selected-send-id lower', { kind: 'selected-send-id', slot: 0 }],
            ['selected-send-id upper', { kind: 'selected-send-id', slot: 7 }],
        ])('accepts current-target resolver %s', (_label, resolver) => {
            const action = {
                type: 'selectTrack',
                payload: {
                    trackId: { source: 'current-target', resolver },
                },
            };

            expectValid(makeDocument([makeMapping({ action })]));
        });

        it.each([
            ['unknown action', { type: 'not-an-action', payload: null }],
            ['unknown payload field', { type: 'setTempo', payload: { speed: { source: 'input-value' } } }],
            ['missing payload field', { type: 'setTempo', payload: {} }],
            [
                'extra payload field',
                {
                    type: 'setTempo',
                    payload: {
                        bpm: { source: 'input-value' },
                        extra: { source: 'constant', value: 1 },
                    },
                },
            ],
            ['incompatible source', { type: 'setTempo', payload: { bpm: { source: 'button-state' } } }],
            [
                'incompatible target resolver',
                {
                    type: 'setTempo',
                    payload: { bpm: { source: 'current-target', resolver: { kind: 'selected-track-id' } } },
                },
            ],
            [
                'invalid negative target slot',
                {
                    type: 'selectTrack',
                    payload: {
                        trackId: { source: 'current-target', resolver: { kind: 'track-bank-slot-id', slot: -1 } },
                    },
                },
            ],
            [
                'invalid upper target slot',
                {
                    type: 'selectTrack',
                    payload: { trackId: { source: 'current-target', resolver: { kind: 'selected-send-id', slot: 8 } } },
                },
            ],
            [
                'fractional target slot',
                {
                    type: 'selectTrack',
                    payload: {
                        trackId: {
                            source: 'current-target',
                            resolver: { kind: 'selected-device-parameter-id', slot: 1.5 },
                        },
                    },
                },
            ],
            [
                'constant non-JSON value',
                { type: 'setTempo', payload: { bpm: { source: 'constant', value: Number.NaN } } },
            ],
            [
                'action-value additional key',
                { type: 'setTempo', payload: { bpm: { source: 'input-value', scale: 2 } } },
            ],
        ])('returns UNRESOLVED_ACTION for %s', (_label, action) => {
            effectSpies.dispatch.mockClear();
            effectSpies.storeWrite.mockClear();

            expectInvalidCode(makeDocument([makeMapping({ action })]), 'UNRESOLVED_ACTION');
            expect(effectSpies.dispatch).not.toHaveBeenCalled();
            expect(effectSpies.storeWrite).not.toHaveBeenCalled();
        });

        it('preserves an own JSON __proto__ payload key for exact resolver rejection', () => {
            const payload: unknown = JSON.parse(
                '{"bpm":{"source":"input-value"},"__proto__":{"source":"constant","value":1}}'
            );
            const observedKeys: PropertyKey[][] = [];
            const exactResolver: ActionResolver = ({ action }) => {
                if (action.payload === null) {
                    return { status: 'unresolved', reason: 'payload-must-be-an-object' };
                }

                const keys = Reflect.ownKeys(action.payload);
                observedKeys.push(keys);
                if (keys.length === 1 && keys[0] === 'bpm') {
                    return { status: 'resolved', actionType: 'setTempo' };
                }

                return { status: 'unresolved', reason: 'unexpected-payload-key' };
            };
            const action = { type: 'setTempo', payload };

            const result = validate(makeDocument([makeMapping({ action })]), exactResolver);

            expect(observedKeys).toEqual([['bpm', '__proto__']]);
            expect(result).toEqual({
                status: 'invalid',
                diagnostics: [{ code: 'UNRESOLVED_ACTION', path: '$.mappings[0].action' }],
            });
        });

        it('catches a resolver throw and attempts no later resolver or effect', () => {
            const throwingResolver: ActionResolver = vi.fn(() => {
                throw new Error('registry unavailable');
            });

            const result = validate(
                makeDocument([
                    makeMapping({ id: 'first', input: makeNoteInput({ note: 1 }) }),
                    makeMapping({ id: 'second', input: makeNoteInput({ note: 2 }) }),
                ]),
                throwingResolver
            );

            expect(result.status).toBe('invalid');
            if (result.status === 'invalid') {
                expect(result.diagnostics).toEqual([{ code: 'UNRESOLVED_ACTION', path: '$.mappings[0].action' }]);
            }
            expect(throwingResolver).toHaveBeenCalledTimes(1);
            expect(effectSpies.dispatch).not.toHaveBeenCalled();
            expect(effectSpies.storeWrite).not.toHaveBeenCalled();
        });

        it('rejects a null resolver result without attempting the later mapping', () => {
            const holder: { value: ReturnType<ActionResolver> } = {
                value: { status: 'unresolved', reason: 'placeholder' },
            };
            Reflect.set(holder, 'value', null);
            const nullResolver: ActionResolver = vi.fn(() => holder.value);

            expectResolverFailureIsAtomic(nullResolver);
        });

        it('rejects a throwing status accessor without reading it or attempting the later mapping', () => {
            let statusReads = 0;
            const resolution: ReturnType<ActionResolver> = {
                status: 'resolved',
                actionType: 'setTempo',
            };
            Object.defineProperty(resolution, 'status', {
                configurable: true,
                enumerable: true,
                get() {
                    statusReads += 1;
                    throw new Error('status unavailable');
                },
            });
            const accessorResolver: ActionResolver = vi.fn(() => resolution);

            expectResolverFailureIsAtomic(accessorResolver);
            expect(statusReads).toBe(0);
        });

        it('rejects a throwing actionType accessor without reading it or attempting the later mapping', () => {
            let actionTypeReads = 0;
            const resolution: ReturnType<ActionResolver> = {
                status: 'resolved',
                actionType: 'setTempo',
            };
            Object.defineProperty(resolution, 'actionType', {
                configurable: true,
                enumerable: true,
                get() {
                    actionTypeReads += 1;
                    throw new Error('action type unavailable');
                },
            });
            const accessorResolver: ActionResolver = vi.fn(() => resolution);

            expectResolverFailureIsAtomic(accessorResolver);
            expect(actionTypeReads).toBe(0);
        });

        it('rejects a changing actionType getter without reading divergent values', () => {
            let actionTypeReads = 0;
            const resolution: ReturnType<ActionResolver> = {
                status: 'resolved',
                actionType: 'setTempo',
            };
            Object.defineProperty(resolution, 'actionType', {
                configurable: true,
                enumerable: true,
                get() {
                    actionTypeReads += 1;
                    if (actionTypeReads === 1) {
                        return 'setTempo';
                    }

                    return 'muteTrack';
                },
            });
            const changingResolver: ActionResolver = vi.fn(() => resolution);

            expectResolverFailureIsAtomic(changingResolver);
            expect(actionTypeReads).toBe(0);
        });
    });

    describe('atomic deterministic output', () => {
        it('returns diagnostics without a partial schema when the final row is invalid', () => {
            const document = makeDocument([
                makeMapping({ id: 'valid-first', input: makeNoteInput({ note: 1 }) }),
                makeMapping({ id: 'invalid-final', input: makeNoteInput({ note: 2, channel: 17 }) }),
            ]);

            const first = validate(document);
            const second = validate(document);

            expect(first).toEqual(second);
            expect(first.status).toBe('invalid');
            expect('value' in first).toBe(false);
            if (first.status === 'invalid') {
                expect(first.diagnostics).toEqual([{ code: 'INVALID_RANGE', path: '$.mappings[1].input.channel' }]);
            }
        });

        it('returns a fresh deep-frozen value that does not alias caller records or arrays', () => {
            const callerMapping = makeMapping();
            const callerMappings = [callerMapping];
            const input = makeDocument(callerMappings);
            const result = validate(input);

            expect(result.status).toBe('valid');
            if (result.status !== 'valid') {
                return;
            }

            expect(result.value).not.toBe(input);
            expect(result.value.mappings).not.toBe(callerMappings);
            expect(result.value.mappings[0]).not.toBe(callerMapping);
            expect(Object.isFrozen(result.value)).toBe(true);
            expect(Object.isFrozen(result.value.mappings)).toBe(true);
            expect(Object.isFrozen(result.value.mappings[0]?.input)).toBe(true);
            expect(Object.isFrozen(result.value.mappings[0]?.action.payload)).toBe(true);
        });
    });
});

function compileTimeContractFixtures(
    schema: ControllerMappingSchemaV1,
    result: ReturnType<typeof validateControllerMappingSchema>
): void {
    // @ts-expect-error Mapping collections are readonly.
    schema.mappings.push(schema.mappings[0]);

    if (result.status === 'invalid') {
        // @ts-expect-error Diagnostic collections are readonly.
        result.diagnostics.push(result.diagnostics[0]);
    }

    const invalidActionType: ControllerMappingSchemaV1 = {
        schemaVersion: 1,
        mappings: [
            {
                id: 'typed-fixture',
                input: { kind: 'note', channel: 1, note: 60, value: { min: 0, max: 127 } },
                action: {
                    // @ts-expect-error Action type is constrained to AppAction['type'].
                    type: 'not-an-app-action',
                    payload: null,
                },
                behavior: { kind: 'jump' },
                curve: { kind: 'linear' },
            },
        ],
    };

    void invalidActionType;
}

if (false) {
    // @ts-expect-error The public validator has no unknown-input overload.
    validateControllerMappingSchema(null);
    // @ts-expect-error The resolver is required and callable.
    validateControllerMappingSchema({ value: makeDocument(), resolveActionTemplate: 'resolver' });
    void compileTimeContractFixtures;
}
