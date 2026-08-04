import { describe, it, expect } from 'vitest';

import { midiTimeStateCodec } from '../midiTimeStateCodec';

import type { MidiStoreState } from '#/modules/MIDI/stores/midiStore';

/**
 * The codec encodes/decodes MidiStoreState to/from a canonical AST for CRDT
 * collaboration snapshots. This spec covers round-trip fidelity, negative-zero
 * distinction, structural rejection paths, and equality semantics.
 */

function makeState(overrides: Partial<MidiStoreState> = {}): MidiStoreState {
    return {
        probabilitySeed: 42,
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
        ...overrides,
    };
}

const { encodeState, decodeState, statesEqual, stateMatchesSnapshot } = midiTimeStateCodec;

describe('midiTimeStateCodec — round-trip fidelity', () => {
    it('round-trips an empty state', () => {
        const state = makeState();
        const encoded = encodeState(state);
        expect(encoded).not.toBeNull();
        const decoded = decodeState(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded).toEqual(state);
    });

    it('round-trips a state with notes', () => {
        const state = makeState({
            notesByClipId: {
                clip1: [
                    { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                    { id: 'n2', pitch: 64, startBeat: 1, duration: 0.5, velocity: 80 },
                ],
            },
        });
        const encoded = encodeState(state);
        const decoded = decodeState(encoded);
        expect(decoded).toEqual(state);
    });

    it('round-trips a state with CC and pitch bend data', () => {
        const state = makeState({
            ccByClipId: { clip1: [{ id: 'cc1', controller: 1, value: 64, beat: 0, channel: 0 }] },
            pitchBendByClipId: { clip1: [{ id: 'pb1', value: 0.5, beat: 2, channel: 0 }] },
        });
        const encoded = encodeState(state);
        const decoded = decodeState(encoded);
        expect(decoded).toEqual(state);
    });

    it('round-trips the optional migratedAbsoluteNoteClipIds field', () => {
        const state = makeState({ migratedAbsoluteNoteClipIds: ['clip1', 'clip2'] });
        const encoded = encodeState(state);
        const decoded = decodeState(encoded);
        expect(decoded).toEqual(state);
    });
});

describe('midiTimeStateCodec — negative-zero distinction', () => {
    it('encodes -0 as a negative-zero node, not a number node', () => {
        // A note with pitchBend: -0 should encode as negative-zero type.
        // We verify this indirectly: encode, then decode, then check Object.is for -0.
        const state = makeState({
            notesByClipId: {
                clip1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, pitchBend: -0 }],
            },
        });
        const encoded = encodeState(state);
        expect(encoded).not.toBeNull();
        const decoded = decodeState(encoded)!;
        const note = decoded.notesByClipId['clip1']?.[0];
        expect(Object.is(note?.pitchBend, -0)).toBe(true);
    });

    it('statesEqual distinguishes -0 from +0 in nested values', () => {
        const withZero = makeState({
            notesByClipId: { clip1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, pitchBend: 0 }] },
        });
        const withNegZero = makeState({
            notesByClipId: {
                clip1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, pitchBend: -0 }],
            },
        });
        // Object.is(0, -0) === false, so the states must NOT be equal.
        expect(statesEqual(withZero, withNegZero)).toBe(false);
        expect(statesEqual(withZero, withZero)).toBe(true);
    });
});

describe('midiTimeStateCodec — encode rejection paths', () => {
    it('rejects non-finite numbers (NaN, Infinity)', () => {
        const state = makeState({
            notesByClipId: {
                clip1: [{ id: 'n1', pitch: Number.NaN, startBeat: 0, duration: 1, velocity: 100 }],
            },
        });
        expect(encodeState(state)).toBeNull();
    });

    it('rejects a state with a non-plain prototype', () => {
        class FakeState {
            probabilitySeed = 42;
            notesByClipId = {};
            ccByClipId = {};
            pitchBendByClipId = {};
        }
        expect(encodeState(new FakeState())).toBeNull();
    });

    it('rejects a state missing a required key', () => {
        const incomplete = {
            probabilitySeed: 42,
            notesByClipId: {},
            ccByClipId: {},
            // missing pitchBendByClipId
        };
        expect(encodeState(incomplete)).toBeNull();
    });

    it('rejects a state with an unknown key on decode (hasCanonicalMidiStoreStateKeys)', () => {
        // Encode a valid state, then tamper the encoded AST with an unknown key.
        // decodeState calls hasCanonicalMidiStoreStateKeys which rejects unknown keys.
        const validState = makeState();
        const encoded = encodeState(validState)!;
        if (encoded.type === 'object') {
            const tampered = {
                ...encoded,
                entries: [...encoded.entries, { key: 'unknownKey', value: { type: 'null' } }],
            };
            expect(decodeState(tampered)).toBeNull();
        }
    });
});

