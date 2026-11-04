import { describe, expect, it } from 'vitest';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../../models/MidiNote';
import { planMidiRowCoordinateShift } from '../planMidiRowCoordinateShift';

function rowsAt(beat: number) {
    return {
        notes: [{ id: 'note', startBeat: beat, pitch: 60, duration: 0.25, velocity: 100 }],
        controllers: [{ id: 'cc', beat, controller: 64, value: 127, channel: 0 }],
        pitchBends: [{ id: 'bend', beat, value: 1024, channel: 0 }],
    };
}

function planned(input: Parameters<typeof planMidiRowCoordinateShift>[0]) {
    const result = planMidiRowCoordinateShift(input);
    if (result.status !== 'planned') {
        throw new Error(`Expected a complete coordinate plan: ${result.reason}`);
    }
    return result.capture;
}

function apply(
    rows: { notes: MidiNote[]; controllers: MidiCC[]; pitchBends: MidiPitchBend[] },
    capture: ReturnType<typeof planned>
) {
    return {
        notes: rows.notes.map((row) => ({
            ...row,
            startBeat: capture.coordinates.find((change) => change.kind === 'note' && change.id === row.id)!.afterBeat,
        })),
        controllers: rows.controllers.map((row) => ({
            ...row,
            beat: capture.coordinates.find((change) => change.kind === 'cc' && change.id === row.id)!.afterBeat,
        })),
        pitchBends: rows.pitchBends.map((row) => ({
            ...row,
            beat: capture.coordinates.find((change) => change.kind === 'pitchBend' && change.id === row.id)!.afterBeat,
        })),
    };
}

