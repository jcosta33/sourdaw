import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { NoteFilter } from '../NoteFilter';

const transport: TransportInfo = {
    sampleRate: 44100,
    bpm: 120,
    ppqPosition: 0,
    isPlaying: true,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

describe('NoteFilter', () => {
    it('should export NoteFilter', () => {
        expect(NoteFilter).toBeDefined();
        const time = typeof NoteFilter;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('suppresses the Note Off for a filtered Note On', () => {
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', 60); // note 40 is below the range → filtered

        const onOut: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 40, velocity: 100 } }],
            onOut,
            transport
        );
        expect(onOut).toHaveLength(0); // Note On was filtered

        const offOut: MidiEvent[] = [];
        filter.processMidi([{ timeSamples: 100, kind: { type: 'noteOff', channel: 0, note: 40 } }], offOut, transport);
        expect(offOut).toHaveLength(0); // matching Note Off suppressed
    });

    it('clears filtered-note tracking on reset() so a later legitimate Note Off is not suppressed (no hung note)', () => {
        // Regression (round 2): reset() was a no-op that deliberately KEPT
        // filteredNotes, on the theory that an orphan Note Off for a filtered
        // Note On had to stay suppressed. That theory is unfounded — a filtered
        // Note On was never forwarded downstream, so dropping its key can never
        // orphan a sounding note. Worse, a surviving stale key suppresses a
        // LATER legitimate Note Off for the same note number, hanging it:
        //
        //   1. note 40 filtered (note_min=60) → key stored, never forwarded
        //   2. reset()/panic
        //   3. user WIDENS the range (note_min=0) so note 40 now passes
        //   4. new Note On 40 forwarded to the instrument (sounding)
        //   5. its Note Off matches the STALE key and is swallowed → hung note
        //
        // reset() must clear the set so step 5's Note Off flows through.
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', 60); // note 40 is filtered

        const onOut: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 40, velocity: 100 } }],
            onOut,
            transport
        );
        expect(onOut).toHaveLength(0); // filtered, never forwarded

        filter.reset();

        // Widen the range so note 40 now passes the filter.
        filter.setParam('note_min', 0);

        const onOut2: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 50, kind: { type: 'noteOn', channel: 0, note: 40, velocity: 100 } }],
            onOut2,
            transport
        );
        expect(onOut2).toHaveLength(1); // now passes → forwarded → sounding on the instrument

        const offOut: MidiEvent[] = [];
        filter.processMidi([{ timeSamples: 100, kind: { type: 'noteOff', channel: 0, note: 40 } }], offOut, transport);
        expect(offOut).toHaveLength(1); // its Note Off MUST be forwarded, not suppressed by the stale key
    });

    it('still forwards a Note Off for a note that passed the filter', () => {
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', 60);

        const onOut: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 72, velocity: 100 } }],
            onOut,
            transport
        );
        expect(onOut).toHaveLength(1); // passed

        const offOut: MidiEvent[] = [];
        filter.processMidi([{ timeSamples: 100, kind: { type: 'noteOff', channel: 0, note: 72 } }], offOut, transport);
        expect(offOut).toHaveLength(1); // its Note Off is forwarded
    });

    it('forwards a Note Off with no recorded decision (no matching Note On)', () => {
        // An off with no prior on has passed===undefined → forwarded (not suppressed).
        const filter = new NoteFilter('test-filter');
        const offOut: MidiEvent[] = [];
        filter.processMidi([{ timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 60 } }], offOut, transport);
        expect(offOut).toHaveLength(1);
    });

    it('filters by velocity range (vel_min/vel_max)', () => {
        const filter = new NoteFilter('test-filter');
        filter.setParam('vel_min', 50);
        filter.setParam('vel_max', 100);

        const low: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 30 } }],
            low,
            transport
        );
        expect(low).toHaveLength(0); // below vel_min → filtered

        const inRange: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 80 } }],
            inRange,
            transport
        );
        expect(inRange).toHaveLength(1); // within range → passes

        const high: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 120 } }],
            high,
            transport
        );
        expect(high).toHaveLength(0); // above vel_max → filtered
    });

    it('clamps the velocity params into [0,127]', () => {
        const filter = new NoteFilter('test-filter');
        filter.setParam('vel_min', -50);
        filter.setParam('vel_max', 999);
        // everything passes (0..127): velocity 0 and 127 both forward
        const out: MidiEvent[] = [];
        filter.processMidi(
            [
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 0 } },
                { timeSamples: 1, kind: { type: 'noteOn', channel: 0, note: 61, velocity: 127 } },
            ],
            out,
            transport
        );
        expect(out).toHaveLength(2);
    });

    it('filters by allowed pitch class', () => {
        const filter = new NoteFilter('test-filter');
        // only C (class 0): notes 60, 72 pass; 61 filtered
        filter.setAllowedPitchClasses([0]);

        const out: MidiEvent[] = [];
        filter.processMidi(
            [
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
                { timeSamples: 1, kind: { type: 'noteOn', channel: 0, note: 61, velocity: 100 } },
                { timeSamples: 2, kind: { type: 'noteOn', channel: 0, note: 72, velocity: 100 } },
            ],
            out,
            transport
        );
        expect(out.map((e) => (e.kind as { note: number }).note)).toEqual([60, 72]);
    });

    it('inverts the filter so excluded notes pass instead', () => {
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', 60); // normally notes >= 60 pass
        filter.setParam('invert', 1); // invert: notes < 60 pass

        const out: MidiEvent[] = [];
        filter.processMidi(
            [
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 40, velocity: 100 } },
                { timeSamples: 1, kind: { type: 'noteOn', channel: 0, note: 72, velocity: 100 } },
            ],
            out,
            transport
        );
        // inverted: 40 (below range) now passes, 72 (in range) now filtered
        expect(out.map((e) => (e.kind as { note: number }).note)).toEqual([40]);
    });

    it('passes through non-note events unchanged', () => {
        const filter = new NoteFilter('test-filter');
        const cc = {
            timeSamples: 0,
            kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
        } as MidiEvent;
        const out: MidiEvent[] = [];
        filter.processMidi([cc], out, transport);
        expect(out[0]).toBe(cc);
    });

    it('clamps note_min/note_max into [0,127]', () => {
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', -50);
        filter.setParam('note_max', 999);
        // full range: notes 0 and 127 both pass
        const out: MidiEvent[] = [];
        filter.processMidi(
            [
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 0, velocity: 100 } },
                { timeSamples: 1, kind: { type: 'noteOn', channel: 0, note: 127, velocity: 100 } },
            ],
            out,
            transport
        );
        expect(out).toHaveLength(2);
    });
});
