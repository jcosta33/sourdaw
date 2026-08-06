import { describe, it, expect } from 'vitest';

import { type TempoChange } from '../../../models/TempoMap';
import { resolveTempoFieldState } from '../resolveTempoFieldState';

const stepMap: TempoChange[] = [
    { id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' },
    { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
];

const rampMap: TempoChange[] = [
    { id: 'tc-a', beat: 0, tempo: 90, curve: 'linear' },
    { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
];

describe('resolveTempoFieldState', () => {
    it('reads the base tempo and the base range when there is no tempo map', () => {
        expect(resolveTempoFieldState({ changes: [], beat: 4, defaultTempo: 137, hasTransportState: true })).toEqual({
            tempo: 137,
            governedByMap: false,
            editable: true,
            lockReason: null,
            tempoChangeId: null,
            minTempo: 20,
            maxTempo: 300,
        });
    });

    it('reads the map value at the playhead and widens the range to the map range', () => {
        expect(
            resolveTempoFieldState({ changes: stepMap, beat: 9, defaultTempo: 137, hasTransportState: true })
        ).toEqual({
            tempo: 130,
            governedByMap: true,
            editable: true,
            lockReason: null,
            tempoChangeId: 'tc-b',
            minTempo: 20,
            maxTempo: 999,
        });
    });

    it('names the event the displayed value came from, so the write can be pinned to it', () => {
        // Drives between beat 2 (governed by the beat-0 event) and beat 9
        // (governed by the beat-8 event). Without an id on the output the UI has
        // nothing to pin, and the write target is re-resolved from wherever the
        // playhead has moved to by commit time — seconds later under
        // `commitMode="release"`.
        expect(
            resolveTempoFieldState({ changes: stepMap, beat: 2, defaultTempo: 137, hasTransportState: true })
                .tempoChangeId
        ).toBe('tc-a');
        expect(
            resolveTempoFieldState({ changes: stepMap, beat: 9, defaultTempo: 137, hasTransportState: true })
                .tempoChangeId
        ).toBe('tc-b');
    });

    it('keeps a 400 BPM event inside the clamp range instead of narrowing it to 300', () => {
        const fastMap: TempoChange[] = [{ id: 'tc-a', beat: 0, tempo: 400, curve: 'instant' }];
        const state = resolveTempoFieldState({
            changes: fastMap,
            beat: 0,
            defaultTempo: 120,
            hasTransportState: true,
        });

        expect(state.tempo).toBe(400);
        expect(state.maxTempo).toBeGreaterThanOrEqual(400);
        expect(state.editable).toBe(true);
    });

    it('locks the field inside a tempo ramp, where no single event carries the tempo', () => {
        const state = resolveTempoFieldState({
            changes: rampMap,
            beat: 4,
            defaultTempo: 137,
            hasTransportState: true,
        });

        expect(state.tempo).toBe(110);
        expect(state.editable).toBe(false);
        expect(state.lockReason).toBe('tempo-ramp');
    });

    it('leaves the ramp event’s own beat editable, unlike a beat inside its segment', () => {
        // Same `linear` map, two playhead positions: beat 0 is the ramp event's
        // own start point, where the readout is that event's own 90 and the write
        // is exact; beat 4 is strictly inside the segment. Locking both made the
        // field read-only at the *default* playhead position for every project
        // whose first tempo change ramps.
        const atRampStart = resolveTempoFieldState({
            changes: rampMap,
            beat: 0,
            defaultTempo: 137,
            hasTransportState: true,
        });
        const insideRamp = resolveTempoFieldState({
            changes: rampMap,
            beat: 4,
            defaultTempo: 137,
            hasTransportState: true,
        });

        expect(atRampStart.tempo).toBe(90);
        expect(atRampStart.editable).toBe(true);
        expect(atRampStart.lockReason).toBeNull();
        expect(atRampStart.tempoChangeId).toBe('tc-a');

        expect(insideRamp.editable).toBe(false);
    });

    it('locks the field before the transport state has hydrated, instead of dropping the write silently', () => {
        // `useStore(transportStore, defaultTransportState)` substitutes defaults,
        // so the field otherwise renders editable at 120 and a drag reaches
        // `getTempoWriteTarget`, gets `null`, and vanishes as a `no-write`.
        const unhydrated = resolveTempoFieldState({
            changes: [],
            beat: 0,
            defaultTempo: 120,
            hasTransportState: false,
        });
        const hydrated = resolveTempoFieldState({
            changes: [],
            beat: 0,
            defaultTempo: 120,
            hasTransportState: true,
        });

        expect(unhydrated.editable).toBe(false);
        expect(unhydrated.lockReason).toBe('no-transport-state');
        expect(hydrated.editable).toBe(true);
        expect(hydrated.lockReason).toBeNull();
    });

    it('reports the missing transport state ahead of a ramp, matching what the write path resolves first', () => {
        // `getTempoWriteTarget` returns `null` on a missing transport before it
        // ever looks at the map, so the field must name the same reason.
        const state = resolveTempoFieldState({
            changes: rampMap,
            beat: 4,
            defaultTempo: 137,
            hasTransportState: false,
        });

        expect(state.lockReason).toBe('no-transport-state');
    });
});