describe('exact identity-scoped MIDI coordinate shift planning', () => {
    it.each([8, 4, -6, 0])(
        'restores every unchanged fractional coordinate exactly after a %s-beat shift',
        (beatDelta) => {
            const original = rowsAt(0.1);
            const forward = planned({ ...original, beatDelta });
            const shifted = apply(original, forward);
            const restored = planned({ ...shifted, beatDelta: -beatDelta, restore: forward });

            expect(restored.coordinates.map((change) => change.afterBeat)).toEqual([0.1, 0.1, 0.1]);
            expect(apply(shifted, restored)).toEqual(original);
            expect(original).toEqual(rowsAt(0.1));
        }
    );

    it('keeps exact intermediate and terminal coordinates through a slip/trim chain and repeated inverse plans', () => {
        const original = rowsAt(0.1);
        const slip = planned({ ...original, beatDelta: 8 });
        const postSlip = apply(original, slip);
        const trim = planned({ ...postSlip, beatDelta: -6 });
        const postTrim = apply(postSlip, trim);
        const undoTrim = planned({ ...postTrim, beatDelta: 6, restore: structuredClone(trim) });
        expect(apply(postTrim, undoTrim)).toEqual(postSlip);
        const undoSlip = planned({ ...postSlip, beatDelta: -8, restore: structuredClone(slip) });
        let current = apply(postSlip, undoSlip);
        expect(current).toEqual(original);

        let inverse = undoSlip;
        for (let cycle = 0; cycle < 3; cycle += 1) {
            const redo = planned({ ...current, beatDelta: 8, restore: structuredClone(inverse) });
            current = apply(current, redo);
            expect(current).toEqual(postSlip);
            inverse = planned({ ...current, beatDelta: -8, restore: structuredClone(redo) });
            current = apply(current, inverse);
            expect(current).toEqual(original);
        }
    });

    it('keeps peer properties, translates new and moved rows, and never plans a deleted row back into existence', () => {
        const original = rowsAt(0.1);
        original.notes.push({ id: 'deleted', startBeat: 1.1, pitch: 64, duration: 0.5, velocity: 80 });
        const capture = planned({ ...original, beatDelta: 8 });
        const peer = apply(original, capture);
        peer.notes = peer.notes.filter((row) => row.id !== 'deleted');
        peer.notes[0]!.velocity = 42;
        peer.notes[0]!.expression = { pressure: [{ offsetBeats: 0, value: 0.5 }] };
        peer.controllers[0]!.beat = 9.25;
        peer.controllers[0]!.value = 64;
        peer.pitchBends.push({ id: 'added', beat: 11.5, value: -2048, channel: 3 });
        const before = structuredClone(peer);

        const inverse = planned({ ...peer, beatDelta: -8, restore: capture });
        expect(inverse.coordinates).toEqual([
            { kind: 'note', id: 'note', beforeBeat: 8.1, afterBeat: 0.1 },
            { kind: 'cc', id: 'cc', beforeBeat: 9.25, afterBeat: 1.25 },
            { kind: 'pitchBend', id: 'bend', beforeBeat: 8.1, afterBeat: 0.1 },
            { kind: 'pitchBend', id: 'added', beforeBeat: 11.5, afterBeat: 3.5 },
        ]);
        const restored = apply(peer, inverse);
        expect(restored.notes[0]).toEqual({ ...peer.notes[0], startBeat: 0.1 });
        expect(restored.controllers[0]).toEqual({ ...peer.controllers[0], beat: 1.25 });
        expect(restored.pitchBends[1]).toEqual({ ...peer.pitchBends[1], beat: 3.5 });
        expect(peer).toEqual(before);
        expect(inverse.coordinates.every((row) => Object.keys(row).length === 4)).toBe(true);
    });

    it('distinguishes identical ids in separate row kinds and does not retain or mutate caller objects', () => {
        const rows = rowsAt(0.1);
        rows.controllers[0]!.id = 'note';
        rows.pitchBends[0]!.id = 'note';
        const capture = planned({ ...rows, beatDelta: 8 });
        rows.notes[0]!.startBeat = 2;
        expect(capture.coordinates).toEqual([
            { kind: 'note', id: 'note', beforeBeat: 0.1, afterBeat: 8.1 },
            { kind: 'cc', id: 'note', beforeBeat: 0.1, afterBeat: 8.1 },
            { kind: 'pitchBend', id: 'note', beforeBeat: 0.1, afterBeat: 8.1 },
        ]);
    });

    it('preserves another peer edit before Redo and translates its added rows under the forward basis', () => {
        const original = rowsAt(0.1);
        const forward = planned({ ...original, beatDelta: 8 });
        const shifted = apply(original, forward);
        const undo = planned({ ...shifted, beatDelta: -8, restore: forward });
        const peer = apply(shifted, undo);
        peer.notes[0]!.startBeat = 0.25;
        peer.notes[0]!.duration = 0.75;
        peer.controllers = [];
        peer.pitchBends[0]!.value = -4096;
        peer.controllers.push({ id: 'added-on-undo', beat: 1.5, controller: 1, value: 55, channel: 2 });
        const before = structuredClone(peer);

        const redo = planned({ ...peer, beatDelta: 8, restore: structuredClone(undo) });
        const redone = apply(peer, redo);

        expect(redone.notes).toEqual([{ ...peer.notes[0], startBeat: 8.25 }]);
        expect(redone.controllers).toEqual([{ ...peer.controllers[0], beat: 9.5 }]);
        expect(redone.pitchBends).toEqual([{ ...peer.pitchBends[0], beat: 8.1 }]);
        expect(peer).toEqual(before);
    });

    it('returns an empty complete plan for no rows, including deleted captures', () => {
        const capture = planned({ ...rowsAt(0.1), beatDelta: 8 });
        expect(
            planned({ notes: [], controllers: [], pitchBends: [], beatDelta: -8, restore: capture }).coordinates
        ).toEqual([]);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'refuses nonfinite delta %s',
        (beatDelta) => {
            expect(planMidiRowCoordinateShift({ ...rowsAt(0.1), beatDelta })).toEqual({
                status: 'refused',
                reason: 'invalid-delta',
            });
        }
    );

    it.each(['', ' ', ' note'])('refuses malformed current identity %j without mutating any row', (id) => {
        const rows = rowsAt(0.1);
        rows.pitchBends[0]!.id = id;
        const before = structuredClone(rows);
        expect(planMidiRowCoordinateShift({ ...rows, beatDelta: 8 })).toEqual({
            status: 'refused',
            reason: 'invalid-row',
        });
        expect(rows).toEqual(before);
    });

    it('refuses duplicate current identities after otherwise valid rows', () => {
        const rows = rowsAt(0.1);
        rows.pitchBends.push(structuredClone(rows.pitchBends[0]!));
        expect(planMidiRowCoordinateShift({ ...rows, beatDelta: 8 })).toEqual({
            status: 'refused',
            reason: 'invalid-row',
        });
    });

    it.each(['notes', 'controllers', 'pitchBends'] as const)(
        'refuses nonfinite and overflowing %s before returning any apply plan',
        (kind) => {
            for (const beat of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
                const rows = rowsAt(0.1);
                if (kind === 'notes') {
                    rows.notes[0]!.startBeat = beat;
                }
                if (kind === 'controllers') {
                    rows.controllers[0]!.beat = beat;
                }
                if (kind === 'pitchBends') {
                    rows.pitchBends[0]!.beat = beat;
                }
                const before = structuredClone(rows);
                expect(planMidiRowCoordinateShift({ ...rows, beatDelta: Number.MAX_VALUE }).status).toBe('refused');
                expect(rows).toEqual(before);
            }
        }
    );

    it.each([
        null,
        {},
        { beatDelta: 8, coordinates: null },
        { beatDelta: -8, coordinates: [] },
        { beatDelta: Number.POSITIVE_INFINITY, coordinates: [] },
        { beatDelta: 8, coordinates: [], extra: true },
        ...[
            { kind: 'unknown', id: 'note', beforeBeat: 0.1, afterBeat: 8.1 },
            { kind: 'note', id: '', beforeBeat: 0.1, afterBeat: 8.1 },
            { kind: 'note', id: 'note', beforeBeat: Number.NaN, afterBeat: 8.1 },
            { kind: 'note', id: 'note', beforeBeat: 0.1, afterBeat: Number.POSITIVE_INFINITY },
            { kind: 'note', id: 'note', beforeBeat: 42, afterBeat: 8.1 },
            { kind: 'note', id: 'note', beforeBeat: 0.1, afterBeat: 8.1, velocity: 50 },
        ].map((row) => ({ beatDelta: 8, coordinates: [row] })),
    ])('refuses malformed, incoherent or nonfinite capture %#', (restore) => {
        const rows = rowsAt(8.1);
        const before = structuredClone(rows);
        expect(planMidiRowCoordinateShift({ ...rows, beatDelta: -8, restore })).toEqual({
            status: 'refused',
            reason: 'invalid-capture',
        });
        expect(rows).toEqual(before);
    });

    it('refuses duplicate captured identities and derived capture overflow even when captured rows were deleted', () => {
        const duplicate = planned({ ...rowsAt(0.1), beatDelta: 8 });
        duplicate.coordinates.push(structuredClone(duplicate.coordinates[0]!));
        expect(planMidiRowCoordinateShift({ ...rowsAt(8.1), beatDelta: -8, restore: duplicate }).status).toBe(
            'refused'
        );
        const restore = {
            beatDelta: Number.MAX_VALUE,
            coordinates: [{ kind: 'note', id: 'deleted', beforeBeat: Number.MAX_VALUE, afterBeat: Number.MAX_VALUE }],
        };
        expect(
            planMidiRowCoordinateShift({
                notes: [],
                controllers: [],
                pitchBends: [],
                beatDelta: -Number.MAX_VALUE,
                restore,
            })
        ).toEqual({ status: 'refused', reason: 'invalid-capture' });
    });
});