describe('midiTimeStateCodec — decode rejection paths', () => {
    it('rejects null input', () => {
        expect(decodeState(null)).toBeNull();
    });

    it('rejects a non-object input', () => {
        expect(decodeState('not-an-object')).toBeNull();
    });

    it('rejects a decoded value that is not a valid MidiStoreState', () => {
        // A valid AST for a plain object that doesn't have the required MIDI keys.
        const fakeObject = {
            type: 'object',
            prototype: 'object',
            entries: [{ key: 'foo', value: { type: 'string', value: 'bar' } }],
        };
        expect(decodeState(fakeObject)).toBeNull();
    });

    it('rejects a decoded state with an unknown key', () => {
        // Manually craft an encoded state with an extra key.
        const validState = makeState();
        const encoded = encodeState(validState)!;
        // Add an unknown key to the object entries.
        if (encoded.type === 'object') {
            const tampered = {
                ...encoded,
                entries: [...encoded.entries, { key: 'unknownKey', value: { type: 'null' } }],
            };
            expect(decodeState(tampered)).toBeNull();
        }
    });
});

describe('midiTimeStateCodec — statesEqual', () => {
    it('returns true for identical states', () => {
        const a = makeState({ probabilitySeed: 100 });
        const b = makeState({ probabilitySeed: 100 });
        expect(statesEqual(a, b)).toBe(true);
    });

    it('returns false for states with different probabilitySeed', () => {
        const a = makeState({ probabilitySeed: 100 });
        const b = makeState({ probabilitySeed: 200 });
        expect(statesEqual(a, b)).toBe(false);
    });

    it('returns false for states with different notes', () => {
        const a = makeState({
            notesByClipId: { clip1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        });
        const b = makeState({
            notesByClipId: { clip1: [{ id: 'n1', pitch: 61, startBeat: 0, duration: 1, velocity: 100 }] },
        });
        expect(statesEqual(a, b)).toBe(false);
    });

    it('returns false when comparing valid state to an unencodable state', () => {
        const valid = makeState();
        const invalid = { bad: true } as unknown as MidiStoreState;
        expect(statesEqual(valid, invalid)).toBe(false);
    });
});

describe('midiTimeStateCodec — stateMatchesSnapshot', () => {
    it('returns true when the state matches its own encoded snapshot', () => {
        const state = makeState();
        const snapshot = encodeState(state)!;
        expect(stateMatchesSnapshot(state, snapshot)).toBe(true);
    });

    it('returns false when the state differs from the snapshot', () => {
        const state = makeState({ probabilitySeed: 100 });
        const otherState = makeState({ probabilitySeed: 200 });
        const snapshot = encodeState(otherState)!;
        expect(stateMatchesSnapshot(state, snapshot)).toBe(false);
    });

    it('returns false when the state cannot be encoded', () => {
        const invalid = { bad: true } as unknown as MidiStoreState;
        const snapshot = encodeState(makeState())!;
        expect(stateMatchesSnapshot(invalid, snapshot)).toBe(false);
    });
});

describe('midiTimeStateCodec — array encoding order', () => {
    it('encodes array entries sorted by index', () => {
        // Create a state where notes are in a specific order.
        const state = makeState({
            notesByClipId: {
                clip1: [
                    { id: 'n2', pitch: 62, startBeat: 1, duration: 1, velocity: 100 },
                    { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                ],
            },
        });
        const encoded = encodeState(state)!;
        // Navigate to the notes array entries and verify they're sorted by index.
        if (encoded.type === 'object') {
            const notesEntry = encoded.entries.find((e) => e.key === 'notesByClipId');
            if (notesEntry?.value.type === 'object') {
                const clipEntry = notesEntry.value.entries.find((e) => e.key === 'clip1');
                if (clipEntry?.value.type === 'array') {
                    const indices = clipEntry.value.entries.map((e) => e.index);
                    expect(indices).toEqual([...indices].sort((a, b) => a - b));
                }
            }
        }
    });
});

describe('midiTimeStateCodec — object key canonical sorting', () => {
    it('encodes object entries sorted alphabetically by key', () => {
        const state = makeState();
        const encoded = encodeState(state)!;
        if (encoded.type === 'object') {
            const keys = encoded.entries.map((e) => e.key);
            const sorted = [...keys].sort();
            expect(keys).toEqual(sorted);
        }
    });
});
