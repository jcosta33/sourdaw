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
        expect(resolveTempoFieldState({ changes: [], beat: 4, defaultTempo: 137, isPlaying: false })).toEqual({
            tempo: 137,
            governedByMap: false,
            editable: true,
            lockReason: null,
            minTempo: 20,
            maxTempo: 300,
        });
    });

    it('stays editable during playback when no map governs, since the write is position-independent', () => {
        const state = resolveTempoFieldState({ changes: [], beat: 4, defaultTempo: 137, isPlaying: true });

        expect(state.editable).toBe(true);
        expect(state.lockReason).toBeNull();
    });

    it('reads the map value at the playhead and widens the range to the map range', () => {
        expect(resolveTempoFieldState({ changes: stepMap, beat: 9, defaultTempo: 137, isPlaying: false })).toEqual({
            tempo: 130,
            governedByMap: true,
            editable: true,
            lockReason: null,
            minTempo: 20,
            maxTempo: 999,
        });
    });

    it('keeps a 400 BPM event inside the clamp range instead of narrowing it to 300', () => {
        const fastMap: TempoChange[] = [{ id: 'tc-a', beat: 0, tempo: 400, curve: 'instant' }];
        const state = resolveTempoFieldState({ changes: fastMap, beat: 0, defaultTempo: 120, isPlaying: false });

        expect(state.tempo).toBe(400);
        expect(state.maxTempo).toBeGreaterThanOrEqual(400);
        expect(state.editable).toBe(true);
    });

    it('locks the field inside a tempo ramp, where no single event carries the tempo', () => {
        const state = resolveTempoFieldState({ changes: rampMap, beat: 4, defaultTempo: 137, isPlaying: false });

        expect(state.tempo).toBe(110);
        expect(state.editable).toBe(false);
        expect(state.lockReason).toBe('tempo-ramp');
    });

    it('locks the field during playback when a map governs, because the beat here is stale', () => {
        const state = resolveTempoFieldState({ changes: stepMap, beat: 0, defaultTempo: 137, isPlaying: true });

        expect(state.editable).toBe(false);
        expect(state.lockReason).toBe('playback');
    });

    it('reports the ramp lock ahead of the playback lock, since it is the stronger reason', () => {
        const state = resolveTempoFieldState({ changes: rampMap, beat: 4, defaultTempo: 137, isPlaying: true });

        expect(state.lockReason).toBe('tempo-ramp');
    });
});
