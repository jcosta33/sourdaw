import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ replaceChordTrackState: vi.fn() }));

vi.mock('#/modules/MIDI/useCases', () => ({ replaceChordTrackState: mocks.replaceChordTrackState }));

import { setChordProgression } from '../setChordProgression';

describe('setChordProgression', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('dispatches an empty chord track when chords array is empty', () => {
        setChordProgression({ chords: [], repeatUntilBeat: 64 });
        expect(mocks.replaceChordTrackState).toHaveBeenCalledExactlyOnceWith({ enabled: true, events: [] });
    });

    it('repeats the progression until the target beat with correct durations', () => {
        setChordProgression({
            chords: [
                { root: 0, quality: 'major', duration: 16 },
                { root: 7, quality: 'major', duration: 16 },
            ],
            repeatUntilBeat: 64,
        });
        const call = mocks.replaceChordTrackState.mock.calls[0]?.[0];
        expect(call.enabled).toBe(true);
        expect(call.events).toHaveLength(4);
        // Each chord is 16 beats: 0-16, 16-32, 32-48, 48-64
        expect(call.events.map((e: { beat: number }) => e.beat)).toEqual([0, 16, 32, 48]);
        expect(call.events.map((e: { root: number }) => e.root)).toEqual([0, 7, 0, 7]);
    });

    it('wraps root to 0-11 range', () => {
        setChordProgression({
            chords: [{ root: 14, quality: 'minor', duration: 4 }],
            repeatUntilBeat: 8,
        });
        const call = mocks.replaceChordTrackState.mock.calls[0]?.[0];
        expect(call.events[0]?.root).toBe(2);
    });

    it('clamps the last chord duration when it exceeds the repeat target', () => {
        setChordProgression({
            chords: [{ root: 0, quality: 'major', duration: 16 }],
            repeatUntilBeat: 10,
        });
        const call = mocks.replaceChordTrackState.mock.calls[0]?.[0];
        expect(call.events).toHaveLength(1);
        expect(call.events[0]?.duration).toBe(10);
    });

    it('generates unique chord ids', () => {
        setChordProgression({
            chords: [{ root: 0, quality: 'major', duration: 4 }],
            repeatUntilBeat: 12,
        });
        const call = mocks.replaceChordTrackState.mock.calls[0]?.[0];
        const ids = call.events.map((e: { id: string }) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
